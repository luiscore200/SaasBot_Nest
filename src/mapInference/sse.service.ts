import { Injectable, Logger } from '@nestjs/common';
import { ReplaySubject, Observable } from 'rxjs';
import { MapflowAiSseEvent } from './types';

@Injectable()
export class MapflowAiSseService {
  private readonly logger = new Logger(MapflowAiSseService.name);

  private readonly subjects = new Map<string, ReplaySubject<MapflowAiSseEvent>>();

  // ─── Suscripción ───────────────────────────────────────────────────────────

  getStream(companyId: string): Observable<MapflowAiSseEvent> {
    return this.getOrCreate(companyId).asObservable();
  }

  // ─── Emisión ───────────────────────────────────────────────────────────────

  emit(companyId: string, event: MapflowAiSseEvent): void {
    this.getOrCreate(companyId).next(event);
    this.logger.log(
      `[SSE] company=${companyId} event=${event.event} jobId=${event.jobId}`,
    );
  }

  close(companyId: string): void {
    const subject = this.subjects.get(companyId);
    if (subject) {
      subject.complete();
      this.subjects.delete(companyId);
      this.logger.log(`[SSE] Stream cerrado (company: ${companyId})`);
    }
  }

  // ─── Helper ────────────────────────────────────────────────────────────────

  private getOrCreate(companyId: string): ReplaySubject<MapflowAiSseEvent> {
    if (!this.subjects.has(companyId)) {
      this.subjects.set(companyId, new ReplaySubject<MapflowAiSseEvent>(20));
    }
    return this.subjects.get(companyId)!;
  }
}