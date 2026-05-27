import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { PersistenceService } from 'src/common/services/percistence/persistence.service';
import { DocumentModel, DocumentModelSchema } from 'src/mongoose/documents.schema';
import { QdrantService } from '../../qdrant/qdrant.service';
import { QueueService } from '../queue/queue.service';
import { OllamaService } from 'src/ollama/ollama.service';
import {
  DocumentIndexJob,
  DocumentQdrantPayload,
  DOCUMENTS_COLLECTION,
  DOCUMENTS_VECTOR_SIZE,
} from '../indexing.types';

@Injectable()
export class ProcessorService implements OnModuleInit {
  private readonly logger = new Logger(ProcessorService.name);

  constructor(
    private readonly queue: QueueService,
    private readonly ollama: OllamaService,
    private readonly qdrant: QdrantService,
    private readonly persistence: PersistenceService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.qdrant.ensureCollection({
      name: DOCUMENTS_COLLECTION,
      vectorSize: DOCUMENTS_VECTOR_SIZE,
      distance: 'Cosine',
      payloadIndexFields: ['company_id', 'schema_id', 'category'],
    });

    this.queue.registerProcessor((job) => this.process(job));
    this.logger.log('DocumentProcessorService registrado en la cola');
  }

  async process(job: DocumentIndexJob): Promise<void> {
    this.logger.debug(
      `Procesando job [${job.jobId}] doc="${job.documentId}" status="${job.status}"`,
    );

    if (job.status === 'pending') {
      const enrichedText = this.buildEnrichedText(job);
      this.queue.updateJob(job.jobId, { status: 'text_done', enrichedText });
      job = this.queue.getJob(job.jobId)!;
      this.logger.debug(`[${job.jobId}] Texto: "${enrichedText.slice(0, 100)}..."`);
    }

    if (job.status === 'text_done') {
      const vector = await this.ollama.embed(job.enrichedText!);
      this.queue.updateJob(job.jobId, { status: 'embed_done', vector });
      job = this.queue.getJob(job.jobId)!;
      this.logger.debug(`[${job.jobId}] Vector generado (dim=${vector.length})`);
    }

    if (job.status === 'embed_done') {
      const qdrantId = uuidv4();
      await this.qdrant.upsert<DocumentQdrantPayload>(DOCUMENTS_COLLECTION, {
        id: qdrantId,
        vector: job.vector!,
        payload: {
          document_id: job.documentId,
          schema_id:   job.schemaId,
          company_id:  job.companyId,
          category:    job.category,
        },
      });
      this.queue.updateJob(job.jobId, { status: 'qdrant_done', qdrantId });
      job = this.queue.getJob(job.jobId)!;
      this.logger.log(`[${job.jobId}] Insertado en Qdrant — qdrantId="${qdrantId}"`);
    }

    if (job.status === 'qdrant_done') {
      await this.saveVectorIdToMongo(job);
      this.queue.updateJob(job.jobId, { status: 'mongo_done' });
      this.logger.log(
        `[${job.jobId}] Completado ✅ — doc="${job.documentId}" vector_id="${job.qdrantId}"`,
      );
    }
  }

  private buildEnrichedText(job: DocumentIndexJob): string {
    const parts: string[] = [];

    for (const field of job.schemaFields) {
      const value = job.documentData[field.name];
      if (value === undefined || value === null || value === '') continue;
      const label = field.description?.trim() || field.name;
      parts.push(`${label}: ${value}`);
    }

    if (parts.length === 0) {
      throw new Error(
        `No se pudo construir texto enriquecido para doc="${job.documentId}" — todos los campos están vacíos`,
      );
    }

    return parts.join('. ');
  }

  private async saveVectorIdToMongo(job: DocumentIndexJob): Promise<void> {
    const model = await this.persistence.getTenantModel<DocumentModel>(
      job.companyId,
      'Document',
      DocumentModelSchema,
    );

    const result = await (model as Model<DocumentModel>).updateOne(
      { _id: job.documentId },
      { $set: { vector_id: job.qdrantId } },
    );

    if (result.matchedCount === 0) {
      throw new Error(
        `No se encontró documento "${job.documentId}" en Mongo para guardar vector_id`,
      );
    }
  }
}