// ─────────────────────────────────────────────────────────────────────────────
// engine/chat.engine.ts  (v8 — outputNode eliminado, store con search+operations)
// ─────────────────────────────────────────────────────────────────────────────
import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { ChatbotSchema, ChatbotModel } from '../mongoose/chatbot.schema';
import { MapflowModel, MapflowModelSchema } from '../mongoose/mapflows.schema';
import { FlowRuntime, FlowRuntimeSchema } from '../mongoose/runtimes.schema';

import { SessionService } from './session/session.service';
import { ContextService } from './context/context.service';
import { NodeResult, NodeService } from './node/node.service';
import { DataResolverService } from './node/store/dataResolver.service';
import { performStoreSearch, executeStoreOperation, StoreLike } from './node/store/store.handler';

import {
  ActiveGlobalStore, BotRuntimeConfig, ChatMessage, ChatRequest, ChatResponse,
  ChatSession, FormFieldDef, FormState, LLMMessage, NodeType, PaginationEntry,
  RuntimeNode, ChannelType, StoreActionResolution, VisitedNodeEntry,
} from './engine.types';

import { ChatGroqService } from './groq/chatGroq.service';
import { PersistenceService } from 'src/common/services/percistence/persistence.service';

@Injectable()
export class EngineService {
  private readonly logger = new Logger(EngineService.name);

  constructor(
    private readonly SessionService:  SessionService,
    private readonly ContextService:  ContextService,
    private readonly NodeService:     NodeService,
    private readonly groq:            ChatGroqService,
    private readonly persistence:     PersistenceService,
    private readonly dataResolver:    DataResolverService,
  ) {}

  // ── Punto de entrada principal ─────────────────────────────────────────────

  async process(companyId: string, botConfigId: string, request: ChatRequest, channel: ChannelType = 'widget'): Promise<ChatResponse> {
    const session = await this.resolveSession(companyId, botConfigId, request, channel);

    if (session.turns >= session.config.maxTurns) {
      this.SessionService.destroy(session.sessionId);
      return this.endResponse(session, '¡Hemos llegado al límite de esta conversación!');
    }

    if (request.paginateNodeId) {
      return this.processStorePagination(session, request.paginateNodeId);
    }

    if (session.activeGlobalStores.length > 0) {
      const storeResponse = await this.processGlobalStores(session, request.message);
      if (storeResponse) return storeResponse;
    }

    const result = await this.runNodeChain(session, request.message);

    if (Object.keys(result.data).length > 0) this.SessionService.mergeFormState(session.sessionId, result.data);

    const nonEmptyTexts = result.chatMessages.map(m => m.text).filter(t => t?.trim());
    if (nonEmptyTexts.length > 0) this.SessionService.pushTurn(session.sessionId, request.message, nonEmptyTexts);

    if (result.nextNodeId) {
      this.SessionService.setCurrentNode(session.sessionId, result.nextNodeId);
      this.ensureStoreLifecycle(session, result.nextNodeId);
    }

    const conversationDone = result.done && !result.nextNodeId;
    if (conversationDone) this.SessionService.destroy(session.sessionId);

    const finalMessages = result.chatMessages.filter(m => m.text?.trim());
    if (finalMessages.length === 0 && !conversationDone) finalMessages.push({ text: 'Procesando tu solicitud...' });

    return {
      message: finalMessages[finalMessages.length - 1]?.text ?? '',
      messages: finalMessages.length > 0 ? finalMessages : [{ text: '' }],
      sessionId: session.sessionId,
      currentNode: result.nextNodeId ?? session.currentNodeId,
      formState: session.formState,
      done: conversationDone,
    };
  }

  // ── Lifecycle de stores flotantes ───────────────────────────────────────────

