import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ImportQueueService } from './queue.service';
import { FileParserService } from './parser.service';
import { SchemaInferenceService } from './inference.service';
import { SchemaValidatorService } from './validator.service';
import { ImportSseService } from './sse.service';
import { ImportJob } from './import.types';
import { MulterService } from 'src/multer/multer.service';
import { SchemasService } from 'src/data/schemas/schemas.service';
import { SchemaCategory } from 'src/data/schemas/dto/create-schema.dto';
import {
  StartImportResponse,
  GetActiveJobResponse,
  GetActiveJobWithDataResponse,
  DiscardJobResponse,
  ConfirmSchemaOnlyResponse,
  ImportJobData,
} from './response.types';

@Injectable()
export class ImportService implements OnModuleInit {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly importQueue: ImportQueueService,
    private readonly fileParser: FileParserService,
    private readonly schemaInference: SchemaInferenceService,
    private readonly schemaValidator: SchemaValidatorService,
    private readonly importSse: ImportSseService,
    private readonly multerService: MulterService,
    private readonly schemasService: SchemasService,
  ) {}

  onModuleInit() {
    this.importQueue.registerProcessor((job) => this.processJob(job));
  }

  // ─── Fase 0 — Recepción ──────────────────────────────────────────────────

  async importFile(
    companyId: string,
    name: string,
    description: string | undefined,
    file: { filename: string; path: string; originalname: string; size: number },
  ): Promise<StartImportResponse> {
    const existing = this.importQueue.getJobByCompany(companyId);
    if (existing) {
      throw new ConflictException({
        message: 'Ya tienes un análisis en curso. Descártalo antes de subir un archivo nuevo.',
        jobId: existing.jobId,
        status: existing.status,
      });
    }

    const job = this.importQueue.enqueue({
      companyId,
      name,
      description,
      filePath: file.path,
      originalName: file.originalname,
    });

    this.logger.log(`✅ Job creado [${job.jobId}] — company="${companyId}"`);
    return { jobId: job.jobId };
  }

  // ─── Consulta ────────────────────────────────────────────────────────────

  getActiveJob(companyId: string): GetActiveJobResponse | GetActiveJobWithDataResponse {
    const job = this.importQueue.getJobByCompany(companyId);
    if (!job) return { active: false, job: null };
    return { active: true, job: this.toJobData(job) };
  }

  // ─── Descarte ────────────────────────────────────────────────────────────

  discardJob(companyId: string): DiscardJobResponse {
    this.importSse.close(companyId);
    const discarded = this.importQueue.discard(companyId);
    return { discarded, message: 'Job descartado correctamente.' };
  }

  // ─── Fase 5 — Confirmación schema_only ───────────────────────────────────

  async confirmSchemaOnly(companyId: string): Promise<ConfirmSchemaOnlyResponse> {
    const job = this.importQueue.getJobByCompany(companyId);

    if (!job || job.status !== 'preview_ready') {
      throw new ConflictException('No hay un preview listo para confirmar.');
    }

    if (!job.schema || !job.category) {
      throw new ConflictException('El job no tiene schema o categoría — Fase A incompleta.');
    }

    const created = await this.schemasService.createSchema(companyId, {
      company_id: companyId,
      name: job.name,
      description: job.description,
      category: job.category as SchemaCategory,
      fields: job.schema as any,
    });

    this.logger.log(`✅ Schema creado [${created._id}] — company="${companyId}"`);

    await this.multerService.deleteImportFile(job.filePath);
    this.importQueue.discard(companyId);
    this.importSse.close(companyId);

    return { schemaId: created._id.toString() };
  }

  // ─── Processor — Fase A ──────────────────────────────────────────────────

  private async processJob(job: ImportJob): Promise<void> {
    this.importQueue.updateJob(job.companyId, { status: 'analyzing' });
    this.logger.log(`🔍 Analizando [${job.jobId}] — "${job.originalName}"`);

    try {
      // ── Fase 1 ───────────────────────────────────────────────────────────
      this.importSse.emitStep(job.companyId, 'parsing', 'started');
      const absolutePath = this.multerService.resolveAbsolutePath(job.filePath);
      const phase1 = await this.fileParser.parse(absolutePath);
      this.importSse.emitStep(
        job.companyId, 'parsing', 'done',
        `${phase1.profiling.length} columnas, ${phase1.headerDetection.hasHeader ? 'con' : 'sin'} encabezado`,
      );
      this.logger.log(
        `📊 Fase 1 — cols=${phase1.profiling.length} ` +
        `header=${phase1.headerDetection.hasHeader} (conf=${phase1.headerDetection.confidence.toFixed(2)}) ` +
        `tipos=${JSON.stringify(phase1.inferredTypes)}`,
      );

      // ── Fase 2 ───────────────────────────────────────────────────────────
      this.importSse.emitStep(job.companyId, 'inference', 'started');
      const phase2 = await this.schemaInference.infer(phase1, {
        name: job.name,
        description: job.description,
      });
      this.importSse.emitStep(
        job.companyId, 'inference', 'done',
        `category="${phase2.category}", ${phase2.fields.length} campos`,
      );

      // ── Fase 3 ───────────────────────────────────────────────────────────
      this.importSse.emitStep(job.companyId, 'validation', 'started');
      const phase3 = await this.schemaValidator.validate(
        phase1.sample,
        phase2.fields,
        { name: job.name, description: job.description },
      );
      this.importSse.emitStep(
        job.companyId, 'validation', 'done',
        `${phase3.records.length} filas con errores de ${phase3.totalRows}`,
      );

      // ── Consolidar warnings ───────────────────────────────────────────────
      const warnings: string[] = [];
      if (phase1.headerDetection.ambiguous) {
        warnings.push('La detección del encabezado fue ambigua — el LLM asignó los nombres de columna.');
      }
      warnings.push(...phase3.warnings);

      // ── Actualizar job ────────────────────────────────────────────────────
      this.importQueue.updateJob(job.companyId, {
        status: 'preview_ready',
        schema: phase3.schema,
        category: phase2.category,
        sample: phase3.validatedSample.map((r) => r.data),
        hasHeader: phase1.headerDetection.hasHeader,
        headerConfidence: phase1.headerDetection.confidence,
        warnings,
      });

      this.importSse.emitPreviewReady(job.companyId, job.jobId);
      this.logger.log(
        `🎯 Preview listo [${job.jobId}] — category="${phase2.category}" ` +
        `errores=${phase3.records.length}/${phase3.totalRows} reformulaciones=${phase3.reformulationAttempts}`,
      );

    } catch (err: any) {
      this.importSse.emitError(job.companyId, err.message ?? 'Error desconocido en el análisis.');
      throw err;
    }
  }

  // ─── Helper: ImportJob → ImportJobData (response shape) ──────────────────

  private toJobData(job: ImportJob): ImportJobData {
    return {
      jobId:             job.jobId,
      companyId:         job.companyId,
      name:              job.name,
      description:       job.description,
      filePath:          job.filePath,
      originalName:      job.originalName,
      status:            job.status,
      schema:            job.schema,
      category:          job.category,
      sample:            job.sample,
      hasHeader:         job.hasHeader,
      headerConfidence:  job.headerConfidence,
      warnings:          job.warnings,
      lastError:         job.lastError,
      createdAt:         job.createdAt.toISOString(),
      updatedAt:         job.updatedAt.toISOString(),
    };
  }
}