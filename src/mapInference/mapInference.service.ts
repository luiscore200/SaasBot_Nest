import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { MapflowAiQueueService } from './qeue.service';
import { MapflowAiSseService } from './sse.service';
import { MapflowInferenceService } from './infercence.service';
import { SchemasService } from '../data/schemas/schemas.service';
import {
  CreateMapflowAiDto,
  MapflowAiJob,
  ExistingSchemaContext,
} from './types';

@Injectable()
export class MapflowAiService implements OnModuleInit {
  private readonly logger = new Logger(MapflowAiService.name);

  constructor(
    private readonly queue: MapflowAiQueueService,
    private readonly sse: MapflowAiSseService,
    private readonly inference: MapflowInferenceService,
    private readonly schemas: SchemasService,
  ) {}

  // ─── Registro del processor en la queue ───────────────────────────────────

  onModuleInit() {
    this.queue.registerProcessor((job) => this.processJob(job));
  }

  // ─── POST /mapflow-ai/:companyId ──────────────────────────────────────────

  async startGeneration(
    companyId: string,
    dto: CreateMapflowAiDto,
  ): Promise<{ jobId: string }> {
    if (this.queue.hasActiveJob(companyId)) {
      const existing = this.queue.getJob(companyId)!;

      throw new ConflictException({
        message: 'Ya hay una generación en curso para esta empresa.',
        jobId: existing.jobId,
        status: existing.status,
      });
    }

    const job = this.queue.enqueue(companyId, dto);

    this.sse.emit(companyId, {
      event: 'queued',
      jobId: job.jobId,
    });

    return { jobId: job.jobId };
  }

  // ─── GET /mapflow-ai/:companyId/job ───────────────────────────────────────

  getJob(companyId: string): { active: boolean; job: MapflowAiJob | null } {
    const job = this.queue.getJob(companyId) ?? null;
    return { active: job !== null, job };
  }

  // ─── DELETE /mapflow-ai/:companyId/job ────────────────────────────────────

  discardJob(companyId: string): { message: string } {
    const job = this.queue.getJob(companyId);

    if (!job) {
      throw new NotFoundException({
        message: 'No hay job activo para descartar.',
      });
    }

    this.queue.discard(companyId);
    this.sse.close(companyId);

    return {
      message: `Job ${job.jobId} descartado.`,
    };
  }

  // ─── SSE /mapflow-ai/:companyId/stream ────────────────────────────────────

  getStream(companyId: string): Observable<MessageEvent> {
    return this.sse.getStream(companyId).pipe(
      map((event) => ({ data: event }) as unknown as MessageEvent),
    );
  }

  // ─── Proceso de generación ────────────────────────────────────────────────

  private async processJob(job: MapflowAiJob): Promise<void> {
    const { companyId } = job;

    this.queue.transition(companyId, 'generating');
    this.sse.emit(companyId, {
      event: 'analyzing',
      jobId: job.jobId,
    });

    try {
      // 1. Resolver contexto de schemas existentes
      const existingSchemas: ExistingSchemaContext[] = [];

      if (job.schemaIds?.length) {
        for (const schemaId of job.schemaIds) {
          try {
            const raw = await this.schemas.getSchemaById(
              companyId,
              schemaId,
            );

            existingSchemas.push({
              id: (raw as any)._id.toString(),
              name: raw.name,
              description: raw.description,
              category: raw.category,
              fields: raw.fields.map((f: any) => ({
                name: f.name,
                type: f.type,
                required: f.required,
              })),
            });

            this.logger.log(
              `[MapflowAiService] Schema cargado: "${raw.name}" (id: ${schemaId})`,
            );
          } catch {
            this.logger.warn(
              `[MapflowAiService] Schema ${schemaId} no encontrado. Se omite.`,
            );
          }
        }
      }

      // 2. Pipeline LLM
      this.sse.emit(companyId, {
        event: 'generating',
        jobId: job.jobId,
      });

      const output = await this.inference.inferMapflow(
        job.name,
        job.description,
        existingSchemas,
      );

      // 2.5 Resolver referencias por nombre -> ObjectId
      this.resolveSchemaReferences(output, existingSchemas);

      // 3. Guardar preview
      this.queue.transition(companyId, 'preview_ready', {
        output,
      });

      this.sse.emit(companyId, {
        event: 'preview_ready',
        jobId: job.jobId,
        data: output,
      });

      this.logger.log(
        `[MapflowAiService] Preview listo [${job.jobId}] — ` +
          `${output.nodes.length} nodos, ` +
          `${output.edges.length} edges, ` +
          `${output.inferredSchemas.length} schemas inferidos`,
      );
    } catch (err: any) {
      const message =
        err?.message ?? 'Error desconocido durante la generación.';

      this.queue.transition(companyId, 'failed', {
        error: message,
      });

      this.sse.emit(companyId, {
        event: 'error',
        jobId: job.jobId,
        message,
      });

      this.logger.error(
        `[MapflowAiService] processJob falló [${job.jobId}]: ${message}`,
        err?.stack,
      );
    }
  }

  /**
   * El LLM referencia los schemas por nombre.
   * Este método sustituye dichos nombres por el ObjectId real cuando
   * el schema ya existe en MongoDB.
   *
   * Los schemas inferidos permanecen con su nombre ya que todavía
   * no existen y serán creados durante la confirmación.
   */
  private resolveSchemaReferences(
    output: any,
    existingSchemas: ExistingSchemaContext[],
  ): void {
    if (!existingSchemas.length) {
      return;
    }

    const nameToId = new Map<string, string>();

    for (const schema of existingSchemas) {
      nameToId.set(
        schema.name.trim().toLowerCase(),
        schema.id,
      );
    }

    const resolve = (
      value?: string,
    ): string | undefined => {
      if (!value) {
        return value;
      }

      return (
        nameToId.get(value.trim().toLowerCase()) ??
        value
      );
    };

    for (const node of output.nodes) {
      switch (node.type) {
        case 'outputNode': {
          const schemes = node.config?.schemes;

          if (!Array.isArray(schemes)) {
            break;
          }

          for (const scheme of schemes) {
            const previous = scheme.selectedSchema;
            const resolved = resolve(previous);

            if (previous !== resolved) {
              this.logger.log(
                `[MapflowAiService] outputNode "${node.id}": "${previous}" -> "${resolved}"`,
              );
            }

            scheme.selectedSchema = resolved;
          }

          break;
        }

        case 'insertNode': {
          if (!node.config) {
            break;
          }

          const previous = node.config.selectedSchemaId;
          const resolved = resolve(previous);

          if (previous !== resolved) {
            this.logger.log(
              `[MapflowAiService] insertNode "${node.id}": "${previous}" -> "${resolved}"`,
            );
          }

          node.config.selectedSchemaId = resolved;

          break;
        }
      }
    }
  }
}