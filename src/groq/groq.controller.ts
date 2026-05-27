import {
  Controller,
  Post,
  Body,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { IsString, IsNotEmpty, IsArray, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { GroqService } from './groq.service';
import { GroqMessage } from './groq.types';

// ─── DTOs de prueba ───────────────────────────────────────────────────────────

class MessageDto implements GroqMessage {
  @IsString() role: 'system' | 'user' | 'assistant';
  @IsString() content: string;
}

class ChatDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageDto)
  messages: MessageDto[];

  @IsOptional()
  @IsString()
  model?: string;
}

class EmbedDto {
  @IsString()
  @IsNotEmpty()
  text: string;
}

// ─── Controller ───────────────────────────────────────────────────────────────

@Controller('groq-test')
export class GroqController {
  constructor(private readonly groqService: GroqService) {}

  /**
   * POST /groq-test/chat
   * Chat completion estándar — respuesta completa de una vez.
   * Body: { messages: [{ role, content }], model? }
   */
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  async chat(@Body() dto: ChatDto) {
    return this.groqService.chat(dto.messages, { model: dto.model });
  }

  /**
   * POST /groq-test/chat-structured
   * Chat con respuesta forzada en JSON.
   * Incluye un system prompt que le pide al LLM responder en formato específico.
   * Body: { messages: [{ role, content }], model? }
   */
  @Post('chat-structured')
  @HttpCode(HttpStatus.OK)
  async chatStructured(@Body() dto: ChatDto) {
    // Inyecta instrucción JSON en el system prompt si no viene uno
    const hasSystem = dto.messages.some((m) => m.role === 'system');
    const messages: GroqMessage[] = hasSystem
      ? dto.messages
      : [
          {
            role: 'system',
            content: 'Responde ÚNICAMENTE con un objeto JSON válido. Sin texto adicional.',
          },
          ...dto.messages,
        ];

    return this.groqService.chatStructured(messages, { model: dto.model });
  }

  /**
   * POST /groq-test/stream
   * Chat con streaming — envía los chunks via SSE (Server-Sent Events).
   * Body: { messages: [{ role, content }], model? }
   *
   * Para probarlo en Postman: enviar request y ver la respuesta llegando
   * en chunks. En el widget se consumirá igual via fetch + ReadableStream.
   */
  @Post('stream')
  async stream(@Body() dto: ChatDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const stream = await this.groqService.chatStream(dto.messages, {
        model: dto.model,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) {
          res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
      }

      // Señal de fin de stream
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error: any) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }

  /**
   * POST /groq-test/embed
   * Genera el vector de embedding para un texto.
   * Body: { text: string }
   */
  @Post('embed')
  @HttpCode(HttpStatus.OK)
  async embed(@Body() dto: EmbedDto) {
    const result = await this.groqService.embed(dto.text);
    return {
      model: result.model,
      dimensions: result.vector.length,
      // Solo los primeros 5 valores para no saturar la respuesta en pruebas
      vectorPreview: result.vector.slice(0, 5),
      usage: result.usage,
    };
  }
}