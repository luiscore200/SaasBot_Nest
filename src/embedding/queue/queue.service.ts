import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { EmbeddingFieldJob, JobStatus } from '../embedding.types';

const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;      // backoff base
const POLL_INTERVAL_MS = 500;     // frecuencia del loop interno

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);

  // Map<jobId, job> — fuente de verdad del estado
  private readonly jobs = new Map<string, EmbeddingFieldJob>();

  // Cola FIFO de jobIds pendientes de procesar
  private readonly queue: string[] = [];

  // Callback que el processor registra para procesar un job
  private processor?: (job: EmbeddingFieldJob) => Promise<void>;

  private loopInterval?: ReturnType<typeof setInterval>;
  private processing = false;

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  onModuleInit() {
    this.loopInterval = setInterval(() => this.tick(), POLL_INTERVAL_MS);
    this.logger.log('EmbeddingQueueService iniciado');
  }

  onModuleDestroy() {
    if (this.loopInterval) clearInterval(this.loopInterval);
    this.logger.log('EmbeddingQueueService detenido');
  }

  // ─── Registro del processor ───────────────────────────────────────────────

  /**
   * El EmbeddingProcessorService llama esto en su init para registrar
   * la función que procesa cada job.
   */
  registerProcessor(fn: (job: EmbeddingFieldJob) => Promise<void>): void {
    this.processor = fn;
  }

  // ─── Encolar jobs ─────────────────────────────────────────────────────────

  /**
   * Recibe los campos de un schema y encola un job individual por cada campo.
   * Garantía: un job = un campo = una actualización atómica.
   */
  enqueueFields(
    companyId: string,
    schemaId: string,
    schemaName: string,
    fields: Array<{ name: string; type: string; description?: string }>,
    schemaDescription?: string,
  ): EmbeddingFieldJob[] {
    const created: EmbeddingFieldJob[] = [];

    for (const field of fields) {
      const job: EmbeddingFieldJob = {
        jobId: uuidv4(),
        schemaId,
        companyId,
        schemaName,
        schemaDescription,
        fieldName: field.name,
        fieldType: field.type as EmbeddingFieldJob['fieldType'],
        fieldDescription: field.description,
        status: 'pending',
        attempts: 0,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.jobs.set(job.jobId, job);
      this.queue.push(job.jobId);
      created.push(job);

      this.logger.debug(
        `Job encolado [${job.jobId}] schema="${schemaName}" campo="${field.name}"`,
      );
    }

    return created;
  }

  // ─── Actualización de estado (saga) ──────────────────────────────────────

  updateJob(jobId: string, patch: Partial<EmbeddingFieldJob>): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    Object.assign(job, patch, { updatedAt: new Date() });
    this.jobs.set(jobId, job);
  }

  getJob(jobId: string): EmbeddingFieldJob | undefined {
    return this.jobs.get(jobId);
  }

  // ─── Loop interno ─────────────────────────────────────────────────────────

  /**
   * Tick: toma el primer job de la cola y lo procesa.
   * Concurrencia 1 — nunca dos jobs al mismo tiempo.
   */
  private async tick(): Promise<void> {
    if (this.processing || !this.processor || this.queue.length === 0) return;

    const jobId = this.queue.shift()!;
    const job = this.jobs.get(jobId);

    if (!job) return; // job fantasma, ignorar

    if (job.status === 'qdrant_done') return; // ya completado

    this.processing = true;

    try {
      await this.processor(job);
    } catch (err: any) {
      this.handleFailure(job, err);
    } finally {
      this.processing = false;
    }
  }

  // ─── Manejo de fallos y reintentos ────────────────────────────────────────

  private handleFailure(job: EmbeddingFieldJob, err: Error): void {
    job.attempts += 1;
    job.lastError = err.message;
    job.updatedAt = new Date();

    if (job.attempts >= job.maxAttempts) {
      job.status = 'failed';
      this.jobs.set(job.jobId, job);
      this.logger.error(
        `Job [${job.jobId}] fallido tras ${job.attempts} intentos — campo="${job.fieldName}" schema="${job.schemaName}": ${err.message}`,
      );
      return;
    }

    // Reencolar con backoff exponencial
    const delay = RETRY_DELAY_MS * Math.pow(2, job.attempts - 1);
    this.logger.warn(
      `Job [${job.jobId}] fallo intento ${job.attempts}/${job.maxAttempts} — reintento en ${delay}ms`,
    );

    setTimeout(() => {
      this.queue.push(job.jobId);
    }, delay);
  }

  // ─── Inspección (útil para debug/admin) ──────────────────────────────────

  getStats(): Record<JobStatus | 'queued', number> {
    const stats: Record<string, number> = {
      pending: 0,
      llm_done: 0,
      mongo_done: 0,
      qdrant_done: 0,
      failed: 0,
      queued: this.queue.length,
    };

    for (const job of this.jobs.values()) {
      stats[job.status] = (stats[job.status] ?? 0) + 1;
    }

    return stats as Record<JobStatus | 'queued', number>;
  }
}