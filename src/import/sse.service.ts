import { Injectable, Logger } from '@nestjs/common';
import { ReplaySubject, Observable } from 'rxjs';
import { InsertionProgress } from './import.types';

// ─── Tipos de eventos ─────────────────────────────────────────────────────────

export type ImportStepName = 'parsing' | 'inference' | 'validation';

export type ImportSseEvent =
  | { event: 'step';                 data: { step: ImportStepName; status: 'started' | 'done'; detail?: string } }
  | { event: 'preview_ready';        data: { jobId: string } }
  | { event: 'progress';             data: InsertionProgress }
  | { event: 'reformulation_needed'; data: { sugerencia: string } }
  | { event: 'done';                 data: { insertados: number; errores: number; schemaId: string } }
  | { event: 'error';                data: { message: string } };

// ─── Servicio ─────────────────────────────────────────────────────────────────

@Injectable()
export class ImportSseService {
  private readonly logger = new Logger(ImportSseService.name);
  private readonly subjects = new Map<string, ReplaySubject<ImportSseEvent>>();

  // ─── Gestión de subjects ─────────────────────────────────────────────────

  getOrCreate(companyId: string): Observable<ImportSseEvent> {
    if (!this.subjects.has(companyId)) {
      this.subjects.set(companyId, new ReplaySubject<ImportSseEvent>(20));
      this.logger.log(`📡 SSE stream creado — company="${companyId}"`);
    }
    return this.subjects.get(companyId)!.asObservable();
  }

  close(companyId: string): void {
    const subject = this.subjects.get(companyId);
    if (subject) {
      subject.complete();
      this.subjects.delete(companyId);
      this.logger.log(`📡 SSE stream cerrado — company="${companyId}"`);
    }
  }

  // ─── Fase A ──────────────────────────────────────────────────────────────

  emitStep(companyId: string, step: ImportStepName, status: 'started' | 'done', detail?: string): void {
    this.emit(companyId, { event: 'step', data: { step, status, detail } });
  }

  emitPreviewReady(companyId: string, jobId: string): void {
    this.emit(companyId, { event: 'preview_ready', data: { jobId } });
  }

  // ─── Fase B ──────────────────────────────────────────────────────────────

  emitProgress(companyId: string, progress: InsertionProgress): void {
    this.emit(companyId, { event: 'progress', data: progress });
  }

  emitReformulationNeeded(companyId: string, sugerencia: string): void {
    this.emit(companyId, { event: 'reformulation_needed', data: { sugerencia } });
  }

  emitDone(companyId: string, data: { insertados: number; errores: number; schemaId: string }): void {
    this.emit(companyId, { event: 'done', data });
  }

  // ─── Compartido ───────────────────────────────────────────────────────────

  emitError(companyId: string, message: string): void {
    this.emit(companyId, { event: 'error', data: { message } });
  }

  // ─── Helper ───────────────────────────────────────────────────────────────

  private emit(companyId: string, event: ImportSseEvent): void {
    const subject = this.subjects.get(companyId);
    if (subject && !subject.closed) {
      subject.next(event);
    }
  }
}