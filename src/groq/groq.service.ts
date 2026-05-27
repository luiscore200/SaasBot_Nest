import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import type { ChatCompletionToolChoiceOption } from 'groq-sdk/resources/chat/completions';
import {
  GroqInstanceConfig,
  GroqMessage,
  GroqTool,
  GroqChatOptions,
  GroqStreamOptions,
  GroqEmbedOptions,
  GroqToolOptions,
  GroqChatResult,
  GroqEmbedResult,
  GroqToolResult,
} from './groq.types';

@Injectable()
export class GroqService {
  private readonly logger = new Logger(GroqService.name);

  private readonly instances = new Map<string, Groq>();
  private readonly globalConfig: GroqInstanceConfig;

  constructor(private readonly config: ConfigService) {
    this.globalConfig = {
      apiKey: this.config.getOrThrow<string>('GROQ_API_KEY'),
      defaultChatModel: this.config.get<string>(
        'GROQ_CHAT_MODEL',
        'llama-3.3-70b-versatile',
      ),
      defaultEmbedModel: this.config.get<string>(
        'GROQ_EMBED_MODEL',
        'nomic-embed-text-v1_5',
      ),
    };
  }

  // ─── Gestión de instancias ────────────────────────────────────────────────

  getInstance(apiKey?: string): Groq {
    const key = apiKey ?? this.globalConfig.apiKey;

    if (!this.instances.has(key)) {
      this.instances.set(key, new Groq({ apiKey: key }));
      this.logger.log(`Nueva instancia Groq registrada (key: ...${key.slice(-6)})`);
    }

    return this.instances.get(key)!;
  }

  registerInstance(instanceConfig: GroqInstanceConfig): void {
    if (!this.instances.has(instanceConfig.apiKey)) {
      this.instances.set(
        instanceConfig.apiKey,
        new Groq({ apiKey: instanceConfig.apiKey }),
      );
      this.logger.log(
        `Instancia Groq registrada (key: ...${instanceConfig.apiKey.slice(-6)})`,
      );
    }
  }

  // ─── Chat completion ──────────────────────────────────────────────────────

  async chat(
    messages: GroqMessage[],
    options: GroqChatOptions = {},
    apiKey?: string,
  ): Promise<GroqChatResult> {
    const client = this.getInstance(apiKey);
    const model = options.model ?? this.globalConfig.defaultChatModel;

    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_completion_tokens: options.maxCompletionTokens ?? 1024,
        top_p: options.topP ?? 1,
        stop: options.stop ?? null,
        stream: false,
        ...(options.responseFormat && {
          response_format: { type: options.responseFormat },
        }),
      });

      const choice = response.choices[0];

      return {
        content: choice.message.content ?? '',
        model: response.model,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
      };
    } catch (error: any) {
      this.logger.error(`[GroqService.chat] ${error.message}`, error.stack);
      throw new InternalServerErrorException({
        message: 'Error al comunicarse con Groq (chat).',
        details: error.message,
      });
    }
  }

  async chatStructured<T = Record<string, any>>(
    messages: GroqMessage[],
    options: GroqChatOptions = {},
    apiKey?: string,
  ): Promise<{ data: T; raw: GroqChatResult }> {
    const raw = await this.chat(
      messages,
      { ...options, responseFormat: 'json_object' },
      apiKey,
    );

    try {
      const data = JSON.parse(raw.content) as T;
      return { data, raw };
    } catch {
      this.logger.error(
        `[GroqService.chatStructured] JSON inválido: ${raw.content}`,
      );
      throw new InternalServerErrorException({
        message: 'Groq devolvió un JSON malformado.',
        details: raw.content,
      });
    }
  }

  async chatStream(
    messages: GroqMessage[],
    options: GroqStreamOptions = {},
    apiKey?: string,
  ) {
    const client = this.getInstance(apiKey);
    const model = options.model ?? this.globalConfig.defaultChatModel;

    try {
      return await client.chat.completions.create({
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_completion_tokens: options.maxCompletionTokens ?? 1024,
        top_p: options.topP ?? 1,
        stop: options.stop ?? null,
        stream: true,
      });
    } catch (error: any) {
      this.logger.error(`[GroqService.chatStream] ${error.message}`, error.stack);
      throw new InternalServerErrorException({
        message: 'Error al iniciar stream con Groq.',
        details: error.message,
      });
    }
  }

  // ─── Embeddings ───────────────────────────────────────────────────────────

  async embed(
    text: string,
    options: GroqEmbedOptions = {},
    apiKey?: string,
  ): Promise<GroqEmbedResult> {
    const client = this.getInstance(apiKey);
    const model = options.model ?? this.globalConfig.defaultEmbedModel;

    try {
      // El SDK acepta string | string[] | number[] | number[][] | Uint8Array[]
      // Pasamos explícitamente como string para evitar conflicto de inferencia
      const response = await client.embeddings.create({
        model,
        input: text as string,
      });

      return {
        vector: response.data[0].embedding as number[],
        model: response.model,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
      };
    } catch (error: any) {
      this.logger.error(`[GroqService.embed] ${error.message}`, error.stack);
      throw new InternalServerErrorException({
        message: 'Error al generar embedding con Groq.',
        details: error.message,
      });
    }
  }

  // ─── Function calling ─────────────────────────────────────────────────────

  async chatWithTools(
    messages: GroqMessage[],
    tools: GroqTool[],
    options: GroqToolOptions = {},
    apiKey?: string,
  ): Promise<GroqToolResult> {
    const client = this.getInstance(apiKey);
    const model = options.model ?? this.globalConfig.defaultChatModel;

    // Resuelve el tool_choice al tipo correcto del SDK
    const toolChoice = this.resolveToolChoice(options.toolChoice);

    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        tools,
        tool_choice: toolChoice,
        temperature: options.temperature ?? 0.3,
        max_completion_tokens: options.maxCompletionTokens ?? 1024,
        top_p: options.topP ?? 1,
        stop: options.stop ?? null,
        stream: false,
      });

      const choice = response.choices[0];
      const message = choice.message;

      return {
        content: message.content ?? null,
        toolCalls: (message.tool_calls ?? []).map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
        model: response.model,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
      };
    } catch (error: any) {
      this.logger.error(
        `[GroqService.chatWithTools] ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException({
        message: 'Error al comunicarse con Groq (function calling).',
        details: error.message,
      });
    }
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────

  /**
   * Convierte el toolChoice string del caller al tipo
   * ChatCompletionToolChoiceOption que espera el SDK de Groq.
   */
  private resolveToolChoice(
    toolChoice?: string,
  ): ChatCompletionToolChoiceOption {
    if (!toolChoice || toolChoice === 'auto') return 'auto';
    if (toolChoice === 'none') return 'none';
    if (toolChoice === 'required') return 'required';

    // Nombre de función específica
    return {
      type: 'function',
      function: { name: toolChoice },
    };
  }
}