  private ensureStoreLifecycle(session: ChatSession, nodeId: string): void {
    const node = session.config.runtimeNodes[nodeId];
    if (!node) return;

    const initIds: string[] = node.data?.initStores ?? [];
    const finishIds: string[] = node.data?.finishStores ?? [];

    for (const storeNodeId of initIds) {
      if (session.activeGlobalStores.some(s => s.nodeId === storeNodeId)) continue;
      const storeDef = session.config.runtimeNodes[storeNodeId];
      if (!storeDef || storeDef.type !== 'storeNode') {
        this.logger.warn(`[storeLifecycle] initStores en "${nodeId}" referencia "${storeNodeId}" inválido`);
        continue;
      }
      this.registerStoreFromNode(session, storeDef);
    }
    for (const storeNodeId of finishIds) {
      this.SessionService.closeGlobalStore(session.sessionId, storeNodeId);
    }
  }

  private registerStoreFromNode(session: ChatSession, storeDef: RuntimeNode): void {
    const d = storeDef.data ?? {};
    const objectVar: string = d.objectVar ?? '';
    if (!objectVar) { this.logger.warn(`[storeLifecycle] storeNode="${storeDef.id}" sin objectVar`); return; }

    if (!(objectVar in session.formState)) {
      this.SessionService.mergeFormState(session.sessionId, { [objectVar]: d.isArray ? [] : null });
    }

    const store: ActiveGlobalStore = {
      nodeId: storeDef.id, objectVar, schemas: d.schemas ?? [], isArray: d.isArray ?? false,
      storePermissions: d.storePermissions ?? { create: false, show: false, delete: false, update: false },
      search: d.search ?? false, searchOutput: d.searchOutput,
      feedbackVisible: d.feedbackVisible ?? false, feedbackMessage: d.feedbackMessage,
      llmDescription: d.llmDescription,
    };
    this.SessionService.registerGlobalStore(session.sessionId, store);
  }

  // ── Intercepción de stores globales ───────────────────────────────────────

  private async processGlobalStores(session: ChatSession, userMessage: string): Promise<ChatResponse | null> {
    const resolution = session.activeGlobalStores.length === 1
      ? await this.evaluateSingleStore(session.activeGlobalStores[0], session, userMessage)
      : await this.resolveStoreAction(session.activeGlobalStores, session, userMessage);

    if (!resolution.matched || !resolution.storeNodeId) return null;
    const store = session.activeGlobalStores.find(s => s.nodeId === resolution.storeNodeId);
    if (!store) return null;

    const messages: ChatMessage[] = [];

    // ── Paso 1: búsqueda (list dispara pipeline propio con paginación) ────
    if (resolution.search.intent === 'list') {
      return this.processStoreListSearch(session, store, userMessage);
    }

    if (resolution.search.intent === 'query' && resolution.search.query) {
      const storeLike: StoreLike = { ...store };
      const searchResult = await performStoreSearch(storeLike, 'query', resolution.search.query, session, this.dataResolver, this.SessionService);
      this.SessionService.updateStoreLastFound(session.sessionId, store.nodeId, searchResult.docs);
      if (searchResult.message) messages.push({ text: searchResult.message });
    }

    // ── Paso 2: operaciones ────────────────────────────────────────────────
    const freshStore = this.SessionService.get(session.sessionId)!.activeGlobalStores.find(s => s.nodeId === store.nodeId)!;

    for (const op of resolution.operations) {
      const result = executeStoreOperation(freshStore, op, session, this.SessionService);
      if (freshStore.feedbackVisible && result.feedbackText) messages.push({ text: result.feedbackText });
      if (Object.keys(result.formPatch).length) this.SessionService.mergeFormState(session.sessionId, result.formPatch);
    }

    if (!messages.length) return null;

    this.SessionService.pushTurn(session.sessionId, userMessage, messages.map(m => m.text), { interceptedBy: store.nodeId });

    const freshSession = this.SessionService.get(session.sessionId)!;
    const resumeAnchor = this.findResumeAnchorNode(freshSession);
    if (resumeAnchor) this.SessionService.setCurrentNode(freshSession.sessionId, resumeAnchor.nodeId);

    const resumeResult = await this.runNodeChain(freshSession, '');
    const resumeMessage = resumeResult.message?.trim() ? resumeResult.message : resumeAnchor?.message ?? '';
    if (resumeMessage) messages.push({ text: resumeMessage });

    if (resumeResult.nextNodeId) {
      this.SessionService.setCurrentNode(freshSession.sessionId, resumeResult.nextNodeId);
      this.ensureStoreLifecycle(freshSession, resumeResult.nextNodeId);
    }

    return {
      message: messages[messages.length - 1]?.text ?? '',
      messages: messages.length > 0 ? messages : [{ text: '' }],
      sessionId: freshSession.sessionId,
      currentNode: resumeResult.nextNodeId ?? freshSession.currentNodeId,
      formState: freshSession.formState,
      done: false,
    };
  }

