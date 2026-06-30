import { Injectable, Logger } from '@nestjs/common';
import { createReadStream } from 'fs';
import { parse as csvParse } from 'csv-parse';
import { ImportQueueService } from './queue.service';
import { ImportSseService } from './sse.service';
import { ImportJob, FieldDefinition } from './import.types';
import { MulterService } from 'src/multer/multer.service';
import { DocumentsService } from 'src/data/documents/documents.service';
import { SchemaInferenceService } from './inference.service';
import { PersistenceService } from 'src/common/services/percistence/persistence.service';
import { MongoOrmService } from 'src/mongoose/mongoose.service';
import { DocumentModel, DocumentModelSchema } from 'src/mongoose/documents.schema';
import { coerceRow, FieldError } from './typeCoercion.util';

const BATCH_SIZE      = 100;
const ERROR_THRESHOLD = 0.20;

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface InsertionProgress {
  insertados: number;
  errores: number;
  total: number;
}

// ─── Servicio ─────────────────────────────────────────────────────────────────

@Injectable()
export class InsertionWorkerService {
  private readonly logger = new Logger(InsertionWorkerService.name);

  constructor(
    private readonly importQueue: ImportQueueService,
    private readonly importSse: ImportSseService,
    private readonly multerService: MulterService,
    private readonly documentsService: DocumentsService,
    private readonly schemaInference: SchemaInferenceService,
    private readonly persistence: PersistenceService,
  ) {}

  // ─── Punto de entrada — llamado desde ImportService al confirmar ──────────

  async run(job: ImportJob, schemaId: string): Promise<void> {
    this.logger.log(`🚀 Fase B iniciada [${job.jobId}] — schemaId="${schemaId}"`);

    this.importQueue.updateJob(job.companyId, {
      status: 'loading_data',
      schemaId,
      progreso: { insertados: 0, errores: 0, total: 0 },
    });

    const absolutePath = this.multerService.resolveAbsolutePath(job.filePath);
    await this.streamAndInsert(job, schemaId, job.schema!, absolutePath);
  }

  // ─── Continuar sin cambios tras rechazar reformulación ──────────────────

  async continueWithCurrentSchema(job: ImportJob): Promise<void> {
    const schemaId = job.schemaId!;
    this.logger.log(`⏩ Continuando inserción sin cambios [${job.jobId}]`);
    const absolutePath = this.multerService.resolveAbsolutePath(job.filePath);
    await this.streamAndInsert(job, schemaId, job.schema!, absolutePath);
  }

  // ─── Reinicio tras aceptar reformulación ─────────────────────────────────

  async restartWithNewSchema(job: ImportJob): Promise<void> {
    const schemaId = job.schemaId!;
    this.logger.log(`🔄 Reiniciando inserción con schema nuevo [${job.jobId}]`);

    // Borrar todos los documentos ya insertados del schema actual
    const docModel = await this.persistence.getTenantModel<DocumentModel>(
      job.companyId,
      'Document',
      DocumentModelSchema,
    );
    await docModel.deleteMany({ schema_id: schemaId, company_id: job.companyId });
    this.logger.log(`🗑️  Documentos de schema="${schemaId}" eliminados`);

    const newFields = job.schemaNuevo ?? job.schema!;
    const absolutePath = this.multerService.resolveAbsolutePath(job.filePath);

    this.importQueue.updateJob(job.companyId, {
      status: 'loading_data',
      schema: newFields,
      schemaNuevo: undefined,
      progreso: { insertados: 0, errores: 0, total: 0 },
    });

    await this.streamAndInsert(job, schemaId, newFields, absolutePath);
  }

  // ─── Stream + inserción por lotes ────────────────────────────────────────

