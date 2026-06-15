// ─────────────────────────────────────────────────────────────────────────────
// session/session.service.ts  (v4 — activeGlobalStores)
// ─────────────────────────────────────────────────────────────────────────────
import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  ChatSession,
  BotRuntimeConfig,
  ChannelType,
  FormState,
  OutputCache,
  ActiveGlobalStore,
  LLMMessage,
} from '../engine.types';

const SESSION_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  private readonly sessions    = new Map<string, ChatSession>();
  private readonly visitorIndex = new Map<string, string>();

  // ── Crear o recuperar ──────────────────────────────────────────────────────

  getOrCreate(params: {
    visitorId:  string;
    channelId:  string;
    channel:    ChannelType;
    config:     BotRuntimeConfig;
    sessionId?: string;
  }): ChatSession {
    const { visitorId, channelId, channel, config, sessionId } = params;

    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (existing && !this.isExpired(existing)) {
        this.touch(existing);
        return existing;
      }
    }

    const indexKey   = this.buildKey(channelId, visitorId);
    const existingId = this.visitorIndex.get(indexKey);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (existing && !this.isExpired(existing)) {
        this.touch(existing);
        return existing;
      }
      this.visitorIndex.delete(indexKey);
    }

    return this.create({ visitorId, channelId, channel, config });
  }

  // ── Mutaciones de formState ────────────────────────────────────────────────

  mergeFormState(sessionId: string, partial: FormState): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.formState = { ...s.formState, ...partial };
  }

  

  // ── OutputCache ────────────────────────────────────────────────────────────

  appendOutputCache(sessionId: string, nodeId: string, docs: Record<string, any>[]): void {
    const s = this.sessions.get(sessionId);
    if (!s || !docs.length) return;
    const existing = s.outputCache[nodeId] ?? [];
    s.outputCache[nodeId] = [...existing, ...docs];
    this.logger.log(
      `[outputCache] sessionId="${sessionId}" nodeId="${nodeId}" ` +
      `+${docs.length} docs → total=${s.outputCache[nodeId].length}`,
    );
  }

  getOutputCache(sessionId: string, nodeId: string): Record<string, any>[] {
    const s = this.sessions.get(sessionId);
    return s?.outputCache[nodeId] ?? [];
  }

  // ── activeGlobalStores ────────────────────────────────────────────────────

  /**
   * Registra un storeNode global en la sesión.
   * Llamado cuando el flujo pasa por un storeNode con isGlobal: true.
   * Si ya existe un store con el mismo nodeId, lo reemplaza (idempotente).
   */
  registerGlobalStore(sessionId: string, store: ActiveGlobalStore): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.activeGlobalStores = [
      ...s.activeGlobalStores.filter(st => st.nodeId !== store.nodeId),
      store,
    ];
    this.logger.log(
      `[globalStore] REGISTER sessionId="${sessionId}" nodeId="${store.nodeId}" ` +
      `objectVar="${store.objectVar}" permissions=${store.permissions.join(',')}`,
    );
  }

  /**
   * Cierra un store global. Se llama cuando el flujo llega al closeNodeId.
   * objectVar permanece en formState — solo se deja de interceptar.
   */
  closeGlobalStore(sessionId: string, nodeId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    const before = s.activeGlobalStores.length;
    s.activeGlobalStores = s.activeGlobalStores.filter(st => st.nodeId !== nodeId);
    const after = s.activeGlobalStores.length;
    if (before !== after) {
      this.logger.log(
        `[globalStore] CLOSE sessionId="${sessionId}" nodeId="${nodeId}" — ` +
        `stores restantes=${after}`,
      );
    }
  }

  /**
   * Devuelve los stores globales activos de la sesión.
   */
  getActiveGlobalStores(sessionId: string): ActiveGlobalStore[] {
    return this.sessions.get(sessionId)?.activeGlobalStores ?? [];
  }

  // ── Historial ──────────────────────────────────────────────────────────────

  pushTurn(
    sessionId:          string,
    userMsg:            string,
    assistantMessages:  string | string[],
    userMsgMeta?:       Partial<Pick<LLMMessage, 'interceptedBy' | 'storeAction'>>,
  ): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    const msgs     = Array.isArray(assistantMessages) ? assistantMessages : [assistantMessages];
    const nonEmpty = msgs.filter(m => m?.trim());

    this.logger.log(
      `[pushTurn] sessionId="${sessionId}"\n` +
      `  user      : "${userMsg}"\n` +
      `  assistant : ${JSON.stringify(nonEmpty)}` +
      (userMsgMeta?.interceptedBy ? `\n  interceptedBy: "${userMsgMeta.interceptedBy}"` : ''),
    );

    const userMessage: LLMMessage = {
      role:    'user',
      content: userMsg,
      ...userMsgMeta,
    };

    s.history.push(userMessage);
    if (nonEmpty.length > 0) {
      s.history.push({ role: 'assistant', content: nonEmpty.join('\n\n') });
    }
    s.turns += 1;
    this.touch(s);
  }

  setCurrentNode(sessionId: string, nodeId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.currentNodeId = nodeId;
  }

  // ── Ciclo de vida ──────────────────────────────────────────────────────────

  get(sessionId: string): ChatSession | undefined {
    const s = this.sessions.get(sessionId);
    if (!s) return undefined;
    if (this.isExpired(s)) { this.destroy(sessionId); return undefined; }
    return s;
  }

  destroy(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.visitorIndex.delete(this.buildKey(s.channelId, s.visitorId));
    this.sessions.delete(sessionId);
    this.logger.log(`Sesión destruida sessionId="${sessionId}" canal="${s.channel}"`);
  }

  getStats() { return { activeSessions: this.sessions.size }; }

  // ── Internals ──────────────────────────────────────────────────────────────

  private create(p: {
    visitorId: string; channelId: string;
    channel: ChannelType; config: BotRuntimeConfig;
  }): ChatSession {
    const sessionId  = uuidv4();
    const formState: FormState = Object.fromEntries(
      p.config.formFields.map((f) => [f.name, null]),
    );
    const session: ChatSession = {
      sessionId,
      visitorId:          p.visitorId,
      channelId:          p.channelId,
      channel:            p.channel,
      company_id:         p.config.company_id,
      config:             p.config,
      history:            [],
      formState,
      outputCache:        {},
      activeGlobalStores: [], // ← inicializado vacío
      currentNodeId:      p.config.startNode,
      turns:              0,
      lastActivity:       Date.now(),
    };
    this.sessions.set(sessionId, session);
    this.visitorIndex.set(this.buildKey(p.channelId, p.visitorId), sessionId);
    this.logger.log(`Sesión creada="${sessionId}" canal="${p.channel}" visitor="${p.visitorId}"`);
    return session;
  }

  private buildKey(channelId: string, visitorId: string) { return `${channelId}::${visitorId}`; }
  private isExpired(s: ChatSession) { return Date.now() - s.lastActivity > SESSION_TTL_MS; }
  private touch(s: ChatSession) { s.lastActivity = Date.now(); }
}