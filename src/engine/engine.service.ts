// ─────────────────────────────────────────────────────────────────────────────
// engine/chat.engine.ts  (v6 — storeNode enriched context + resolveStoreAction)
// ─────────────────────────────────────────────────────────────────────────────
import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { ChatbotSchema, ChatbotModel }           from '../mongoose/chatbot.schema';
import { MapflowModel, MapflowModelSchema }       from '../mongoose/mapflows.schema';
import { FlowRuntime, FlowRuntimeSchema }         from '../mongoose/runtimes.schema';

import { SessionService }              from './session/session.service';
import { ContextService }              from './context/context.service';
import { NodeResult, NodeService }     from './node/node.service';

import {
  ActiveGlobalStore,
  BotRuntimeConfig,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatSession,
  FormFieldDef,
  FormState,
  LLMMessage,
  NodeType,
  PaginationEntry,
  RuntimeNode,
  ChannelType,
  StorePermission,
  StoreActionResolution,
  VisitedNodeEntry,
} from './engine.types';

import { ChatGroqService }     from './groq/chatGroq.service';
import { PersistenceService }  from 'src/common/services/percistence/persistence.service';

const PAGINATION_KEY = '__pagination';

@Injectable()
export class EngineService {
  private readonly logger = new Logger(EngineService.name);

  constructor(
    private readonly SessionService:  SessionService,
    private readonly ContextService:  ContextService,
    private readonly NodeService:     NodeService,
    private readonly groq:            ChatGroqService,
    private readonly persistence:     PersistenceService,
  ) {}

  // ── Punto de entrada principal ─────────────────────────────────────────────

  async process(
    companyId:   string,
    botConfigId: string,
    request:     ChatRequest,
    channel:     ChannelType = 'widget',
  ): Promise<ChatResponse> {
    const session = await this.resolveSession(companyId, botConfigId, request, channel);

    if (session.turns >= session.config.maxTurns) {
      this.SessionService.destroy(session.sessionId);
      return this.endResponse(session, '¡Hemos llegado al límite de esta conversación!');
    }

    // ── Intercepción de paginación ────────────────────────────────────────
    if (request.paginateNodeId) {
      return this.processPagination(session, request.paginateNodeId);
    }

    // ── Intercepción de stores globales ───────────────────────────────────
    // Se evalúa ANTES del flujo normal. Una sola LLM call resuelve qué store
    // aplica, qué permiso ejecutar y sobre qué ítem — sin llamadas secuenciales.
    if (session.activeGlobalStores.length > 0) {
      const storeResponse = await this.processGlobalStores(session, request.message);
      if (storeResponse) return storeResponse;
    }

    // ── Flujo normal ──────────────────────────────────────────────────────
    const result = await this.runNodeChain(session, request.message);

    if (Object.keys(result.data).length > 0) {
      this.SessionService.mergeFormState(session.sessionId, result.data);
    }

    const nonEmptyTexts = result.chatMessages.map(m => m.text).filter(t => t?.trim());
    if (nonEmptyTexts.length > 0) {
      this.SessionService.pushTurn(session.sessionId, request.message, nonEmptyTexts);
    }

    if (result.nextNodeId) {
      this.SessionService.setCurrentNode(session.sessionId, result.nextNodeId);
      this.checkAndCloseStores(session, result.nextNodeId);
    }

    const conversationDone = result.done && !result.nextNodeId;
    if (conversationDone) {
      this.SessionService.destroy(session.sessionId);
    }

    const finalMessages = result.chatMessages.filter(m => m.text?.trim());

    if (finalMessages.length === 0 && !conversationDone) {
      finalMessages.push({ text: 'Procesando tu solicitud...' });
    }

    return {
      message:     finalMessages[finalMessages.length - 1]?.text ?? '',
      messages:    finalMessages.length > 0 ? finalMessages : [{ text: '' }],
      sessionId:   session.sessionId,
      currentNode: result.nextNodeId ?? session.currentNodeId,
      formState:   session.formState,
      done:        conversationDone,
    };
  }

