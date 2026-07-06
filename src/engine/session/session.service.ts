// ─────────────────────────────────────────────────────────────────────────────
// session/session.service.ts  (v6 — lastFound por store, cache por schema)
// ─────────────────────────────────────────────────────────────────────────────
import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  ChatSession, BotRuntimeConfig, ChannelType, FormState,
  ActiveGlobalStore, LLMMessage, VisitedNodeEntry,
} from '../engine.types';

const SESSION_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly sessions     = new Map<string, ChatSession>();
  private readonly visitorIndex = new Map<string, string>();

  getOrCreate(params: { visitorId: string; channelId: string; channel: ChannelType; config: BotRuntimeConfig; sessionId?: string; }): ChatSession {
    const { visitorId, channelId, channel, config, sessionId } = params;

    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (existing && !this.isExpired(existing)) { this.touch(existing); return existing; }
    }

    const indexKey = this.buildKey(channelId, visitorId);
    const existingId = this.visitorIndex.get(indexKey);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (existing && !this.isExpired(existing)) { this.touch(existing); return existing; }
      this.visitorIndex.delete(indexKey);
    }

    return this.create({ visitorId, channelId, channel, config });
  }

  mergeFormState(sessionId: string, partial: FormState): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.formState = { ...s.formState, ...partial };
  }

  // ── OutputCache — por schemaId, dedup ──────────────────────────────────────

  appendOutputCache(sessionId: string, schemaId: string, docs: Record<string, any>[]): void {
    const s = this.sessions.get(sessionId);
    if (!s || !docs.length) return;
    const existing = s.outputCache[schemaId] ?? [];
    const existingIds = new Set(existing.map(d => String(d._id)));
    const newDocs = docs.filter(d => !existingIds.has(String(d._id)));
    if (!newDocs.length) return;
    s.outputCache[schemaId] = [...existing, ...newDocs];
    this.logger.log(`[outputCache] schemaId="${schemaId}" +${newDocs.length} → total=${s.outputCache[schemaId].length}`);
  }

  getOutputCache(sessionId: string, schemaId: string): Record<string, any>[] {
    return this.sessions.get(sessionId)?.outputCache[schemaId] ?? [];
  }

  // ── activeGlobalStores ────────────────────────────────────────────────────

  registerGlobalStore(sessionId: string, store: ActiveGlobalStore): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.activeGlobalStores = [...s.activeGlobalStores.filter(st => st.nodeId !== store.nodeId), store];
    this.logger.log(`[globalStore] REGISTER nodeId="${store.nodeId}" objectVar="${store.objectVar}"`);
  }

  closeGlobalStore(sessionId: string, nodeId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.activeGlobalStores = s.activeGlobalStores.filter(st => st.nodeId !== nodeId);
  }

  getActiveGlobalStores(sessionId: string): ActiveGlobalStore[] {
    return this.sessions.get(sessionId)?.activeGlobalStores ?? [];
  }

  /** Guarda el último resultado de búsqueda de un store — resuelve referencias
   *  implícitas ("agrégalo", "cámbialo por esa") en turnos siguientes. */
  updateStoreLastFound(sessionId: string, storeNodeId: string, docs: Record<string, any>[]): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    const idx = s.activeGlobalStores.findIndex(st => st.nodeId === storeNodeId);
    if (idx === -1) return;
    s.activeGlobalStores[idx] = { ...s.activeGlobalStores[idx], lastFound: docs };
  }

  // ── Historial ──────────────────────────────────────────────────────────────

  pushTurn(sessionId: string, userMsg: string, assistantMessages: string | string[], userMsgMeta?: Partial<Pick<LLMMessage, 'interceptedBy' | 'storeAction'>>): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    const msgs = Array.isArray(assistantMessages) ? assistantMessages : [assistantMessages];
    const nonEmpty = msgs.filter(m => m?.trim());

    s.history.push({ role: 'user', content: userMsg, ...userMsgMeta });
    if (nonEmpty.length > 0) s.history.push({ role: 'assistant', content: nonEmpty.join('\n\n') });
    s.turns += 1;
    this.touch(s);
  }

  setCurrentNode(sessionId: string, nodeId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.currentNodeId = nodeId;
  }

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
  }

  getStats() { return { activeSessions: this.sessions.size }; }

  private create(p: { visitorId: string; channelId: string; channel: ChannelType; config: BotRuntimeConfig; }): ChatSession {
    const sessionId = uuidv4();
    const formState: FormState = Object.fromEntries(p.config.formFields.map((f) => [f.name, null]));
    const session: ChatSession = {
      sessionId, visitorId: p.visitorId, channelId: p.channelId, channel: p.channel,
      company_id: p.config.company_id, config: p.config, history: [], formState,
      outputCache: {}, activeGlobalStores: [], nodeHistory: [],
      currentNodeId: p.config.startNode, turns: 0, lastActivity: Date.now(),
    };
    this.sessions.set(sessionId, session);
    this.visitorIndex.set(this.buildKey(p.channelId, p.visitorId), sessionId);
    return session;
  }

  private buildKey(channelId: string, visitorId: string) { return `${channelId}::${visitorId}`; }
  private isExpired(s: ChatSession) { return Date.now() - s.lastActivity > SESSION_TTL_MS; }
  private touch(s: ChatSession) { s.lastActivity = Date.now(); }

  appendNodeHistory(sessionId: string, entry: VisitedNodeEntry): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.nodeHistory = [...s.nodeHistory, entry].slice(-30);
  }
}