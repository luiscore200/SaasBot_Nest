// ─────────────────────────────────────────────────────────────────────────────
// engine/chat.engine.ts  (v5 — storeNode global interceptor)
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
    // Se evalúa ANTES del flujo normal. Si algún store activo maneja el
    // mensaje, se devuelve la respuesta sin avanzar el nodo actual.
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
      // ── Comprobar si el nodo al que avanzamos es un closeNodeId ──────────
      this.checkAndCloseStores(session, result.nextNodeId);
    }

    const conversationDone = result.done && !result.nextNodeId;
    if (conversationDone) {
      this.SessionService.destroy(session.sessionId);
    }

    const fallback: ChatMessage = { text: 'Procesando tu solicitud...' };
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
  // Para cada store activo, lanza un LLM call liviano y acotado que evalúa
  // si el mensaje del usuario tiene intención de [permissions] sobre [objectVar].
  //
  // Diseño deliberado del prompt del evaluador:
  //  - Sin system prompt del bot (para no confundir contexto de flujo con acción de store)
  //  - Sin historial completo (solo el estado actual de objectVar es relevante)
  //  - Solo: objectVar, permissions, contenido actual, mensaje del usuario
  //
  // Si algún store intercepta: ejecuta la acción, etiqueta el historial,
  // opcionalmente devuelve feedbackMessage, y retorna sin avanzar el flujo.
  // Si ninguno intercepta: devuelve null → el engine continúa con el flujo normal.

private async processGlobalStores(
  session:     ChatSession,
  userMessage: string,
): Promise<ChatResponse | null> {
  for (const store of session.activeGlobalStores) {
    const result = await this.evaluateStoreIntent(store, session.formState, userMessage);

    if (!result.matched) continue;

    this.logger.log(
      `[globalStore] INTERCEPTADO nodeId="${store.nodeId}" ` +
      `permission="${result.permission}" item="${result.item}"`,
    );

    // ── Ejecutar la acción sobre formState ─────────────────────────────
  const actionResult = this.executeStoreAction(
  store, result.permission!, result.item, session.formState, session.sessionId,
);

    this.SessionService.mergeFormState(session.sessionId, {
      [store.objectVar]: actionResult.newValue,
    });

    // ── Etiquetar en historial ─────────────────────────────────────────
    const feedbackText = store.feedbackVisible
      ? this.resolveStoreTemplate(
          store.feedbackMessage ?? '',
          result.item,
          result.permission!,
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
          permission: result.permission!,
          item:       result.item,
          result:     actionResult.success ? 'success' : 'error',
        },
      },
    );

    const messages: ChatMessage[] = feedbackText ? [{ text: feedbackText }] : [];

    // ── Refrescar sesión y re-ejecutar el nodo pendiente ──────────────
    const freshSession = this.SessionService.get(session.sessionId)!;
    const resumeResult = await this.runNodeChain(freshSession, '');

    if (resumeResult.message?.trim()) {
      messages.push({ text: resumeResult.message });
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

  return null; // ningún store interceptó — continuar flujo normal
}

  // ── LLM liviano: evaluar intención del store ───────────────────────────────
  //
  // Prompt muy acotado. No recibe historial, no recibe system prompt del bot.
  // Solo lo estrictamente necesario para clasificar si el mensaje es una acción
  // de [permissions] sobre [objectVar].

  private async evaluateStoreIntent(
    store:      ActiveGlobalStore,
    formState:  FormState,
    userMessage: string,
  ): Promise<{ matched: boolean; permission?: StorePermission; item: string }> {
    const currentValue = formState[store.objectVar];

    const permissionDescriptions: Record<StorePermission, string> = {
      [StorePermission.INSERT]: 'agregar, añadir, incluir o poner un ítem nuevo',
      [StorePermission.EDIT]:   'modificar, cambiar, editar o actualizar un ítem existente',
      [StorePermission.DELETE]: 'quitar, eliminar, borrar o remover un ítem',
      [StorePermission.SHOW]:   'ver, mostrar, listar o consultar los ítems',
    };

    const permissionsText = store.permissions
      .map(p => `- "${p}": ${permissionDescriptions[p]}`)
      .join('\n');

    const currentValueText = currentValue !== null && currentValue !== undefined
      ? JSON.stringify(currentValue)
      : '(vacío)';

    const prompt = `Eres un clasificador de intenciones para un carrito/lista de ítems.

Variable gestionada: "${store.objectVar}"
Contenido actual: ${currentValueText}

Permisos disponibles:
${permissionsText}

Mensaje del usuario: "${userMessage}"

Determina si el mensaje del usuario tiene la intención de realizar alguna de las acciones listadas sobre "${store.objectVar}".

Si SÍ tiene esa intención:
- "matched": true
- "permission": el ID exacto del permiso ("${store.permissions.join('" | "')}")
- "item": el ítem o descripción sobre el que actúa (texto extraído del mensaje, o "" si es show/list)

Si NO tiene esa intención (es una pregunta general, saludo, o no relacionada):
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
        return { matched: false, item: '' };
      }

      return {
        matched:    result.matched === true,
        permission: result.matched ? (result.permission ?? undefined) : undefined,
        item:       result.item ?? '',
      };
    } catch (err: any) {
      this.logger.error(`[evaluateStoreIntent] LLM error: ${err.message}`);
      return { matched: false, item: '' };
    }
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
    
         // Buscar el doc real en el outputCache por nombre
          const sourceDocs = this.SessionService.getOutputCache(
            sessionId, store.extractFromNodeId  // ← necesitas session aquí
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
            // buscar en todos los campos string del objeto
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
            // Para edit: el LLM ya extrajo el ítem como "nombre:nuevoValor"
            // o directamente el nombre del ítem a reemplazar.
            // Estrategia simple: reemplazar el primero que haga match por nombre.
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
            newValue: { ...(typeof current === 'object' ? current : {}), name: item, updatedAt: new Date().toISOString() },
            success: true,
          };
        }

        case StorePermission.SHOW:
          // SHOW no muta el valor — solo lee. El feedbackMessage lo muestra.
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
  //
  // Soporta: ${item}, ${objectVar}, ${count} y ${form.campo}

  private resolveStoreTemplate(
    template:   string,
    item:       string,
    permission: StorePermission,
    newValue:   any,
    formState:  FormState,
    matched:    Record<string, any>[] = [],
  ): string {
      if (!template.trim()) {
    // Fallback automático igual que node.service.ts
    return this.buildDefaultGlobalFeedback(permission, item, newValue);
     }

    const count = Array.isArray(newValue) ? newValue.length : (newValue ? 1 : 0);
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

    const fallback: ChatMessage = { text: 'Procesando...' };
    const finalMessages = result.chatMessages.filter(m => m.text?.trim());
    if (finalMessages.length === 0) finalMessages.push(fallback);

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

  // ── Chain de nodos ────────────────────────────────────────────────────────

 private async runNodeChain(
  session:     ChatSession,
  userMessage: string,
): Promise<NodeResult & { data: FormState; chatMessages: ChatMessage[]; lastNodeId: string }> {
  let node = await this.resolveCurrentNode(session);
  let contextMessages = this.ContextService.build(session, node);
  let lastNodeId = node.id;  // ← trackear el último nodo ejecutado

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
    lastNodeId      = node.id;  // ← actualizar en cada salto
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
    }

    result = nextResult;
    chainCount++;
  }

  // ── Sincronizar currentNodeId con el último nodo que ejecutó ──────────
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