  // ── Intercepción de stores globales ───────────────────────────────────────
  //
  // Diseño mejorado (v6):
  //
  // ANTES (v5): N llamadas LLM independientes, una por store activo.
  //   → Ambigüedad cuando dos stores tienen permisos similares.
  //   → Primer match en orden de array "gana", sin base semántica.
  //
  // AHORA (v6): resolveStoreAction — una sola LLM call que:
  //   1. Ve todos los stores activos simultáneamente con contexto semántico
  //      completo (description, triggerPhrases, avoidPhrases, contenido legible).
  //   2. Decide a cuál store aplica el mensaje del usuario (comparación directa).
  //   3. Determina permission + item en la misma inferencia.
  //
  // Optimización: si solo hay 1 store activo, se llama a evaluateSingleStore
  // directamente (sin overhead de selección entre múltiples).

private async processGlobalStores(
    session:     ChatSession,
    userMessage: string,
  ): Promise<ChatResponse | null> {

    const resolution = session.activeGlobalStores.length === 1
      ? await this.evaluateSingleStore(session.activeGlobalStores[0], session.formState, userMessage)
      : await this.resolveStoreAction(session.activeGlobalStores, session.formState, userMessage);

    if (!resolution.matched || !resolution.storeNodeId) return null;

    const store = session.activeGlobalStores.find(s => s.nodeId === resolution.storeNodeId);
    if (!store) return null;

    this.logger.log(
      `[globalStore] INTERCEPTADO nodeId="${store.nodeId}" ` +
      `objectVar="${store.objectVar}" permission="${resolution.permission}" item="${resolution.item}"`,
    );

    // ── Ejecutar la acción sobre formState ─────────────────────────────
    const actionResult = this.executeStoreAction(
      store, resolution.permission!, resolution.item, session.formState, session.sessionId,
    );

    this.SessionService.mergeFormState(session.sessionId, {
      [store.objectVar]: actionResult.newValue,
    });

    // ── Etiquetar en historial ─────────────────────────────────────────
    const feedbackText = store.feedbackVisible
      ? this.resolveStoreTemplate(
          store.feedbackMessage ?? '',
          resolution.item,
          resolution.permission!,
          actionResult.newValue,
          session.formState,
        )
      : '';

    this.SessionService.pushTurn(
      session.sessionId,
      userMessage,
      feedbackText ? [feedbackText] : [],
      {
        interceptedBy: store.nodeId,
        storeAction: {
          nodeId:     store.nodeId,
          permission: resolution.permission!,
          item:       resolution.item,
          result:     actionResult.success ? 'success' : 'error',
        },
      },
    );

    const messages: ChatMessage[] = feedbackText ? [{ text: feedbackText }] : [];

    // ── Resolver dónde reanudar (en código, sin LLM) y refrescar sesión ────
    const freshSession  = this.SessionService.get(session.sessionId)!;
    const resumeAnchor  = this.findResumeAnchorNode(freshSession);

    if (resumeAnchor) {
      this.SessionService.setCurrentNode(freshSession.sessionId, resumeAnchor.nodeId);
      this.logger.log(
        `[globalStore] RESUME → nodeId="${resumeAnchor.nodeId}" (resuelto por código, sin LLM)`,
      );
    } else {
      this.logger.warn(
        `[globalStore] RESUME — no se encontró nodo-ancla válido en nodeHistory, ` +
        `se continúa desde currentNodeId="${freshSession.currentNodeId}"`,
      );
    }

    const resumeResult = await this.runNodeChain(freshSession, '');

    const freshSession2 = this.SessionService.get(session.sessionId)!;

    const resumeMessage = resumeResult.message?.trim()
      ? resumeResult.message
      : resumeAnchor?.message ?? '';

    if (resumeMessage) {
      messages.push({ text: resumeMessage });
    }

    if (resumeResult.nextNodeId) {
      this.SessionService.setCurrentNode(freshSession.sessionId, resumeResult.nextNodeId);
      this.checkAndCloseStores(freshSession, resumeResult.nextNodeId);
    }

    return {
      message:     messages[messages.length - 1]?.text ?? '',
      messages:    messages.length > 0 ? messages : [{ text: '' }],
      sessionId:   freshSession.sessionId,
      currentNode: resumeResult.nextNodeId ?? freshSession.currentNodeId,
      formState:   freshSession.formState,
      done:        false,
    };
  }