  /** "Muéstrame todo" — list search con paginación, gestionada igual que el
   *  botón "ver más" del viejo outputNode pero indexado por storeNodeId. */
  private async processStoreListSearch(session: ChatSession, store: ActiveGlobalStore, userMessage: string): Promise<ChatResponse> {
    const storeLike: StoreLike = { ...store };
    const result = await performStoreSearch(storeLike, 'list', '', session, this.dataResolver, this.SessionService);

    this.SessionService.pushTurn(session.sessionId, userMessage, result.message ? [result.message] : [], { interceptedBy: store.nodeId });

    const messages: ChatMessage[] = result.message ? [{ text: result.message, pagination: result.hasMore ? { nodeId: store.nodeId, hasMore: true, currentPage: result.currentPage ?? 1 } : undefined }] : [];

    return {
      message: messages[messages.length - 1]?.text ?? '',
      messages: messages.length ? messages : [{ text: '' }],
      sessionId: session.sessionId,
      currentNode: session.currentNodeId,
      formState: session.formState,
      done: false,
    };
  }

  /** Paginación de un storeNode (flotante o inline) — "ver más" */
  private async processStorePagination(session: ChatSession, storeNodeId: string): Promise<ChatResponse> {
    const activeStore = session.activeGlobalStores.find(s => s.nodeId === storeNodeId);
    const nodeDef = session.config.runtimeNodes[storeNodeId];

    const store: ActiveGlobalStore | null = activeStore ?? (nodeDef?.type === 'storeNode' ? {
      nodeId: storeNodeId, objectVar: nodeDef.data.objectVar ?? '', schemas: nodeDef.data.schemas ?? [],
      isArray: nodeDef.data.isArray ?? false, storePermissions: nodeDef.data.storePermissions,
      search: nodeDef.data.search ?? false, searchOutput: nodeDef.data.searchOutput,
      feedbackVisible: false,
    } : null);

    if (!store) {
      this.logger.warn(`[paginate] storeNodeId="${storeNodeId}" no es un store válido`);
      return this.endResponse(session, 'No se pudo cargar más información.');
    }

    return this.processStoreListSearch(session, store, '[ver más]');
  }

  // ── Clasificación — 2+ stores activos ─────────────────────────────────────

  private async resolveStoreAction(stores: ActiveGlobalStore[], session: ChatSession, userMessage: string): Promise<StoreActionResolution> {
    const permLabel: Record<string, string> = { create: 'agregar ítems nuevos', show: 'ver/listar el contenido', delete: 'eliminar ítems', update: 'editar ítems existentes' };

    const block = stores.map(s => {
      const current = this.formatStoreContentReadable(session.formState[s.objectVar]);
      const perms = Object.entries(s.storePermissions ?? {}).filter(([, v]) => v).map(([k]) => permLabel[k] ?? k).join(', ') || '(ninguno)';
      return [
        `[Store nodeId="${s.nodeId}"]`,
        `  descripción: ${s.llmDescription || '(sin descripción)'}`,
        `  contenido actual: ${current}`,
        `  permisos de colección: ${perms}`,
        `  búsqueda habilitada: ${s.search ? 'sí' : 'no'}`,
      ].join('\n');
    }).join('\n\n---\n\n');

    return this.callStoreActionLLM(block, userMessage);
  }

