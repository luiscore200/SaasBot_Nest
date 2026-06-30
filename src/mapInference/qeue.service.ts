import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  MapflowAiJob,
  MapflowAiJobStatus,
  MapflowAiOutput,
  CreateMapflowAiDto,
} from './types';

const POLL_INTERVAL_MS = 300;

@Injectable()
export class MapflowAiQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MapflowAiQueueService.name);

  /** Un job activo por companyId */
  private readonly jobs = new Map<string, MapflowAiJob>();

  /** Cola FIFO de companyIds pendientes */
  private readonly queue: string[] = [];

  /** Callback registrado por MapflowAiService para procesar cada job */
  private processor?: (job: MapflowAiJob) => Promise<void>;

  private loopInterval?: ReturnType<typeof setInterval>;
  private processing = false;

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  onModuleInit() {
    this.loopInterval = setInterval(() => this.tick(), POLL_INTERVAL_MS);
    this.logger.log('MapflowAiQueueService iniciado');
  }

  onModuleDestroy() {
    if (this.loopInterval) clearInterval(this.loopInterval);
    this.logger.log('MapflowAiQueueService detenido');
  }

  // ─── Registro del processor ────────────────────────────────────────────────

  registerProcessor(fn: (job: MapflowAiJob) => Promise<void>): void {
    this.processor = fn;
  }

  // ─── Encolar ───────────────────────────────────────────────────────────────

  enqueue(companyId: string, dto: CreateMapflowAiDto): MapflowAiJob {
    const existing = this.jobs.get(companyId);
    if (existing) {
      throw new Error(
        `Ya existe un job activo para la compañía "${companyId}" (status: ${existing.status}). Descártalo antes de crear uno nuevo.`,
      );
    }

    const job: MapflowAiJob = {
      jobId:       uuidv4(),
      companyId,
      name:        dto.name,
      description: dto.description,
      schemaIds:   dto.schemaIds,
      status:      'pending',
      createdAt:   new Date(),
      updatedAt:   new Date(),
    };

    this.jobs.set(companyId, job);
    this.queue.push(companyId);

    this.logger.log(`Job encolado [${job.jobId}] company="${companyId}"`);
    return job;
  }

  // ─── Consulta ──────────────────────────────────────────────────────────────

  getJob(companyId: string): MapflowAiJob | undefined {
    return this.jobs.get(companyId);
  }

  hasActiveJob(companyId: string): boolean {
    const job = this.jobs.get(companyId);
    if (!job) return false;
    const terminal: MapflowAiJobStatus[] = ['preview_ready', 'failed'];
    return !terminal.includes(job.status);
  }

  // ─── Actualización de estado ───────────────────────────────────────────────

  transition(
    companyId: string,
    status: MapflowAiJobStatus,
    patch?: { output?: MapflowAiOutput; error?: string },
  ): void {
    const job = this.jobs.get(companyId);
    if (!job) return;

    job.status    = status;
    job.updatedAt = new Date();
    if (patch?.output !== undefined) job.output = patch.output;
    if (patch?.error  !== undefined) job.error  = patch.error;

    this.logger.log(
      `Job [${job.jobId}] → ${status}` +
      (patch?.error ? ` | error: ${patch.error}` : ''),
    );
  }

  // ─── Descartar ─────────────────────────────────────────────────────────────

  discard(companyId: string): boolean {
    const existed = this.jobs.has(companyId);
    this.jobs.delete(companyId);

    const idx = this.queue.indexOf(companyId);
    if (idx !== -1) this.queue.splice(idx, 1);

    if (existed) {
      this.logger.log(`Job descartado para company="${companyId}"`);
    }
    return existed;
  }

  // ─── Loop interno ──────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    if (this.processing || !this.processor || this.queue.length === 0) return;

    const companyId = this.queue.shift()!;
    const job = this.jobs.get(companyId);

    if (!job || job.status !== 'pending') return;

    this.processing = true;

    try {
      await this.processor(job);
    } catch (err: any) {
      this.logger.error(
        `Job [${job.jobId}] falló — company="${companyId}": ${err.message}`,
      );
      this.transition(companyId, 'failed', {
        error: err.message ?? 'Error desconocido',
      });
    } finally {
      this.processing = false;
    }
  }

  // ─── Debug ─────────────────────────────────────────────────────────────────

  getStats(): Record<string, number> {
    const stats: Record<string, number> = {
      pending:       0,
      generating:    0,
      preview_ready: 0,
      failed:        0,
      queued:        this.queue.length,
    };
    for (const job of this.jobs.values()) {
      stats[job.status] = (stats[job.status] ?? 0) + 1;
    }
    return stats;
  }
}