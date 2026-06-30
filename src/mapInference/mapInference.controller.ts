// ─────────────────────────────────────────────────────────────────────────────
// mapflow-ai.controller.ts
// ─────────────────────────────────────────────────────────────────────────────

import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Sse,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { MapflowAiService } from './mapInference.service';
import { CreateMapflowAiDto } from './types';

@Controller('mapflow/ia')
export class MapflowAiController {
   private readonly logger = new Logger(MapflowAiController.name);
  constructor(private readonly service: MapflowAiService) {}

  /** Inicia la generación — encola el job y arranca el pipeline LLM */
  @Post(':companyId')
  @HttpCode(HttpStatus.ACCEPTED)
  startGeneration(
    @Param('companyId') companyId: string,
    @Body() dto: CreateMapflowAiDto,
  ) {
      this.logger.log(`DTO recibido: ${JSON.stringify(dto)}`);
    return this.service.startGeneration(companyId, dto);
  } 

  /** Estado actual del job — incluye el output cuando status=preview_ready */
  @Get(':companyId/job')
  getJob(@Param('companyId') companyId: string) {
    return this.service.getJob(companyId);
  }

  /** Descarta el job activo (el cliente cerró el preview sin confirmar) */
  @Delete(':companyId/job')
  discardJob(@Param('companyId') companyId: string) {
    return this.service.discardJob(companyId);
  }

  /** Stream SSE de progreso: queued → generating → preview_ready | error */
  @Sse(':companyId/stream')
  getStream(@Param('companyId') companyId: string): Observable<MessageEvent> {
    return this.service.getStream(companyId);
  }
}

