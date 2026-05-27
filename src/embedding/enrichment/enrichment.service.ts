import { Injectable, Logger } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';
import { EmbeddingFieldJob } from '../embedding.types';

@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);

  constructor(private readonly queue: QueueService) {}

  /**
   * Dispara el enriquecimiento de TODOS los campos de un schema.
   * Llamar después de crear un schema — no bloqueante.
   */
  enrichSchema(schema: {
    _id: string;
    company_id: string;
    name: string;
    description?: string;
    fields: Array<{ name: string; type: string }>;
  }): void {
    const jobs = this.queue.enqueueFields(
      schema.company_id,
      schema._id,
      schema.name,
      schema.fields,
      schema.description,
    );

    this.logger.log(
      `Enriquecimiento disparado — schema="${schema.name}" campos=${jobs.length}`,
    );
  }

  /**
   * Dispara el enriquecimiento solo de los campos que cambiaron.
   * Llamar después de actualizar un schema.
   * 
   * @param updatedFields Solo los campos modificados o nuevos
   */
  enrichUpdatedFields(
    schema: {
      _id: string;
      company_id: string;
      name: string;
      description?: string;
    },
    updatedFields: Array<{ name: string; type: string }>,
  ): void {
    if (!updatedFields || updatedFields.length === 0) return;

    const jobs = this.queue.enqueueFields(
      schema.company_id,
      schema._id,
      schema.name,
      updatedFields,
      schema.description,
    );

    this.logger.log(
      `Re-enriquecimiento disparado — schema="${schema.name}" campos actualizados=${jobs.length}`,
    );
  }

  /**
   * Estado de la cola — útil para endpoint de admin/debug.
   */
  getQueueStats() {
    return this.queue.getStats();
  }

  /**
   * Estado de un job específico.
   */
  getJobStatus(jobId: string): EmbeddingFieldJob | undefined {
    return this.queue.getJob(jobId);
  }
}