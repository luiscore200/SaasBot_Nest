import { Injectable, Logger } from '@nestjs/common';
import { ReplaySubject, Observable } from 'rxjs';

// ─── Tipos de eventos ─────────────────────────────────────────────────────────

export type ImportStepName =
  | 'parsing'       // Fase 1: parseo + perfilado
  | 'inference'     // Fase 2: LLM nombres + category
  | 'validation';   // Fase 3: coerción + reformulación

export interface ImportStepEvent {
  event: 'step';
  data: {
    step: ImportStepName;
    status: 'started' | 'done';
    detail?: string;   // info extra opcional (ej: "6 columnas detectadas")
  };
}

export interface ImportPreviewReadyEvent {
  event: 'preview_ready';
  data: { jobId: string };
}

export interface ImportErrorEvent {
  event: 'error';
  data: { message: string };
}

export type ImportSseEvent =
  | ImportStepEvent
  | ImportPreviewReadyEvent
  | ImportErrorEvent;

// ─── Servicio ─────────────────────────────────────────────────────────────────

@Injectable()
export class ImportSseService {
  private readonly logger = new Logger(ImportSseService.name);
  private readonly subjects = new Map<string, ReplaySubject<ImportSseEvent>>();

  // ─── Gestión de subjects por companyId ──────────────────────────────────

  /**
   * Crea (o reutiliza) el Subject para una compañía.
   * El controller llama esto al abrir el stream.
   */
  getOrCreate(companyId: string): Observable<ImportSseEvent> {
    if (!this.subjects.has(companyId)) {
      this.subjects.set(companyId, new ReplaySubject<ImportSseEvent>(20));
      this.logger.log(`📡 SSE stream creado — company="${companyId}"`);
    }
    return this.subjects.get(companyId)!.asObservable();
  }

  /**
   * Elimina el Subject cuando el job termina o se descarta.
   */
  close(companyId: string): void {
    const subject = this.subjects.get(companyId);
    if (subject) {
      subject.complete();
      this.subjects.delete(companyId);
      this.logger.log(`📡 SSE stream cerrado — company="${companyId}"`);
    }
  }

  // ─── Emisión de eventos ──────────────────────────────────────────────────

  emitStep(
    companyId: string,
    step: ImportStepName,
    status: 'started' | 'done',
    detail?: string,
  ): void {
    this.emit(companyId, { event: 'step', data: { step, status, detail } });
  }

  emitPreviewReady(companyId: string, jobId: string): void {
    this.emit(companyId, { event: 'preview_ready', data: { jobId } });
  }

  emitError(companyId: string, message: string): void {
    this.emit(companyId, { event: 'error', data: { message } });
  }

  // ─── Helper interno ──────────────────────────────────────────────────────

  private emit(companyId: string, event: ImportSseEvent): void {
    const subject = this.subjects.get(companyId);
    if (subject && !subject.closed) {
      subject.next(event);
    }
  }
}