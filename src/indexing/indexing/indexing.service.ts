import { Injectable, Logger } from '@nestjs/common';

import { DocumentIndexJob } from '../indexing.types';
import { QueueService } from '../queue/queue.service';

@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);

  constructor(private readonly queue: QueueService) {}

  /**
   * Encola el indexado de un documento individual.
   * Llamar después de createDocument — no bloqueante.
   */
  indexDocument(params: {
    documentId: string;
    schemaId: string;
    companyId: string;
    category: string;
    documentData: Record<string, any>;
    schemaFields: Array<{ name: string; type: string; description?: string }>;
  }): void {
    this.queue.enqueueDocument(params);

    this.logger.log(
      `Indexado disparado — doc="${params.documentId}" schema="${params.schemaId}"`,
    );
  }

  /**
   * Encola el indexado de múltiples documentos, uno por uno.
   * Llamar después de createDocuments — no bloqueante.
   */
  indexDocuments(
    docs: Array<{
      documentId: string;
      schemaId: string;
      companyId: string;
      category: string;
      documentData: Record<string, any>;
      schemaFields: Array<{ name: string; type: string; description?: string }>;
    }>,
  ): void {
    if (!docs || docs.length === 0) return;

    this.queue.enqueueDocuments(docs);

    this.logger.log(
      `Indexado batch disparado — ${docs.length} documentos encolados`,
    );
  }

  getQueueStats() {
    return this.queue.getStats();
  }

  getJobStatus(jobId: string): DocumentIndexJob | undefined {
    return this.queue.getJob(jobId);
  }
}