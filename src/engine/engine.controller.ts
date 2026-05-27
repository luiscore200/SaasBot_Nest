// ─────────────────────────────────────────────────────────────────────────────
// chat-engine.controller.ts
// ─────────────────────────────────────────────────────────────────────────────
import {
  Controller, Post, Body, Param, HttpCode, HttpStatus, Get,
} from '@nestjs/common';

import { SessionService } from './session/session.service';
import { ChatRequest, ChatResponse } from './engine.types';
import { EngineService } from './engine.service';

/**
 * Endpoint principal para el canal widget.
 * El script embebido llama a POST /chat/widget/:botConfigId
 * con { message, sessionId?, visitorId }.
 *
 * Cuando integres WhatsApp, crearás un WhatsAppController separado
 * que resuelve el botConfigId por phoneNumberId y llama a ChatEngine.process()
 * con channel='whatsapp' — este controller no cambia.
 */
@Controller('chat')
export class EngineController {
  constructor(
    private readonly engine: EngineService,
    private readonly sessionManager: SessionService,
  ) {}

  @Post('widget/:company_id/:botConfigId')
  @HttpCode(HttpStatus.OK)
  async widgetChat(
    @Param('company_id') companyId: string,
    @Param('botConfigId') botConfigId: string,
    @Body() body: ChatRequest,
  ): Promise<ChatResponse> {
    return this.engine.process(companyId,botConfigId, body, 'widget');
  }
  

  /** Endpoint de diagnóstico — útil en desarrollo */
  @Get('stats')
  stats() {
    return this.sessionManager.getStats();
  }
}