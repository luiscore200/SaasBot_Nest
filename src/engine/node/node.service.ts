// ─────────────────────────────────────────────────────────────────────────────
// engine/node/node.service.ts
// ─────────────────────────────────────────────────────────────────────────────
import { Injectable, Logger } from '@nestjs/common';
import { LLMMessage, RuntimeNode, ChatSession, FormState } from '../engine.types';
import { ChatGroqService } from '../groq/chatGroq.service';
import { DataResolverService } from './output/dataResolver.service';
import { runOutputNode } from './output/output.handler';

export interface NodeResult {
  message: string;
  data: FormState;
  done: boolean;
  nextNodeId?: string;
  intent?: string;
}

export interface RunnerContext {
  session: ChatSession;
  node: RuntimeNode;
  userMessage: string;
  contextMessages: LLMMessage[];
}

@Injectable()
export class NodeService {
  private readonly logger = new Logger(NodeService.name);

  constructor(
    private readonly groq: ChatGroqService,
    private readonly dataResolver: DataResolverService,
  ) {}

  async run(ctx: RunnerContext): Promise<NodeResult> {
    this.logger.debug(`Ejecutando nodo id="${ctx.node.id}" type="${ctx.node.type}"`);
    switch (ctx.node.type) {
      case 'conversationNode': return this.runConversation(ctx);
      case 'intentNode':       return this.runIntent(ctx);
      case 'inputNode':        return this.runInput(ctx);
      case 'outputNode':       return this.runOutput(ctx);
      case 'routerNode':       return this.runRouter(ctx);
      case 'confirmationNode': return this.runConfirmation(ctx);
      case 'fallbackNode':     return this.runFallback(ctx);
      case 'goToNode':         return this.runGoTo(ctx);
      default:
        this.logger.warn(`Nodo desconocido "${ctx.node.type}" — fallback`);
        return this.runFallback(ctx);
    }
  }

  // ── conversationNode ───────────────────────────────────────────────────────

  private async runConversation(ctx: RunnerContext): Promise<NodeResult> {
    const { data } = ctx.node;
    const nodeType = data.type as string | undefined;

    if (nodeType === 'start' || data.mode === 'template') {
      return {
        message: this.resolveTemplate(
          data.message ?? '¡Hola! ¿en qué puedo ayudarte?',
          ctx.session.formState,
        ),
        data: {},
        done: true,
        nextNodeId: ctx.node.next?.[0],
      };
    }

    const llmResponse = await this.groq.respond(ctx.contextMessages, ctx.userMessage);
    return {
      message:    llmResponse.message,
      data:       llmResponse.data,
      done:       true,
      nextNodeId: ctx.node.next?.[0],
    };
  }

  // ── intentNode ─────────────────────────────────────────────────────────────

  private async runIntent(ctx: RunnerContext): Promise<NodeResult> {
    const { data } = ctx.node;

    const llmResponse = await this.groq.respond(ctx.contextMessages, ctx.userMessage);
    const intent = llmResponse.intent?.trim();

    // LOG DETALLADO — ver exactamente qué devuelve el LLM
    this.logger.log(
      `[intentNode] id="${ctx.node.id}"\n` +
      `  userMessage : "${ctx.userMessage}"\n` +
      `  llm.message : "${llmResponse.message}"\n` +
      `  llm.intent  : "${intent ?? 'undefined'}"\n` +
      `  llm.done    : ${llmResponse.done}\n` +
      `  branches    : ${JSON.stringify(Object.keys(ctx.node.branches ?? {}))}\n` +
      `  match       : ${intent && ctx.node.branches?.[intent] ? `YES → "${ctx.node.branches[intent]}"` : 'NO'}`,
    );

    // Intent válido → avanzar
    if (intent && ctx.node.branches?.[intent]) {
      this.clearRetries(ctx.session, ctx.node.id);
      return {
        message:    llmResponse.message,
        data:       llmResponse.data,
        done:       true,
        nextNodeId: ctx.node.branches[intent],
        intent,
      };
    }

    const maxRetries: number = data.maxRetries ?? 3;
    const retries = this.incrementRetries(ctx.session, ctx.node.id);

    this.logger.warn(
      `[intentNode] intent "${intent}" no reconocido. ` +
      `Reintento ${retries}/${maxRetries} | fallbackBehavior="${data.fallbackBehavior}"`,
    );

    if (retries < maxRetries) {
      return {
        message:    llmResponse.message,
        data:       llmResponse.data,
        done:       false,
        nextNodeId: undefined,
        intent:     undefined,
      };
    }

    this.clearRetries(ctx.session, ctx.node.id);
    const fallbackBehavior = data.fallbackBehavior ?? 'fallback_node';

    if (fallbackBehavior === 'goto_start') {
      return {
        message:    llmResponse.message || 'Volvamos al inicio.',
        data:       {},
        done:       true,
        nextNodeId: ctx.session.config.startNode,
      };
    }

    if (fallbackBehavior === 'retry') {
      const previousNodeId = ctx.session.formState['__previousNodeId'] as string | undefined;
      return {
        message:    llmResponse.message || 'No pude entender tu solicitud. Intentemos de nuevo.',
        data:       {},
        done:       true,
        nextNodeId: previousNodeId ?? ctx.session.config.startNode,
      };
    }

    const fallbackNodeId = ctx.node.fallback ?? ctx.node.next?.[0];
    if (!fallbackNodeId) {
      return {
        message:    'No pude entender lo que necesitas. La conversación ha finalizado.',
        data:       {},
        done:       true,
        nextNodeId: undefined,
      };
    }

    return {
      message:    llmResponse.message || 'No pude identificar tu solicitud. Redirigiendo...',
      data:       {},
      done:       true,
      nextNodeId: fallbackNodeId,
    };
  }