  // ── resolveStoreAction — LLM call unificada (2+ stores activos) ───────────
  //
  // Una sola inferencia que compara todos los stores simultáneamente y resuelve:
  //   - storeNodeId: qué store aplica (o null si ninguno)
  //   - permission:  qué acción quiere el usuario
  //   - item:        sobre qué ítem actúa
  //
  // El prompt incluye por cada store:
  //   - description:    qué representa en el dominio (contexto semántico real)
  //   - triggerPhrases: ejemplos few-shot de frases que SÍ aplican
  //   - avoidPhrases:   ejemplos few-shot de frases que NO aplican (apuntan a otro store)
  //   - contenido actual legible (nombres, no JSON crudo)
  //   - permisos disponibles con descripciones en lenguaje natural

  private async resolveStoreAction(
    stores:      ActiveGlobalStore[],
    formState:   FormState,
    userMessage: string,
  ): Promise<StoreActionResolution> {

    const permissionDescriptions: Record<StorePermission, string> = {
      [StorePermission.INSERT]: 'agregar, añadir, incluir o poner un ítem nuevo',
      [StorePermission.EDIT]:   'modificar, cambiar, editar o actualizar un ítem existente',
      [StorePermission.DELETE]: 'quitar, eliminar, borrar o remover un ítem',
      [StorePermission.SHOW]:   'ver, mostrar, listar o consultar los ítems',
    };

    const storesSummary = stores.map(store => {
      const currentValue = formState[store.objectVar];

      // Serializar contenido actual de forma legible (nombres, no JSON crudo)
      const contentReadable = this.formatStoreContentReadable(currentValue);

      const permissionsText = store.permissions
        .map(p => `    - "${p}": ${permissionDescriptions[p]}`)
        .join('\n');

      return [
        `  nodeId: "${store.nodeId}"`,
        `  variable: "${store.objectVar}"`,
        `  descripción: ${store.description || '(sin descripción)'}`,
        store.triggerPhrases
          ? `  frases que indican ESTE store: ${store.triggerPhrases}`
          : null,
        store.avoidPhrases
          ? `  frases que indican OTRO store (no este): ${store.avoidPhrases}`
          : null,
        `  contenido actual: ${contentReadable}`,
        `  permisos disponibles:\n${permissionsText}`,
      ].filter(Boolean).join('\n');
    }).join('\n\n---\n\n');

    const allPermissions = [...new Set(stores.flatMap(s => s.permissions))];

    const prompt = `Eres un clasificador de intenciones para múltiples listas/colecciones activas.

El usuario escribió: "${userMessage}"

Stores disponibles:
---
${storesSummary}
---

Tu tarea:
1. Determina a cuál store se refiere el mensaje del usuario.
   Usa la descripción, las frases indicadoras y el contenido actual de cada store.
   Dos stores pueden tener permisos similares — la descripción y las frases son la clave para distinguirlos.

2. Si el mensaje aplica a algún store, determina:
   - Qué acción quiere el usuario (según los permisos de ESE store)
   - Sobre qué ítem actúa (extrae el nombre o descripción del ítem del mensaje, o "" para show/list)

3. Si el mensaje NO aplica a ningún store (es una pregunta general, saludo, o tema diferente):
   - matched: false

Responde ÚNICAMENTE con JSON válido (sin markdown):
{
  "matched": true,
  "storeNodeId": "<nodeId del store seleccionado, o null>",
  "permission": "${allPermissions.join('" | "')}",
  "item": "<ítem extraído del mensaje, o vacío>"
}`;

    try {
      const result = await this.groq.rawCall<{
        matched:     boolean;
        storeNodeId: string | null;
        permission:  StorePermission | null;
        item:        string;
      }>(prompt, userMessage);

      if (!result || typeof result.matched !== 'boolean') {
        return { matched: false, storeNodeId: null, permission: null, item: '' };
      }

      this.logger.log(
        `[resolveStoreAction] matched=${result.matched} ` +
        `storeNodeId="${result.storeNodeId}" ` +
        `permission="${result.permission}" item="${result.item}"`,
      );

      return {
        matched:     result.matched === true,
        storeNodeId: result.matched ? (result.storeNodeId ?? null) : null,
        permission:  result.matched ? (result.permission ?? null) : null,
        item:        result.item ?? '',
      };
    } catch (err: any) {
      this.logger.error(`[resolveStoreAction] LLM error: ${err.message}`);
      return { matched: false, storeNodeId: null, permission: null, item: '' };
    }
  }