  private async evaluateSingleStore(store: ActiveGlobalStore, session: ChatSession, userMessage: string): Promise<StoreActionResolution> {
    const permLabel: Record<string, string> = { create: 'agregar ítems nuevos', show: 'ver/listar el contenido', delete: 'eliminar ítems', update: 'editar ítems existentes' };
    const current = this.formatStoreContentReadable(session.formState[store.objectVar]);
    const perms = Object.entries(store.storePermissions ?? {}).filter(([, v]) => v).map(([k]) => permLabel[k] ?? k).join(', ') || '(ninguno)';

    const block = [
      `[Store nodeId="${store.nodeId}"]`,
      `  descripción: ${store.llmDescription || '(sin descripción)'}`,
      `  contenido actual: ${current}`,
      `  permisos de colección: ${perms}`,
      `  búsqueda habilitada: ${store.search ? 'sí' : 'no'}`,
    ].join('\n');

    return this.callStoreActionLLM(block, userMessage);
  }

  private async callStoreActionLLM(storesBlock: string, userMessage: string): Promise<StoreActionResolution> {
    const prompt = `Analiza el mensaje del usuario respecto a los siguientes store(s)/colección(es).

Mensaje del usuario: "${userMessage}"

${storesBlock}

Responde en dos partes:

1. search: ¿el usuario quiere CONSULTAR el catálogo? (solo si el store tiene
   "búsqueda habilitada: sí")
   - "query": busca un ítem puntual (ej: "¿tienen ibuprofeno?")
   - "list": quiere ver todo el catálogo (ej: "muéstrame todo")
   - "none": no hay intención de consulta en este mensaje

2. operations: lista de acciones sobre la colección (según los "permisos de
   colección" de CADA store). Tipos válidos: "insert", "edit", "delete", "show".
   - Si una operación usa el resultado de la búsqueda de este mismo mensaje,
     usa el MISMO texto en "item" que en search.query.
   - Si el usuario usa una referencia implícita ("agrégalo", "esa",
     "cámbiala"), deja "item" vacío.
   - Para "edit"/"delete", "target" es el ítem YA existente en la colección.

3. Si el mensaje no aplica a ningún store (pregunta general, saludo, u otro
   tema no relacionado a búsqueda ni a la colección): matched: false.

Responde ÚNICAMENTE con JSON (sin markdown):
{
  "matched": true,
  "storeNodeId": "<nodeId o null>",
  "search": {"intent": "none"|"query"|"list", "query": ""},
  "operations": [{"type": "insert"|"edit"|"delete"|"show", "target": "", "item": ""}]
}`;

    try {
      const result = await this.groq.rawCall<StoreActionResolution>(prompt, userMessage);
      if (!result || typeof result.matched !== 'boolean') {
        return { matched: false, storeNodeId: null, search: { intent: 'none', query: '' }, operations: [] };
      }
      return {
        matched: result.matched,
        storeNodeId: result.matched ? result.storeNodeId : null,
        search: result.search ?? { intent: 'none', query: '' },
        operations: Array.isArray(result.operations) ? result.operations : [],
      };
    } catch (err: any) {
      this.logger.error(`[callStoreActionLLM] error: ${err.message}`);
      return { matched: false, storeNodeId: null, search: { intent: 'none', query: '' }, operations: [] };
    }
  }

