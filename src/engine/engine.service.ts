// ─────────────────────────────────────────────────────────────────────────────
// engine/chat.engine.ts
// ─────────────────────────────────────────────────────────────────────────────
import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

// Schemas Mongo
import { ChatbotSchema, ChatbotModel } from '../mongoose/chatbot.schema';
import { MapflowModel, MapflowModelSchema } from '../mongoose/mapflows.schema';
import { FlowRuntime, FlowRuntimeSchema } from '../mongoose/runtimes.schema';
import { WidgetConfigModel, WidgetConfigDocument } from '../mongoose/widgetConfig.schema';

// Engine internals
import { SessionService } from './session/session.service';
import { ContextService } from './context/context.service';
import { NodeResult, NodeService } from './node/node.service';

// Types
import {
  BotRuntimeConfig,
  ChatRequest,
  ChatResponse,
  ChatSession,
  FormFieldDef,
  RuntimeNode,
  ChannelType,
  NodeType,
  FormState,
} from './engine.types';
import { PersistenceService } from 'src/common/services/percistence/persistence.service';

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

    const result = await this.runNodeChain(session, request.message);

    if (Object.keys(result.data).length > 0) {
      this.SessionService.mergeFormState(session.sessionId, result.data);
    }

    // FIX: solo registrar el turno si hay un mensaje real que mostrar al usuario.
    // Un message:"" ocurre cuando el intentNode reconoce el intent y pasa
    // directo al siguiente nodo sin decirle nada al usuario — no debe quedar
    // en el historial ni emitirse como burbuja vacía.
    if (result.message.trim()) {
      this.SessionService.pushTurn(session.sessionId, request.message, result.message);
    }

    // FIX: mover el setCurrentNode AQUÍ, al final de process(), en lugar de
    // hacerlo dentro de runNodeChain. De este modo el puntero de nodo solo
    // avanza DESPUÉS de que la respuesta ya fue construida y entregada,
    // evitando que el siguiente turno del usuario encuentre el nodo en un
    // estado "ya ejecutado" cuando el mensaje anterior llegó vacío.
    if (result.nextNodeId) {
      this.SessionService.setCurrentNode(session.sessionId, result.nextNodeId);
    }

    const conversationDone = result.done && !result.nextNodeId;
    if (conversationDone) {
      this.SessionService.destroy(session.sessionId);
    }

    return {
      // FIX: nunca devolver un message vacío al cliente. Si el chain produjo
      // cadena vacía (caso raro de LLM malformado), usar un fallback genérico
      // en lugar de emitir una burbuja vacía en el frontend.
      message: result.message.trim() || 'Procesando tu solicitud...',
      sessionId: session.sessionId,
      currentNode: result.nextNodeId ?? session.currentNodeId,
      formState: session.formState,
      done: conversationDone,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Nodos que avanzan automáticamente sin esperar input del usuario.
  //
  // conversationNode se incluye aquí pero tiene lógica interna adicional:
  //   - type='start'   → siempre avanza automáticamente
  //   - type='message' → avanza automáticamente (saluda/informa y pasa)
  //   - type='question'→ BLOQUEA — espera respuesta del usuario
  //
  // La distinción la hace shouldBlockConversationNode() más abajo.
  //
  // FIX: inputNode NO estaba en esta lista, lo que causaba que el chain
  // rompiera apenas el intentNode resolvía hacia un inputNode, devolviendo
  // message:"" al cliente. Se maneja con lógica especial en el while para
  // permitir el paso solo cuando implicit=true.
  // ─────────────────────────────────────────────────────────────────────────
  private readonly AUTO_ADVANCE_NODES: NodeType[] = [
    'outputNode', 'goToNode', 'fallbackNode', 'routerNode', 'conversationNode',
  ];

  private async runNodeChain(
    session: ChatSession,
    userMessage: string,
  ): Promise<NodeResult & { data: FormState }> {
    let node = await this.resolveCurrentNode(session);
    let messages = this.ContextService.build(session, node);

    if (node.type !== 'intentNode') {
      session.formState['__previousNodeId'] = session.currentNodeId;
    }

    let result = await this.NodeService.run({ session, node, userMessage, contextMessages: messages });

    if (Object.keys(result.data).length > 0) {
      this.SessionService.mergeFormState(session.sessionId, result.data);
    }

    const MAX_CHAIN = 5;
    let chainCount = 0;

    while (result.done && result.nextNodeId && chainCount < MAX_CHAIN) {
      const nextNode = session.config.runtimeNodes[result.nextNodeId];
      if (!nextNode) break;

      // FIX: inputNode implicit se permite avanzar automáticamente.
      // Un inputNode con implicit=true busca el valor en el historial antes
      // de preguntar — si lo encuentra, devuelve done:true con message:""
      // y debe continuar hacia el outputNode sin bloquear el chain.
      // Un inputNode con implicit=false (o sin implicit) SÍ bloquea porque
      // necesita esperar la respuesta explícita del usuario.
      const isImplicitInput =
        nextNode.type === 'inputNode' && nextNode.data?.implicit === true;

      if (!this.AUTO_ADVANCE_NODES.includes(nextNode.type as NodeType) && !isImplicitInput) {
        break;
      }

      // conversationNode: solo bloquear si type='question'
      if (this.shouldBlockConversationNode(nextNode)) break;

      // FIX: NO llamar setCurrentNode aquí. El puntero se mueve en process()
      // después de que la respuesta completa ya fue construida. Actualizar
      // solo la variable local para que los siguientes nodos del chain tengan
      // el contexto correcto de sesión.
      session = {
        ...session,
        currentNodeId: result.nextNodeId,
        formState: this.SessionService.get(session.sessionId)?.formState ?? session.formState,
      };

      node = nextNode;
      messages = this.ContextService.build(session, node);

      if (node.type !== 'intentNode') {
        session.formState['__previousNodeId'] = session.currentNodeId;
      }

      const nextResult = await this.NodeService.run({
        session, node, userMessage, contextMessages: messages,
      });

      if (Object.keys(nextResult.data).length > 0) {
        this.SessionService.mergeFormState(session.sessionId, nextResult.data);
      }

      // ── Resolución del mensaje del chain ────────────────────────────────
      //
      // Reglas de concatenación:
      //
      // 1. Si alguno de los dos mensajes es vacío → usar el que tiene contenido.
      //
      // 2. Si el NODO PREVIO era un conversationNode informacional (type='message'
      //    o 'start', mode='ia') y el nodo siguiente produce un mensaje real →
      //    el mensaje del conversationNode se DESCARTA.
      //    Razón: el conversationNode con mode='ia' genera una respuesta
      //    contextual del LLM ("Sí, tenemos aspirina...") basada en el historial,
      //    pero su único rol en el flujo es hacer la transición hacia el intentNode.
      //    El mensaje real que debe llegar al usuario es el del outputNode, no el
      //    del conversationNode que "adivinó" la respuesta antes de tiempo.
      //
      // 3. Si el NODO SIGUIENTE es un conversationNode informacional →
      //    el mensaje del siguiente reemplaza al anterior (mismo razonamiento).
      //
      // 4. En cualquier otro caso con ambos mensajes presentes → concatenar.

      const prevMsg = result.message?.trim()     ?? '';
      const nextMsg = nextResult.message?.trim() ?? '';

      const prevIsInformationalConversation =
        node.type === 'conversationNode' &&
        (node.data?.type === 'message' || node.data?.type === 'start');

      const nextIsInformationalConversation =
        nextNode.type === 'conversationNode' &&
        (nextNode.data?.type === 'message' || nextNode.data?.type === 'start');

      let combinedMessage: string;
      if (!prevMsg || !nextMsg) {
        // Uno de los dos está vacío — usar el que tiene contenido
        combinedMessage = nextMsg || prevMsg;
      } else if (prevIsInformationalConversation || nextIsInformationalConversation) {
        // El conversationNode informacional cede al mensaje del otro nodo
        combinedMessage = nextMsg;
      } else {
        // Ambos tienen contenido y ninguno es conversationNode informacional
        combinedMessage = `${prevMsg}\n\n${nextMsg}`;
      }

      result = {
        ...nextResult,
        message: combinedMessage,
      };

      chainCount++;
    }

    return { ...result, data: session.formState };
  }

  /**
   * Determina si un conversationNode debe bloquear el chain y esperar
   * input del usuario, o si puede avanzar automáticamente.
   *
   * Bloquea solo cuando type='question' — el bot hizo una pregunta
   * y necesita la respuesta del usuario para continuar.
   *
   * start   → saludo inicial, avanza solo
   * message → informa/saluda con IA, avanza solo al siguiente nodo
   * question→ pregunta explícita, espera respuesta
   */
  private shouldBlockConversationNode(node: RuntimeNode): boolean {
    if (node.type !== 'conversationNode') return false;
    const nodeType = node.data?.type as string | undefined;
    return nodeType === 'question';
  }

  // ── Resolución de sesión ───────────────────────────────────────────────────

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
      name: f.name,
      type: f.type,
      label: f.label ?? f.name,
      required: f.required ?? false,
    }));

    const config: BotRuntimeConfig = {
      botConfigId: String(bot._id),
      company_id: bot.company_id,
      name: bot.name,
      description: bot.description,
      instructions: bot.instructions,
      type: bot.type,
      maxTurns: bot.maxTurns,
      selectedSchemas: bot.selectedSchemas ?? [],
      mapflowId: String(bot.mapflowId),
      formFields,
      startNode: flowRuntime.startNode,
      runtimeNodes: flowRuntime.nodes as Record<string, RuntimeNode>,
    };

    this.logger.log(
      `Config cargada — bot="${bot.name}" mapflow="${mapflow.name}" startNode="${flowRuntime.startNode}"`,
    );

    return config;
  }

  // ── Resolución de nodo actual ──────────────────────────────────────────────

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

  // ── Helpers ────────────────────────────────────────────────────────────────

  private endResponse(session: ChatSession, message: string): ChatResponse {
    return {
      message,
      sessionId: session.sessionId,
      currentNode: session.currentNodeId,
      formState: session.formState,
      done: true,
    };
  }
}