  // ── evaluateSingleStore — optimización para 1 solo store activo ───────────
  //
  // Cuando solo hay un store activo, no hace falta seleccionarlo — se evalúa
  // directamente. El prompt es más acotado (sin comparación entre stores).
  // Equivalente al evaluateStoreIntent original pero con contexto semántico.

  private async evaluateSingleStore(
    store:       ActiveGlobalStore,
    formState:   FormState,
    userMessage: string,
  ): Promise<StoreActionResolution> {

    const permissionDescriptions: Record<StorePermission, string> = {
      [StorePermission.INSERT]: 'agregar, añadir, incluir o poner un ítem nuevo',
      [StorePermission.EDIT]:   'modificar, cambiar, editar o actualizar un ítem existente',
      [StorePermission.DELETE]: 'quitar, eliminar, borrar o remover un ítem',
      [StorePermission.SHOW]:   'ver, mostrar, listar o consultar los ítems',
    };

    const currentValue    = formState[store.objectVar];
    const contentReadable = this.formatStoreContentReadable(currentValue);

    const permissionsText = store.permissions
      .map(p => `- "${p}": ${permissionDescriptions[p]}`)
      .join('\n');

    const prompt = `Eres un clasificador de intenciones para una lista/colección.

Variable gestionada: "${store.objectVar}"
${store.description ? `Descripción: ${store.description}` : ''}
${store.triggerPhrases ? `Frases que indican acción sobre esta lista: ${store.triggerPhrases}` : ''}
Contenido actual: ${contentReadable}

Permisos disponibles:
${permissionsText}

Mensaje del usuario: "${userMessage}"

Determina si el mensaje tiene la intención de realizar alguna de las acciones listadas.

Si SÍ:
- "matched": true
- "permission": el ID exacto del permiso ("${store.permissions.join('" | "')}")
- "item": el ítem o descripción sobre el que actúa (o "" si es show/list)

Si NO (pregunta general, saludo, o no relacionado):
- "matched": false
- "permission": null
- "item": ""

Responde ÚNICAMENTE con JSON válido (sin markdown):`;

    try {
      const result = await this.groq.rawCall<{
        matched:    boolean;
        permission: StorePermission | null;
        item:       string;
      }>(prompt, userMessage);

      if (!result || typeof result.matched !== 'boolean') {
        return { matched: false, storeNodeId: null, permission: null, item: '' };
      }

      this.logger.log(
        `[evaluateSingleStore] nodeId="${store.nodeId}" matched=${result.matched} ` +
        `permission="${result.permission}" item="${result.item}"`,
      );

      return {
        matched:     result.matched === true,
        storeNodeId: result.matched ? store.nodeId : null,
        permission:  result.matched ? (result.permission ?? null) : null,
        item:        result.item ?? '',
      };
    } catch (err: any) {
      this.logger.error(`[evaluateSingleStore] LLM error: ${err.message}`);
      return { matched: false, storeNodeId: null, permission: null, item: '' };
    }
  }

  // ── formatStoreContentReadable — serialización legible del contenido ───────
  //
  // Convierte el valor de formState[objectVar] a texto plano legible para el LLM.
  // Evita JSON crudo — el LLM razona mejor con "Ibuprofeno, Amoxicilina"
  // que con [{"nombre":"Ibuprofeno","precio":500,...}].

  private formatStoreContentReadable(value: any): string {
    if (value === null || value === undefined) return '(vacío)';

    if (Array.isArray(value)) {
      if (value.length === 0) return '(vacío)';
      const names = value.map((entry: any) => {
        const d = entry?.data ?? entry ?? {};
        return d.nombre ?? d.name ?? d.label ?? String(Object.values(d)[0] ?? '');
      }).filter(Boolean);
      return names.length > 0 ? names.join(', ') : `${value.length} ítem(s)`;
    }

    if (typeof value === 'object') {
      const d = (value as any)?.data ?? value;
      const name = d.nombre ?? d.name ?? d.label;
      return name ? String(name) : JSON.stringify(value);
    }

    return String(value);
  }