  private formatStoreContentReadable(value: any): string {
    if (value === null || value === undefined) return '(vacío)';
    if (Array.isArray(value)) {
      if (!value.length) return '(vacío)';
      const names = value.map((e: any) => { const d = e?.data ?? e ?? {}; return d.nombre ?? d.name ?? d.label ?? String(Object.values(d)[0] ?? ''); }).filter(Boolean);
      return names.length ? names.join(', ') : `${value.length} ítem(s)`;
    }
    if (typeof value === 'object') {
      const d = (value as any)?.data ?? value;
      return d.nombre ?? d.name ?? d.label ?? JSON.stringify(value);
    }
    return String(value);
  }

  // ── Nodos que avanzan automáticamente ────────────────────────────────────

  private readonly AUTO_ADVANCE_NODES: NodeType[] = [
    'goToNode', 'fallbackNode', 'routerNode', 'conversationNode', 'insertNode', 'apiNode', 'storeNode',
  ];
  private readonly RESUME_ANCHOR_TYPES: NodeType[] = ['conversationNode', 'inputNode', 'confirmationNode'];

  private pushNodeHistory(session: ChatSession, nodeId: string, type: NodeType, message: string, turn: number): void {
    if (!this.RESUME_ANCHOR_TYPES.includes(type) || !message?.trim()) return;
    this.SessionService.appendNodeHistory(session.sessionId, { nodeId, type, message: message.trim(), turn });
  }

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

  private async runNodeChain(session: ChatSession, userMessage: string): Promise<NodeResult & { data: FormState; chatMessages: ChatMessage[]; lastNodeId: string }> {
    let node = await this.resolveCurrentNode(session);
    this.ensureStoreLifecycle(session, node.id);

    let contextMessages = this.ContextService.build(session, node);
    let lastNodeId = node.id;

    if (node.type !== 'intentNode') session.formState['__previousNodeId'] = session.currentNodeId;

    let result = await this.NodeService.run({ session, node, userMessage, contextMessages });
    if (Object.keys(result.data).length > 0) this.SessionService.mergeFormState(session.sessionId, result.data);

    const chatMessages: ChatMessage[] = [];
    if (result.message.trim()) {
      chatMessages.push(this.buildChatMessage(result, node));
      this.pushNodeHistory(session, node.id, node.type as NodeType, result.message, session.turns);
    }

    const MAX_CHAIN = 5;
    let chainCount = 0;

    while (result.done && result.nextNodeId && chainCount < MAX_CHAIN) {
      const nextNode = session.config.runtimeNodes[result.nextNodeId];
      if (!nextNode) break;

      this.ensureStoreLifecycle(session, result.nextNodeId);

      const isImplicitInput = nextNode.type === 'inputNode' && nextNode.data?.implicit === true;
      const isAutoConfirmation = nextNode.type === 'confirmationNode' && chatMessages.filter(m => m.text?.trim()).length === 0;

      if (!this.AUTO_ADVANCE_NODES.includes(nextNode.type as NodeType) && !isImplicitInput && !isAutoConfirmation) break;
      if (this.shouldBlockConversationNode(nextNode)) break;

      session = { ...session, currentNodeId: result.nextNodeId, formState: this.SessionService.get(session.sessionId)?.formState ?? session.formState };

      node = nextNode;
      lastNodeId = node.id;
      contextMessages = this.ContextService.build(session, node);

      if (node.type !== 'intentNode') session.formState['__previousNodeId'] = session.currentNodeId;

      const nextResult = await this.NodeService.run({ session, node, userMessage, contextMessages });
      if (Object.keys(nextResult.data).length > 0) this.SessionService.mergeFormState(session.sessionId, nextResult.data);

      if (nextResult.message.trim()) {
        chatMessages.push(this.buildChatMessage(nextResult, node));
        this.pushNodeHistory(session, node.id, node.type as NodeType, nextResult.message, session.turns);
      }

      result = nextResult;
      chainCount++;
    }

    this.SessionService.setCurrentNode(session.sessionId, lastNodeId);

    return { ...result, message: chatMessages[chatMessages.length - 1]?.text ?? '', chatMessages, data: session.formState, lastNodeId };
  }