  // ── inputNode ──────────────────────────────────────────────────────────────

private async runInput(ctx: RunnerContext): Promise<NodeResult> {
  const llmResponse = await this.groq.respond(ctx.contextMessages, ctx.userMessage);

  this.logger.log(
    `[inputNode] id="${ctx.node.id}" implicit=${ctx.node.data?.implicit}\n` +
    `  userMessage : "${ctx.userMessage}"\n` +
    `  llm.message : "${llmResponse.message}"\n` +
    `  llm.data    : ${JSON.stringify(llmResponse.data)}\n` +
    `  llm.done    : ${llmResponse.done}`,
  );

  // Si el nodo es implicit y ya encontró el valor (done=true),
  // forzar message:"" — su rol es solo extraer, no responder.
  // El outputNode siguiente es quien le habla al usuario.
  const message = (ctx.node.data?.implicit && llmResponse.done)
    ? ''
    : llmResponse.message;

  return {
    message,
    data:       llmResponse.data,
    done:       llmResponse.done,
    nextNodeId: llmResponse.done ? ctx.node.next?.[0] : undefined,
  };
}

  // ── outputNode ─────────────────────────────────────────────────────────────

  private async runOutput(ctx: RunnerContext): Promise<NodeResult> {
    return runOutputNode(ctx, this.groq, this.dataResolver);
  }

  // ── routerNode ─────────────────────────────────────────────────────────────

  private async runRouter(ctx: RunnerContext): Promise<NodeResult> {
    const llmResponse = await this.groq.respond(ctx.contextMessages, ctx.userMessage);
    const intent = llmResponse.intent?.trim();
    const nextNodeId = intent
      ? ctx.node.branches?.[intent] ?? ctx.node.next?.[0]
      : ctx.node.next?.[0];
    return {
      message: llmResponse.message,
      data:    llmResponse.data,
      done:    true,
      nextNodeId,
      intent,
    };
  }

  // ── confirmationNode ───────────────────────────────────────────────────────

  private async runConfirmation(ctx: RunnerContext): Promise<NodeResult> {
    const llmResponse = await this.groq.respond(ctx.contextMessages, ctx.userMessage);
    const intent = llmResponse.intent?.trim().toLowerCase() ?? 'rejected';
    const nextNodeId = ctx.node.branches?.[intent] ?? ctx.node.next?.[0];
    return {
      message:    llmResponse.message,
      data:       llmResponse.data,
      done:       llmResponse.done,
      nextNodeId: llmResponse.done ? nextNodeId : undefined,
      intent,
    };
  }

  // ── fallbackNode ───────────────────────────────────────────────────────────

  private async runFallback(ctx: RunnerContext): Promise<NodeResult> {
    if (ctx.node.data?.message) {
      return {
        message:    this.resolveTemplate(ctx.node.data.message, ctx.session.formState),
        data:       {},
        done:       true,
        nextNodeId: ctx.node.next?.[0],
      };
    }
    const llmResponse = await this.groq.respond(ctx.contextMessages, ctx.userMessage);
    return {
      message:    llmResponse.message,
      data:       {},
      done:       true,
      nextNodeId: ctx.node.next?.[0],
    };
  }

  // ── goToNode ───────────────────────────────────────────────────────────────

  private async runGoTo(ctx: RunnerContext): Promise<NodeResult> {
    const targetNodeId = ctx.node.data?.targetNodeId ?? ctx.node.next?.[0] ?? '';
    if (!targetNodeId) {
      this.logger.warn(`goToNode "${ctx.node.id}" sin targetNodeId`);
    }
    return { message: '', data: {}, done: true, nextNodeId: targetNodeId };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private resolveTemplate(template: string, formState: FormState): string {
    return template.replace(/\$\{form\.(\w+)\}/g, (_, key) => {
      const value = formState[key];
      return value !== null && value !== undefined ? String(value) : `[${key}]`;
    });
  }

  private retryKey(nodeId: string): string { return `__retries_${nodeId}`; }

  private incrementRetries(session: ChatSession, nodeId: string): number {
    const key     = this.retryKey(nodeId);
    const current = (session.formState[key] as number) ?? 0;
    session.formState[key] = current + 1;
    return current + 1;
  }

  private clearRetries(session: ChatSession, nodeId: string): void {
    delete session.formState[this.retryKey(nodeId)];
  }
}