  // ── Ejecutar acción del store sobre formState ──────────────────────────────

  private executeStoreAction(
    store:      ActiveGlobalStore,
    permission: StorePermission,
    item:       string,
    formState:  FormState,
    sessionId:  string,
  ): { newValue: any; success: boolean } {
    const current = formState[store.objectVar];

    try {
      switch (permission) {
        case StorePermission.INSERT: {
          if (store.isArray) {
            const arr = Array.isArray(current) ? [...current] : [];

            // Buscar el doc real en outputCache por nombre
            const sourceDocs = this.SessionService.getOutputCache(
              sessionId, store.extractFromNodeId,
            );
            const itemLower = item.toLowerCase();
            const matched = sourceDocs.find((doc: any) => {
              const d = doc?.data ?? doc ?? {};
              const name = (d.nombre ?? d.name ?? d.label ?? '').toLowerCase();
              return name.includes(itemLower);
            });

            arr.push(matched ?? { name: item, addedAt: new Date().toISOString() });
            return { newValue: arr, success: true };
          }

          return { newValue: { name: item, addedAt: new Date().toISOString() }, success: true };
        }

        case StorePermission.DELETE: {
          if (store.isArray && Array.isArray(current)) {
            const filtered = current.filter((entry: any) => {
              const d = entry?.data ?? entry ?? {};
              const entryName = (
                d.nombre ?? d.name ?? d.label ?? String(Object.values(d)[0] ?? '')
              ).toLowerCase();
              return !entryName.includes(item.toLowerCase());
            });
            return { newValue: filtered, success: true };
          }
          return { newValue: null, success: true };
        }

        case StorePermission.EDIT: {
          if (store.isArray && Array.isArray(current)) {
            const [targetName, ...rest] = item.split(':');
            const newItemData           = rest.join(':').trim() || item;
            const updated = current.map((entry: any) => {
              const entryName = (entry?.name ?? entry?.label ?? String(entry)).toLowerCase();
              if (entryName.includes(targetName.toLowerCase())) {
                return { ...entry, name: newItemData, updatedAt: new Date().toISOString() };
              }
              return entry;
            });
            return { newValue: updated, success: true };
          }
          return {
            newValue: {
              ...(typeof current === 'object' ? current : {}),
              name: item,
              updatedAt: new Date().toISOString(),
            },
            success: true,
          };
        }

        case StorePermission.SHOW:
          return { newValue: current, success: true };

        default:
          return { newValue: current, success: false };
      }
    } catch (err: any) {
      this.logger.error(`[executeStoreAction] error: ${err.message}`);
      return { newValue: current, success: false };
    }
  }

  // ── Resolver template del feedbackMessage ─────────────────────────────────

  private resolveStoreTemplate(
    template:   string,
    item:       string,
    permission: StorePermission,
    newValue:   any,
    formState:  FormState,
  ): string {
    if (!template.trim()) {
      return this.buildDefaultGlobalFeedback(permission, item, newValue);
    }

    const count   = Array.isArray(newValue) ? newValue.length : (newValue ? 1 : 0);
    const listStr = Array.isArray(newValue)
      ? newValue.map((e: any) => e?.name ?? e?.label ?? String(e)).join(', ')
      : '';

    return template
      .replace(/\$\{item\}/g,       item)
      .replace(/\$\{permission\}/g,  permission)
      .replace(/\$\{count\}/g,       String(count))
      .replace(/\$\{list\}/g,        listStr)
      .replace(/\$\{form\.(\w+)\}/g, (_, key) => {
        const val = formState[key];
        return val !== null && val !== undefined ? String(val) : `[${key}]`;
      });
  }

