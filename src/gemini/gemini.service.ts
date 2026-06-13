import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GroqMessage,
  GroqChatOptions,
  GroqChatResult,
  GroqEmbedOptions,
  GroqEmbedResult,
  GroqInstanceConfig,
} from '../groq/groq.types';

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);

  private readonly apiKey: string;
  private readonly defaultChatModel: string;
  private readonly defaultEmbedModel: string;

  private readonly BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(private readonly config: ConfigService) {
    this.apiKey           = this.config.getOrThrow<string>('GEMINI_API_KEY');
    this.defaultChatModel = this.config.get<string>('GEMINI_CHAT_MODEL', 'gemini-2.0-flash');
    this.defaultEmbedModel = this.config.get<string>('GEMINI_EMBED_MODEL', 'text-embedding-004');
  }

  // ─── chat ─────────────────────────────────────────────────────────────────

  async chat(
    messages: GroqMessage[],
    options: GroqChatOptions = {},
  ): Promise<GroqChatResult> {
    const model = options.model ?? this.defaultChatModel;

    // Separar system prompt del resto
    const systemMsg  = messages.find(m => m.role === 'system');
    const turnMsgs   = messages.filter(m => m.role !== 'system');

    // Convertir al formato de Gemini
    const contents = turnMsgs.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body: Record<string, any> = {
      contents,
      generationConfig: {
        temperature:     options.temperature     ?? 0.7,
        maxOutputTokens: options.maxCompletionTokens ?? 1024,
        topP:            options.topP            ?? 1,
        ...(options.responseFormat === 'json_object' && {
          responseMimeType: 'application/json',
        }),
      },
    };

    if (systemMsg) {
      body.systemInstruction = {
        parts: [{ text: systemMsg.content }],
      };
    }

    const url = `${this.BASE_URL}/models/${model}:generateContent?key=${this.apiKey}`;

    try {
      const res  = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Gemini HTTP ${res.status}: ${err}`);
      }

      const json = await res.json();
      const content = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const usage   = json.usageMetadata ?? {};

      return {
        content,
        model,
        usage: {
          promptTokens:     usage.promptTokenCount     ?? 0,
          completionTokens: usage.candidatesTokenCount ?? 0,
          totalTokens:      usage.totalTokenCount      ?? 0,
        },
      };
    } catch (error: any) {
      this.logger.error(`[GeminiService.chat] ${error.message}`);
      throw new InternalServerErrorException({
        message: 'Error al comunicarse con Gemini (chat).',
        details: error.message,
      });
    }
  }

  // ─── chatStructured ───────────────────────────────────────────────────────

  async chatStructured<T = Record<string, any>>(
    messages: GroqMessage[],
    options: GroqChatOptions = {},
  ): Promise<{ data: T; raw: GroqChatResult }> {
    const raw = await this.chat(messages, { ...options, responseFormat: 'json_object' });

    try {
      // Gemini a veces envuelve el JSON en ```json ... ```
      const clean = raw.content.replace(/^```json\s*/i, '').replace(/```$/,'').trim();
      const data  = JSON.parse(clean) as T;
      return { data, raw };
    } catch {
      this.logger.error(`[GeminiService.chatStructured] JSON inválido: ${raw.content}`);
      throw new InternalServerErrorException({
        message: 'Gemini devolvió un JSON malformado.',
        details: raw.content,
      });
    }
  }

  // ─── embed ────────────────────────────────────────────────────────────────

  async embed(
    text: string,
    options: GroqEmbedOptions = {},
  ): Promise<GroqEmbedResult> {
    const model = options.model ?? this.defaultEmbedModel;
    const url   = `${this.BASE_URL}/models/${model}:embedContent?key=${this.apiKey}`;

    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:   `models/${model}`,
          content: { parts: [{ text }] },
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Gemini embed HTTP ${res.status}: ${err}`);
      }

      const json   = await res.json();
      const vector = json.embedding?.values ?? [];

      return {
        vector,
        model,
        usage: { promptTokens: 0, totalTokens: 0 },
      };
    } catch (error: any) {
      this.logger.error(`[GeminiService.embed] ${error.message}`);
      throw new InternalServerErrorException({
        message: 'Error al generar embedding con Gemini.',
        details: error.message,
      });
    }
  }
}