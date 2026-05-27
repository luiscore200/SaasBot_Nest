// ─────────────────────────────────────────────────────────────────────────────
// session/session.manager.ts  (v2 — multicanal)
// ─────────────────────────────────────────────────────────────────────────────
import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  ChatSession,
  BotRuntimeConfig,
  ChannelType,
  FormState,
} from '../engine.types';

const SESSION_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  private readonly sessions = new Map<string, ChatSession>();

  /**
   * Índice inverso — agnóstico al canal:
   *   widget    → key: `${botConfigId}::${uuidBrowser}`
   *   whatsapp  → key: `${phoneNumberId}::${+57300...}`
   */
  private readonly visitorIndex = new Map<string, string>();

  // ── Crear o recuperar ──────────────────────────────────────────────────────

  getOrCreate(params: {
    visitorId: string;
    channelId: string;
    channel: ChannelType;
    config: BotRuntimeConfig;
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

    const indexKey = this.buildKey(channelId, visitorId);
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

  // ── Mutaciones ─────────────────────────────────────────────────────────────

  mergeFormState(sessionId: string, partial: FormState): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.formState = { ...s.formState, ...partial };
  }

  pushTurn(sessionId: string, userMsg: string, assistantMsg: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.history.push({ role: 'user', content: userMsg });
    s.history.push({ role: 'assistant', content: assistantMsg });
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
    const sessionId = uuidv4();
    const formState: FormState = Object.fromEntries(
      p.config.formFields.map((f) => [f.name, null]),
    );
    const session: ChatSession = {
      sessionId, visitorId: p.visitorId, channelId: p.channelId,
      channel: p.channel, company_id: p.config.company_id,
      config: p.config, history: [], formState,
      currentNodeId: p.config.startNode, turns: 0, lastActivity: Date.now(),
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