import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { DocumentIndexJob, DocumentJobStatus } from '../indexing.types';

const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
const POLL_INTERVAL_MS = 500;

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);

  private readonly jobs = new Map<string, DocumentIndexJob>();
  private readonly queue: string[] = [];
  private processor?: (job: DocumentIndexJob) => Promise<void>;
  private loopInterval?: ReturnType<typeof setInterval>;
  private processing = false;

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  onModuleInit() {
    this.loopInterval = setInterval(() => this.tick(), POLL_INTERVAL_MS);
    this.logger.log('DocumentQueueService iniciado');
  }

  onModuleDestroy() {
    if (this.loopInterval) clearInterval(this.loopInterval);
    this.logger.log('DocumentQueueService detenido');
  }

  // ─── Registro del processor ───────────────────────────────────────────────

  registerProcessor(fn: (job: DocumentIndexJob) => Promise<void>): void {
    this.processor = fn;
  }

  // ─── Encolar un documento individual ─────────────────────────────────────

  enqueueDocument(params: {
    documentId: string;
    schemaId: string;
    companyId: string;
    category: string;
    documentData: Record<string, any>;
    schemaFields: Array<{ name: string; type: string; description?: string }>;
  }): DocumentIndexJob {
    const job: DocumentIndexJob = {
      jobId: uuidv4(),
      ...params,
      status: 'pending',
      attempts: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.jobs.set(job.jobId, job);
    this.queue.push(job.jobId);

    this.logger.debug(
      `Job encolado [${job.jobId}] doc="${params.documentId}" schema="${params.schemaId}"`,
    );

    return job;
  }

  // ─── Encolar múltiples documentos (uno por uno) ───────────────────────────

  enqueueDocuments(
    docs: Array<{
      documentId: string;
      schemaId: string;
      companyId: string;
      category: string;
      documentData: Record<string, any>;
      schemaFields: Array<{ name: string; type: string; description?: string }>;
    }>,
  ): DocumentIndexJob[] {
    return docs.map((d) => this.enqueueDocument(d));
  }

  // ─── Actualización de estado (saga) ──────────────────────────────────────

  updateJob(jobId: string, patch: Partial<DocumentIndexJob>): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    Object.assign(job, patch, { updatedAt: new Date() });
    this.jobs.set(jobId, job);
  }

  getJob(jobId: string): DocumentIndexJob | undefined {
    return this.jobs.get(jobId);
  }

  // ─── Loop interno ─────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    if (this.processing || !this.processor || this.queue.length === 0) return;

    const jobId = this.queue.shift()!;
    const job = this.jobs.get(jobId);

    if (!job) return;
    if (job.status === 'mongo_done') return; // ya completado

    this.processing = true;

    try {
      await this.processor(job);
    } catch (err: any) {
      this.handleFailure(job, err);
    } finally {
      this.processing = false;
    }
  }

  // ─── Reintentos con backoff exponencial ──────────────────────────────────

  private handleFailure(job: DocumentIndexJob, err: Error): void {
    job.attempts += 1;
    job.lastError = err.message;
    job.updatedAt = new Date();

    if (job.attempts >= job.maxAttempts) {
      job.status = 'failed';
      this.jobs.set(job.jobId, job);
      this.logger.error(
        `Job [${job.jobId}] fallido tras ${job.attempts} intentos — doc="${job.documentId}": ${err.message}`,
      );
      return;
    }

    const delay = RETRY_DELAY_MS * Math.pow(2, job.attempts - 1);
    this.logger.warn(
      `Job [${job.jobId}] fallo intento ${job.attempts}/${job.maxAttempts} — reintento en ${delay}ms`,
    );

    setTimeout(() => this.queue.push(job.jobId), delay);
  }

  // ─── Inspección ──────────────────────────────────────────────────────────

  getStats(): Record<DocumentJobStatus | 'queued', number> {
    const stats: Record<string, number> = {
      pending: 0, text_done: 0, embed_done: 0,
      qdrant_done: 0, mongo_done: 0, failed: 0,
      queued: this.queue.length,
    };
    for (const job of this.jobs.values()) {
      stats[job.status] = (stats[job.status] ?? 0) + 1;
    }
    return stats as Record<DocumentJobStatus | 'queued', number>;
  }
}