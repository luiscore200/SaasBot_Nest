// ─────────────────────────────────────────────────────────────────────────────
// engine/groq/chatGroq.service.ts
// ─────────────────────────────────────────────────────────────────────────────
import { Injectable, Logger } from '@nestjs/common';
import { GroqService as groqq } from 'src/groq/groq.service';
import { LLMMessage, LLMStructuredResponse } from '../engine.types';
import { GeminiService } from '../../gemini/gemini.service';

@Injectable()
export class ChatGroqService {
  private readonly logger = new Logger(ChatGroqService.name);

  constructor(private readonly groq: groqq  ) {}

  // ── Contrato del engine: message / data / done / intent ───────────────────

  async respond(
    contextMessages: LLMMessage[],
    userMessage: string,
  ): Promise<LLMStructuredResponse> {
    const messages: LLMMessage[] = [
      ...contextMessages,
      { role: 'user', content: userMessage },
    ];

    try {
      const { data } = await this.groq.chatStructured<LLMStructuredResponse>(
        messages,
        { temperature: 0.4, maxCompletionTokens: 512, responseFormat: 'json_object' },
      );
      return this.validateEngineResponse(data);
    } catch (err: any) {
      this.logger.warn(`[respond] Error — usando fallback. ${err.message}`);
      return this.engineFallback();
    }
  }

  // ── Llamada cruda: JSON libre para uso interno del outputNode ─────────────

  async rawCall<T = Record<string, any>>(
    systemPrompt: string,
    userContent: string = '',
  ): Promise<T | null> {
    const userTurn = userContent.trim() || 'Genera el JSON solicitado.';

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userTurn },
    ];

    try {
      const { data } = await this.groq.chatStructured<T>(
        messages,
        { temperature: 0.1, maxCompletionTokens: 512, responseFormat: 'json_object' },
      );
      return data ?? null;
    } catch (err: any) {
      this.logger.warn(`[rawCall] LLM error: ${err.message}`);
      return null;
    }
  }

  // ── Validación del contrato del engine ────────────────────────────────────

  private validateEngineResponse(raw: any): LLMStructuredResponse {
    // El intentNode devuelve message:"" cuando reconoce el intent — es intencional.
    // Solo sustituir con fallback si el campo message no existe en absoluto
    // (respuesta malformada), no cuando es string vacío deliberado.
    const hasMessageField = typeof raw?.message === 'string';
    const messageIsEmpty  = hasMessageField && raw.message.trim() === '';
    const hasIntent       = typeof raw?.intent === 'string' && raw.intent.trim() !== '';

    let message: string;
    if (!hasMessageField) {
      // Respuesta malformada — usar fallback
      message = this.engineFallback().message;
    } else if (messageIsEmpty && !hasIntent) {
      // Vacío sin intent — probablemente error del LLM — usar fallback
      message = this.engineFallback().message;
    } else {
      // Vacío con intent (intentNode reconoció) o mensaje real — respetar
      message = raw.message.trim();
    }

    return {
      message,
      data:
        raw?.data && typeof raw.data === 'object' && !Array.isArray(raw.data)
          ? raw.data
          : {},
      done:   raw?.done === true,
      intent: hasIntent ? raw.intent.trim() : undefined,
    };
  }

  private engineFallback(): LLMStructuredResponse {
    return {
      message: 'Disculpa, no pude procesar tu mensaje. ¿Puedes intentarlo de nuevo?',
      data: {},
      done: false,
    };
  }
}