  private buildDefaultGlobalFeedback(
    permission: StorePermission,
    item:       string,
    newValue:   any,
  ): string {
    const count  = Array.isArray(newValue) ? newValue.length : (newValue ? 1 : 0);
    const plural = count === 1 ? 'producto' : 'productos';

    switch (permission) {
      case StorePermission.INSERT:
        return `He agregado "${item}" a tu lista. Ahora tienes ${count} ${plural}.`;
      case StorePermission.DELETE:
        return `He eliminado "${item}" de tu lista. Te quedan ${count} ${plural}.`;
      case StorePermission.EDIT:
        return `He actualizado "${item}".`;
      case StorePermission.SHOW: {
        const list = Array.isArray(newValue)
          ? newValue.map((e: any) => {
              const d = e?.data ?? e ?? {};
              return d.nombre ?? d.name ?? d.label ?? String(Object.values(d)[0] ?? '');
            }).join(', ')
          : String(newValue ?? '');
        return list ? `Tu lista contiene: ${list}.` : 'Tu lista está vacía.';
      }
      default:
        return '';
    }
  }

  // ── Comprobar y cerrar stores cuyo closeNodeId acaba de alcanzarse ─────────

  private checkAndCloseStores(session: ChatSession, arrivedNodeId: string): void {
    const toClose = session.activeGlobalStores.filter(
      st => st.closeNodeId === arrivedNodeId,
    );
    for (const store of toClose) {
      this.SessionService.closeGlobalStore(session.sessionId, store.nodeId);
      this.logger.log(
        `[globalStore] AUTO-CLOSE — nodeId="${store.nodeId}" ` +
        `porque closeNodeId="${arrivedNodeId}" fue alcanzado`,
      );
    }
  }

  // ── Procesamiento de paginación ───────────────────────────────────────────

  private async processPagination(
    session: ChatSession,
    nodeId:  string,
  ): Promise<ChatResponse> {
    const node = session.config.runtimeNodes[nodeId];
    if (!node || node.type !== 'outputNode') {
      this.logger.warn(`[paginate] nodeId="${nodeId}" no es un outputNode válido`);
      return this.endResponse(session, 'No se pudo cargar más información.');
    }

    this.SessionService.setCurrentNode(session.sessionId, nodeId);

    const result = await this.runNodeChain(session, '');

    const nonEmptyTexts = result.chatMessages.map(m => m.text).filter(t => t?.trim());
    if (nonEmptyTexts.length > 0) {
      this.SessionService.pushTurn(session.sessionId, '[ver más]', nonEmptyTexts);
    }

    if (result.nextNodeId) {
      this.SessionService.setCurrentNode(session.sessionId, result.nextNodeId);
      this.checkAndCloseStores(session, result.nextNodeId);
    }

    const finalMessages = result.chatMessages.filter(m => m.text?.trim());
    if (finalMessages.length === 0) finalMessages.push({ text: 'Procesando...' });

    return {
      message:     finalMessages[finalMessages.length - 1].text,
      messages:    finalMessages,
      sessionId:   session.sessionId,
      currentNode: result.nextNodeId ?? nodeId,
      formState:   session.formState,
      done:        false,
    };
  }

  // ── Nodos que avanzan automáticamente ────────────────────────────────────

  private readonly AUTO_ADVANCE_NODES: NodeType[] = [
    'outputNode', 'goToNode', 'fallbackNode', 'routerNode',
    'conversationNode', 'insertNode', 'apiNode', 'storeNode',
  ];

  // ── Trackeo de nodos ────────────────────────────────────

// ── Trackeo de nodos ────────────────────────────────────

  private readonly RESUME_ANCHOR_TYPES: NodeType[] = [
    'conversationNode', 'inputNode', 'confirmationNode',
  ];

 private pushNodeHistory(session: ChatSession, nodeId: string, type: NodeType, message: string, turn: number): void {
    if (!this.RESUME_ANCHOR_TYPES.includes(type)) return;
    if (!message?.trim()) return;

    const entry: VisitedNodeEntry = { nodeId, type, message: message.trim(), turn };
    this.SessionService.appendNodeHistory(session.sessionId, entry);
  }

  // ── findResumeAnchorNode — resuelve en código, sin LLM, dónde reanudar ────
  //
  // El nodo correcto para reanudar tras una intercepción de store es, en la
  // inmensa mayoría de los casos, el último nodo-ancla (conversationNode,
  // inputNode o confirmationNode) que quedó esperando algo del usuario antes
  // de que el store interceptara. No hace falta inferencia para esto — el
  // propio nodeHistory, en orden cronológico, ya contiene la respuesta.
  //
  // Se valida además que el nodeId siga existiendo en runtimeNodes y que su
  // tipo actual siga siendo uno de los aptos para resume (por si el flow fue
  // editado entre sesiones).

