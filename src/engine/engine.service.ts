// ─────────────────────────────────────────────────────────────────────────────
// engine/chat.engine.ts  (v4 — mensajes tipados con paginación por burbuja)
// ─────────────────────────────────────────────────────────────────────────────
import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { ChatbotSchema, ChatbotModel } from '../mongoose/chatbot.schema';
import { MapflowModel, MapflowModelSchema } from '../mongoose/mapflows.schema';
import { FlowRuntime, FlowRuntimeSchema } from '../mongoose/runtimes.schema';

import { SessionService } from './session/session.service';
import { ContextService } from './context/context.service';
import { NodeResult, NodeService } from './node/node.service';

import {
  BotRuntimeConfig,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatSession,
  FormFieldDef,
  RuntimeNode,
  ChannelType,
  NodeType,
  FormState,
  PaginationEntry,
} from './engine.types';

import { PersistenceService } from 'src/common/services/percistence/persistence.service';

const PAGINATION_KEY = '__pagination';

@Injectable()
export class EngineService {
  private readonly logger = new Logger(EngineService.name);

  constructor(
    private readonly SessionService: SessionService,
    private readonly ContextService: ContextService,
    private readonly NodeService: NodeService,
    private readonly persistence: PersistenceService,
  ) {}

  // ── Punto de entrada principal ─────────────────────────────────────────────

  async process(
    companyId: string,
    botConfigId: string,
    request: ChatRequest,
    channel: ChannelType = 'widget',
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
    }

    const conversationDone = result.done && !result.nextNodeId;
    if (conversationDone) {
      this.SessionService.destroy(session.sessionId);
    }

    const fallback: ChatMessage = { text: 'Procesando tu solicitud...' };
    const finalMessages = result.chatMessages.filter(m => m.text?.trim());
    if (finalMessages.length === 0) finalMessages.push(fallback);

    return {
      message:     finalMessages[finalMessages.length - 1].text,
      messages:    finalMessages,
      sessionId:   session.sessionId,
      currentNode: result.nextNodeId ?? session.currentNodeId,
      formState:   session.formState,
      done:        conversationDone,
    };
  }

  // ── Procesamiento de paginación ───────────────────────────────────────────
  // Fuerza el puntero al outputNode solicitado y ejecuta el chain desde ahí.
  // El conversationNode siguiente se ejecuta en el mismo chain, así el turno
  // devuelve tanto el listado (con botón) como el mensaje de seguimiento.

  private async processPagination(
    session: ChatSession,
    nodeId: string,
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
    'outputNode', 'goToNode', 'fallbackNode', 'routerNode', 'conversationNode', 'insertNode', 'apiNode'
  ];

  // ── Chain de nodos ────────────────────────────────────────────────────────
  // Ahora acumula ChatMessage[] en lugar de string[].
  // Cada nodo genera su propio ChatMessage; el outputNode incluye pagination
  // cuando hasMore=true, lo que el frontend usa para saber exactamente en qué
  // burbuja poner el botón "ver más".

  private async runNodeChain(
    session: ChatSession,
    userMessage: string,
  ): Promise<NodeResult & { data: FormState; chatMessages: ChatMessage[] }> {
    let node = await this.resolveCurrentNode(session);
    let contextMessages = this.ContextService.build(session, node);

    if (node.type !== 'intentNode') {
      session.formState['__previousNodeId'] = session.currentNodeId;
    }

    let result = await this.NodeService.run({
      session, node, userMessage, contextMessages,
    });

    if (Object.keys(result.data).length > 0) {
      this.SessionService.mergeFormState(session.sessionId, result.data);
    }

    // Construir el ChatMessage del nodo actual
    const chatMessages: ChatMessage[] = [];
    if (result.message.trim()) {
      chatMessages.push(this.buildChatMessage(result, node));
    }

    const MAX_CHAIN = 5;
    let chainCount = 0;

    while (result.done && result.nextNodeId && chainCount < MAX_CHAIN) {
      const nextNode = session.config.runtimeNodes[result.nextNodeId];
      if (!nextNode) break;

      const isImplicitInput =
        nextNode.type === 'inputNode' && nextNode.data?.implicit === true;

      const isAutoConfirmation =
       nextNode.type === 'confirmationNode' &&
       chatMessages.filter(m => m.text?.trim()).length === 0;


      if (!this.AUTO_ADVANCE_NODES.includes(nextNode.type as NodeType) && !isImplicitInput &&   !isAutoConfirmation ) {
        break;
      }

      if (this.shouldBlockConversationNode(nextNode)) break;

      session = {
        ...session,
        currentNodeId: result.nextNodeId,
        formState: this.SessionService.get(session.sessionId)?.formState ?? session.formState,
      };

      node = nextNode;
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

    return {
      ...result,
      message:      chatMessages[chatMessages.length - 1]?.text ?? '',
      chatMessages,
      data:         session.formState,
    };
  }

  /**
   * Construye un ChatMessage a partir del resultado de un nodo.
   * Si el nodo es outputNode y tiene paginación activa, la adjunta al mensaje.
   */
  private buildChatMessage(
    result: NodeResult & { pagination?: PaginationEntry },
    node: RuntimeNode,
  ): ChatMessage {
    const msg: ChatMessage = { text: result.message.trim() };

    // La paginación solo viaja en el mensaje del outputNode que la generó
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
    companyId: string,
    botConfigId: string,
    request: ChatRequest,
    channel: ChannelType,
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