  private async streamAndInsert(
    job: ImportJob,
    schemaId: string,
    fields: FieldDefinition[],
    absolutePath: string,
  ): Promise<void> {
    const progress: InsertionProgress = { insertados: 0, errores: 0, total: 0 };
    let batch: Record<string, any>[] = [];
    let rowIndex = 0;
    let reformulationTriggered = false;

    return new Promise((resolve, reject) => {
      const parser = createReadStream(absolutePath).pipe(
        csvParse({
          skip_empty_lines: true,
          relax_column_count: true,
          trim: true,
          from_line: (job.hasHeader ?? true) ? 2 : 1,
        }),
      );

      // Pausar para poder controlar el flujo con async/await
      parser.pause();

      const processRow = async (rawRow: string[]) => {
        const coerced = coerceRow(rawRow, fields, rowIndex++);

        if (coerced.errors.length > 0) {
          progress.errores++;
          progress.total++;
          this.emitProgress(job.companyId, progress);
          return;
        }

        batch.push(coerced.data);

        if (batch.length >= BATCH_SIZE) {
          const currentBatch = [...batch];
          batch = [];
          await this.insertBatch(job, schemaId, currentBatch, progress);

          if (this.isOverThreshold(progress) && !reformulationTriggered) {
            reformulationTriggered = true;
            parser.destroy();
            await this.handleReformulation(job, schemaId, fields, progress);
            resolve();
            return;
          }
        }
      };

      // Procesar fila a fila de forma controlada
      parser.on('readable', async () => {
        let row: string[];
        while ((row = parser.read()) !== null) {
          if (reformulationTriggered) break;
          parser.pause();
          await processRow(row);
          parser.resume();
        }
      });

      parser.on('end', async () => {
        if (reformulationTriggered) return;

        // Insertar el lote final
        if (batch.length > 0) {
          await this.insertBatch(job, schemaId, batch, progress);
        }

        await this.finalize(job, schemaId, progress);
        resolve();
      });

      parser.on('error', (err) => {
        if (reformulationTriggered) return; // destruido intencionalmente
        this.logger.error(`❌ Error en stream [${job.jobId}]: ${err.message}`);
        this.importQueue.updateJob(job.companyId, { status: 'failed', lastError: err.message });
        this.importSse.emitError(job.companyId, err.message);
        reject(err);
      });

      parser.resume();
    });
  }

  // ─── Insertar un lote ────────────────────────────────────────────────────

  private async insertBatch(
    job: ImportJob,
    schemaId: string,
    batch: Record<string, any>[],
    progress: InsertionProgress,
  ): Promise<void> {
    try {
      await this.documentsService.createDocuments(
        job.companyId,
        schemaId,
        batch,
        false,  // strict: false — coerción ya validó los tipos
      );
      progress.insertados += batch.length;
      progress.total      += batch.length;
    } catch (err: any) {
      this.logger.warn(`⚠️  Lote de ${batch.length} falló: ${err.message}`);
      progress.errores += batch.length;
      progress.total   += batch.length;
    }
    this.emitProgress(job.companyId, progress);
  }

  // ─── Reformulación ───────────────────────────────────────────────────────

  private async handleReformulation(
    job: ImportJob,
    schemaId: string,
    currentFields: FieldDefinition[],
    progress: InsertionProgress,
  ): Promise<void> {
    const errorPct = ((progress.errores / progress.total) * 100).toFixed(1);
    this.logger.warn(`⚠️  Umbral 20% superado [${job.jobId}] — ${errorPct}% errores`);

    const errorContext =
      `${errorPct}% de los registros fallaron (${progress.errores} de ${progress.total} procesados).`;

    const schemaNuevo = await this.schemaInference.reformulate(
      currentFields,
      errorContext,
      { name: job.name, description: job.description },
    );

    this.importQueue.updateJob(job.companyId, {
      status: 'awaiting_decision',
      schemaNuevo,
      progreso: progress,
    });

    this.importSse.emitReformulationNeeded(
      job.companyId,
      `Se encontraron errores en el ${errorPct}% de los registros. El sistema sugiere ajustar el schema.`,
    );
  }

  // ─── Finalización ─────────────────────────────────────────────────────────

  private async finalize(
    job: ImportJob,
    schemaId: string,
    progress: InsertionProgress,
  ): Promise<void> {
    const status = progress.errores > 0 ? 'completed_with_errors' : 'completed';

    this.importQueue.updateJob(job.companyId, { status, progreso: progress });
    this.importSse.emitDone(job.companyId, {
      insertados: progress.insertados,
      errores: progress.errores,
      schemaId,
    });

    this.logger.log(
      `✅ Fase B completa [${job.jobId}] — insertados=${progress.insertados} errores=${progress.errores}`,
    );

    await this.multerService.deleteImportFile(job.filePath);
    this.importSse.close(job.companyId);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private isOverThreshold(p: InsertionProgress): boolean {
    return p.total > 0 && p.errores / p.total > ERROR_THRESHOLD;
  }

  private emitProgress(companyId: string, progress: InsertionProgress): void {
    this.importSse.emitProgress(companyId, progress);
  }
}