  private findResumeAnchorNode(session: ChatSession): { nodeId: string; message: string } | null {
    for (let i = session.nodeHistory.length - 1; i >= 0; i--) {
      const entry = session.nodeHistory[i];
      if (!this.RESUME_ANCHOR_TYPES.includes(entry.type) || !entry.message) continue;

      const node = session.config.runtimeNodes[entry.nodeId];
      if (!node || !this.RESUME_ANCHOR_TYPES.includes(node.type as NodeType)) continue;

      return { nodeId: entry.nodeId, message: entry.message };
    }
    return null;
  }
  // ── Chain de nodos ────────────────────────────────────────────────────────

  private async runNodeChain(
    session:     ChatSession,
    userMessage: string,
  ): Promise<NodeResult & { data: FormState; chatMessages: ChatMessage[]; lastNodeId: string }> {
    let node = await this.resolveCurrentNode(session);
    let contextMessages = this.ContextService.build(session, node);
    let lastNodeId = node.id;

    if (node.type !== 'intentNode') {
      session.formState['__previousNodeId'] = session.currentNodeId;
    }

    let result = await this.NodeService.run({
      session, node, userMessage, contextMessages,
    });

    if (Object.keys(result.data).length > 0) {
      this.SessionService.mergeFormState(session.sessionId, result.data);
    }

    const chatMessages: ChatMessage[] = [];
    if (result.message.trim()) {
      chatMessages.push(this.buildChatMessage(result, node));
      this.pushNodeHistory(session, node.id, node.type as NodeType, result.message, session.turns); // ← nuevo

    }

    const MAX_CHAIN = 5;
    let chainCount  = 0;

    while (result.done && result.nextNodeId && chainCount < MAX_CHAIN) {
      const nextNode = session.config.runtimeNodes[result.nextNodeId];
      if (!nextNode) break;

      this.checkAndCloseStores(session, result.nextNodeId);

      const isImplicitInput =
        nextNode.type === 'inputNode' && nextNode.data?.implicit === true;

      const isAutoConfirmation =
        nextNode.type === 'confirmationNode' &&
        chatMessages.filter(m => m.text?.trim()).length === 0;

      if (
        !this.AUTO_ADVANCE_NODES.includes(nextNode.type as NodeType) &&
        !isImplicitInput &&
        !isAutoConfirmation
      ) {
        break;
      }

      if (this.shouldBlockConversationNode(nextNode)) break;

      session = {
        ...session,
        currentNodeId: result.nextNodeId,
        formState: this.SessionService.get(session.sessionId)?.formState ?? session.formState,
      };

      node            = nextNode;
      lastNodeId      = node.id;
      contextMessages = this.ContextService.build(session, node);

      if (node.type !== 'intentNode') {
        session.formState['__previousNodeId'] = session.currentNodeId;
      }

      const nextResult = await this.NodeService.run({
        session, node, userMessage, contextMessages,
      });

      if (Object.keys(nextResult.data).length > 0) {
        this.SessionService.mergeFormState(session.sessionId, nextResult.data);
      }

      if (nextResult.message.trim()) {
        chatMessages.push(this.buildChatMessage(nextResult, node));
          this.pushNodeHistory(session, node.id, node.type as NodeType, nextResult.message, session.turns); // ← nuevo

      }

      result = nextResult;
      chainCount++;
    }

    this.SessionService.setCurrentNode(session.sessionId, lastNodeId);

    return {
      ...result,
      message:      chatMessages[chatMessages.length - 1]?.text ?? '',
      chatMessages,
      data:         session.formState,
      lastNodeId,
    };
  }

  private buildChatMessage(
    result: NodeResult & { pagination?: PaginationEntry },
    node:   RuntimeNode,
  ): ChatMessage {
    const msg: ChatMessage = { text: result.message.trim() };
    const pagination = (result as any).pagination as PaginationEntry | undefined;
    if (node.type === 'outputNode' && pagination?.hasMore) {
      msg.pagination = pagination;
    }
    return msg;
  }