  private buildChatMessage(result: NodeResult, node: RuntimeNode): ChatMessage {
    const msg: ChatMessage = { text: result.message.trim() };
    if (node.type === 'storeNode' && result.pagination?.hasMore) msg.pagination = result.pagination;
    return msg;
  }

  private shouldBlockConversationNode(node: RuntimeNode): boolean {
    if (node.type !== 'conversationNode') return false;
    return (node.data?.type as string | undefined) === 'question';
  }

  // ── Resolución de sesión / config (sin cambios respecto a v7) ─────────────

  private async resolveSession(companyId: string, botConfigId: string, request: ChatRequest, channel: ChannelType): Promise<ChatSession> {
    if (request.sessionId) {
      const existing = this.SessionService.get(request.sessionId);
      if (existing) return existing;
    }
    const config = await this.loadBotConfig(companyId, botConfigId);
    return this.SessionService.getOrCreate({ visitorId: request.visitorId, channelId: botConfigId, channel, config, sessionId: request.sessionId });
  }

  private async loadBotConfig(companyId: string, botConfigId: string): Promise<BotRuntimeConfig> {
    const botModel = await this.persistence.getTenantModel<ChatbotModel>(companyId, 'BotConfig', ChatbotSchema);
    const bot = await botModel.findById(botConfigId).lean<ChatbotModel & { _id: any }>().exec();
    if (!bot || bot.deleted || !bot.active) throw new NotFoundException({ message: 'Bot no encontrado o inactivo.', details: `botConfigId: ${botConfigId}` });

    const mapFlowModel = await this.persistence.getTenantModel<MapflowModel>(companyId, 'Mapflow', MapflowModelSchema);
    const mapflow = await mapFlowModel.findById(bot.mapflowId.toString()).lean<MapflowModel & { _id: any }>().exec();
    if (!mapflow || mapflow.deleted || !mapflow.active) throw new NotFoundException({ message: 'Mapflow del bot no encontrado o inactivo.', details: `mapflowId: ${bot.mapflowId}` });

    const runtimeModel = await this.persistence.getTenantModel<FlowRuntime>(companyId, 'FlowRuntime', FlowRuntimeSchema);
    const flowRuntime = await runtimeModel.findOne({ flowDefinitionId: bot.mapflowId.toString(), active: true }).sort({ version: -1 }).lean<FlowRuntime & { _id: any }>().exec();
    if (!flowRuntime) throw new NotFoundException({ message: 'FlowRuntime no encontrado para este mapflow.', details: `mapflowId: ${bot.mapflowId}` });

    const formFields: FormFieldDef[] = (mapflow.formFields ?? []).map((f: any) => ({ name: f.name, type: f.type, label: f.label ?? f.name, required: f.required ?? false }));

    return {
      botConfigId: String(bot._id), company_id: bot.company_id, name: bot.name, description: bot.description,
      instructions: bot.instructions, type: bot.type, maxTurns: bot.maxTurns, selectedSchemas: bot.selectedSchemas ?? [],
      mapflowId: String(bot.mapflowId), formFields, startNode: flowRuntime.startNode,
      runtimeNodes: flowRuntime.nodes as Record<string, RuntimeNode>,
    };
  }

  private async resolveCurrentNode(session: ChatSession): Promise<RuntimeNode> {
    const node = session.config.runtimeNodes[session.currentNodeId];
    if (!node) throw new NotFoundException({ message: 'Nodo no encontrado en el FlowRuntime.', details: `nodeId: ${session.currentNodeId}` });
    return node;
  }

  private endResponse(session: ChatSession, text: string): ChatResponse {
    return { message: text, messages: [{ text }], sessionId: session.sessionId, currentNode: session.currentNodeId, formState: session.formState, done: true };
  }
}