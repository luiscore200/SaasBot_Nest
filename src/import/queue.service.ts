import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ImportJob, ImportJobStatus, EnqueueImportPayload } from './import.types';

const POLL_INTERVAL_MS = 300;

@Injectable()
export class ImportQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportQueueService.name);

  // Map<companyId, ImportJob> — una sola empresa, un solo job activo
  private readonly jobs = new Map<string, ImportJob>();

  // Cola FIFO de companyIds pendientes de procesar
  private readonly queue: string[] = [];

  // Callback registrado por ImportService para procesar cada job
  private processor?: (job: ImportJob) => Promise<void>;

  private loopInterval?: ReturnType<typeof setInterval>;
  private processing = false;

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  onModuleInit() {
    this.loopInterval = setInterval(() => this.tick(), POLL_INTERVAL_MS);
    this.logger.log('ImportQueueService iniciado');
  }

  onModuleDestroy() {
    if (this.loopInterval) clearInterval(this.loopInterval);
    this.logger.log('ImportQueueService detenido');
  }

  // ─── Registro del processor ─────────────────────────────────────────────────

  registerProcessor(fn: (job: ImportJob) => Promise<void>): void {
    this.processor = fn;
  }

  // ─── Encolar ────────────────────────────────────────────────────────────────

  /**
   * Crea un job para la compañía y lo encola.
   * Si ya existe un job activo para esa compañía, lanza un error —
   * el caller debe verificar con getJobByCompany() antes de llamar esto.
   */
  enqueue(payload: EnqueueImportPayload): ImportJob {
    const existing = this.jobs.get(payload.companyId);
    if (existing) {
      throw new Error(
        `Ya existe un job activo para la compañía "${payload.companyId}" (status: ${existing.status}). Descártalo antes de crear uno nuevo.`,
      );
    }

    const job: ImportJob = {
      jobId: uuidv4(),
      companyId: payload.companyId,
      name: payload.name,
      description: payload.description,
      filePath: payload.filePath,
      originalName: payload.originalName,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.jobs.set(payload.companyId, job);
    this.queue.push(payload.companyId);

    this.logger.log(
      `Job encolado [${job.jobId}] company="${payload.companyId}" archivo="${payload.originalName}"`,
    );

    return job;
  }

  // ─── Consulta ───────────────────────────────────────────────────────────────

  getJobByCompany(companyId: string): ImportJob | undefined {
    return this.jobs.get(companyId);
  }

  // ─── Actualización de estado ────────────────────────────────────────────────

  updateJob(companyId: string, patch: Partial<ImportJob>): void {
    const job = this.jobs.get(companyId);
    if (!job) return;
    Object.assign(job, patch, { updatedAt: new Date() });
  }

  // ─── Descartar ──────────────────────────────────────────────────────────────

  /**
   * Elimina el job de la compañía del Map y de la cola.
   * El caller es responsable de borrar el archivo si corresponde.
   */
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

  // ─── Loop interno ───────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    if (this.processing || !this.processor || this.queue.length === 0) return;

    // Tomar el primer companyId de la cola
    const companyId = this.queue.shift()!;
    const job = this.jobs.get(companyId);

    if (!job) return; // job descartado antes de procesarse

    // Solo procesar si sigue pendiente (no si fue retomado en Fase B ya)
    if (job.status !== 'pending') return;

    this.processing = true;

    try {
      await this.processor(job);
    } catch (err: any) {
      this.logger.error(
        `Job [${job.jobId}] fallido — company="${companyId}": ${err.message}`,
      );
      this.updateJob(companyId, {
        status: 'failed',
        lastError: err.message ?? 'Error desconocido',
      });
    } finally {
      this.processing = false;
    }
  }

  // ─── Debug ──────────────────────────────────────────────────────────────────

  getStats(): Record<ImportJobStatus | 'queued', number> {
    const stats: Record<string, number> = {
      pending: 0,
      analyzing: 0,
      preview_ready: 0,
      loading_data: 0,
      completed: 0,
      failed: 0,
      queued: this.queue.length,
    };

    for (const job of this.jobs.values()) {
      stats[job.status] = (stats[job.status] ?? 0) + 1;
    }

    return stats as Record<ImportJobStatus | 'queued', number>;
  }
}