  private shouldBlockConversationNode(node: RuntimeNode): boolean {
    if (node.type !== 'conversationNode') return false;
    return (node.data?.type as string | undefined) === 'question';
  }

  // ── Resolución de sesión ──────────────────────────────────────────────────

  private async resolveSession(
    companyId:   string,
    botConfigId: string,
    request:     ChatRequest,
    channel:     ChannelType,
  ): Promise<ChatSession> {
    if (request.sessionId) {
      const existing = this.SessionService.get(request.sessionId);
      if (existing) return existing;
    }

    const config = await this.loadBotConfig(companyId, botConfigId);

    return this.SessionService.getOrCreate({
      visitorId: request.visitorId,
      channelId: botConfigId,
      channel,
      config,
      sessionId: request.sessionId,
    });
  }

  // ── Carga de configuración desde Mongo ────────────────────────────────────

  private async loadBotConfig(companyId: string, botConfigId: string): Promise<BotRuntimeConfig> {
    const botModel = await this.persistence.getTenantModel<ChatbotModel>(
      companyId, 'BotConfig', ChatbotSchema,
    );
    const bot = await botModel
      .findById(botConfigId)
      .lean<ChatbotModel & { _id: any }>()
      .exec();

    if (!bot || bot.deleted || !bot.active) {
      throw new NotFoundException({
        message: 'Bot no encontrado o inactivo.',
        details: `botConfigId: ${botConfigId}`,
      });
    }

    const mapFlowModel = await this.persistence.getTenantModel<MapflowModel>(
      companyId, 'Mapflow', MapflowModelSchema,
    );
    const mapflow = await mapFlowModel
      .findById(bot.mapflowId.toString())
      .lean<MapflowModel & { _id: any }>()
      .exec();

    if (!mapflow || mapflow.deleted || !mapflow.active) {
      throw new NotFoundException({
        message: 'Mapflow del bot no encontrado o inactivo.',
        details: `mapflowId: ${bot.mapflowId}`,
      });
    }

    const runtimeModel = await this.persistence.getTenantModel<FlowRuntime>(
      companyId, 'FlowRuntime', FlowRuntimeSchema,
    );
    const flowRuntime = await runtimeModel
      .findOne({ flowDefinitionId: bot.mapflowId.toString(), active: true })
      .sort({ version: -1 })
      .lean<FlowRuntime & { _id: any }>()
      .exec();

    if (!flowRuntime) {
      throw new NotFoundException({
        message: 'FlowRuntime no encontrado para este mapflow.',
        details: `mapflowId: ${bot.mapflowId}`,
      });
    }

    const formFields: FormFieldDef[] = (mapflow.formFields ?? []).map((f: any) => ({
      name:     f.name,
      type:     f.type,
      label:    f.label ?? f.name,
      required: f.required ?? false,
    }));

    const config: BotRuntimeConfig = {
      botConfigId:     String(bot._id),
      company_id:      bot.company_id,
      name:            bot.name,
      description:     bot.description,
      instructions:    bot.instructions,
      type:            bot.type,
      maxTurns:        bot.maxTurns,
      selectedSchemas: bot.selectedSchemas ?? [],
      mapflowId:       String(bot.mapflowId),
      formFields,
      startNode:       flowRuntime.startNode,
      runtimeNodes:    flowRuntime.nodes as Record<string, RuntimeNode>,
    };

    this.logger.log(
      `Config cargada — bot="${bot.name}" mapflow="${mapflow.name}" startNode="${flowRuntime.startNode}"`,
    );

    return config;
  }

  // ── Resolución de nodo actual ─────────────────────────────────────────────

  private async resolveCurrentNode(session: ChatSession): Promise<RuntimeNode> {
    const node = session.config.runtimeNodes[session.currentNodeId];
    if (!node) {
      throw new NotFoundException({
        message: 'Nodo no encontrado en el FlowRuntime.',
        details: `nodeId: ${session.currentNodeId}`,
      });
    }
    return node;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private endResponse(session: ChatSession, text: string): ChatResponse {
    return {
      message:     text,
      messages:    [{ text }],
      sessionId:   session.sessionId,
      currentNode: session.currentNodeId,
      formState:   session.formState,
      done:        true,
    };
  }
  
}