import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Model } from 'mongoose';
import { GroqService } from '../../groq/groq.service';
import { PersistenceService } from 'src/common/services/percistence/persistence.service';
import { SchemaModel, SchemaModelSchema } from 'src/mongoose/schemas.schema';
import { QueueService } from '../queue/queue.service';
import { EmbeddingFieldJob, LlmFieldDescriptionResult } from '../embedding.types';

@Injectable()
export class ProcessorService implements OnModuleInit {
  private readonly logger = new Logger(ProcessorService.name);

  constructor(
    private readonly queue: QueueService,
    private readonly groq: GroqService,
    private readonly persistence: PersistenceService,
  ) {}

  onModuleInit() {
    // Registra el processor en la cola al arrancar el módulo
    this.queue.registerProcessor((job) => this.process(job));
    this.logger.log('EmbeddingProcessorService registrado en la cola');
  }

  // ─── Proceso principal (saga por campo) ──────────────────────────────────

  async process(job: EmbeddingFieldJob): Promise<void> {
    this.logger.debug(
      `Procesando job [${job.jobId}] campo="${job.fieldName}" status="${job.status}"`,
    );

    // ── Paso 1: LLM (saltar si ya tenemos resultado) ──────────────────────
    if (job.status === 'pending') {
      const description = await this.generateDescription(job);

      // Guardar resultado en el job ANTES de tocar Mongo
      this.queue.updateJob(job.jobId, {
        status: 'llm_done',
        llmResult: description,
        attempts: job.attempts + 1,
      });

      // Refrescar referencia local
      job = this.queue.getJob(job.jobId)!;
    }

    // ── Paso 2: MongoDB (saltar si ya está guardado) ──────────────────────
    if (job.status === 'llm_done') {
      await this.saveToMongo(job);

      this.queue.updateJob(job.jobId, { status: 'mongo_done' });
      job = this.queue.getJob(job.jobId)!;

      this.logger.log(
        `[${job.jobId}] Mongo actualizado — schema="${job.schemaName}" campo="${job.fieldName}"`,
      );
    }

    // ── Paso 3: Qdrant (stub — implementar después) ───────────────────────
    if (job.status === 'mongo_done') {
      await this.indexToQdrant(job);

      this.queue.updateJob(job.jobId, { status: 'qdrant_done' });

      this.logger.log(
        `[${job.jobId}] Completado ✅ — campo="${job.fieldName}"`,
      );
    }
  }

  // ─── Paso 1: Llamada al LLM ───────────────────────────────────────────────

  private async generateDescription(job: EmbeddingFieldJob): Promise<string> {
    const prompt = this.buildPrompt(job);

    const result = await this.groq.chatStructured<LlmFieldDescriptionResult>(
      [{ role: 'user', content: prompt }],
      {
        temperature: 0.3,       // baja temperatura = más determinista
        maxCompletionTokens: 80,
      },
    );

    const description = result.data.description?.trim();

    if (!description) {
      throw new Error(
        `LLM devolvió descripción vacía para campo="${job.fieldName}"`,
      );
    }

    // Validación crítica: el LLM debe confirmar el campo correcto
    if (
      result.data.fieldName &&
      result.data.fieldName !== job.fieldName
    ) {
      throw new Error(
        `Mismatch de campo — esperado="${job.fieldName}" recibido="${result.data.fieldName}"`,
      );
    }

    return description;
  }

  // ─── Paso 2: Actualización atómica en MongoDB ────────────────────────────

  private async saveToMongo(job: EmbeddingFieldJob): Promise<void> {
    const model = await this.persistence.getTenantModel<SchemaModel>(
      job.companyId,
      'Schema',
      SchemaModelSchema,
    );

    // Operador posicional $ — actualiza SOLO el elemento del array
    // cuyo `name` coincide exactamente con job.fieldName.
    // Imposible actualizar otro campo por error.
    const result = await (model as Model<SchemaModel>).updateOne(
      {
        _id: job.schemaId,
        'fields.name': job.fieldName,   // filtro posicional
      },
      {
        $set: {
          'fields.$.description': job.llmResult,  // $ apunta al elemento encontrado
        },
      },
    );

    if (result.matchedCount === 0) {
      throw new Error(
        `No se encontró schema="${job.schemaId}" o campo="${job.fieldName}" en Mongo`,
      );
    }
  }

  // ─── Paso 3: Qdrant (stub) ────────────────────────────────────────────────

  private async indexToQdrant(job: EmbeddingFieldJob): Promise<void> {
    // TODO: implementar cuando el módulo Qdrant esté listo
    // 1. Generar embedding del llmResult con groq.embed()
    // 2. Upsert en Qdrant con payload: { schemaId, companyId, fieldName }
    this.logger.debug(
      `[stub] Qdrant — job [${job.jobId}] campo="${job.fieldName}" pendiente de implementar`,
    );
  }

  // ─── Builder del prompt ───────────────────────────────────────────────────

  private buildPrompt(job: EmbeddingFieldJob): string {
    return `
Eres un generador de descripciones semánticas para campos de bases de datos empresariales.
Tu respuesta debe ser ÚNICAMENTE un objeto JSON válido, sin texto adicional, sin comillas extra.

Contexto:
- Schema: "${job.schemaName}"
${job.schemaDescription ? `- Descripción del schema: "${job.schemaDescription}"` : ''}
- Campo: "${job.fieldName}"
- Tipo de dato: "${job.fieldType}"

Genera una descripción en español de máximo 20 palabras que explique qué representa 
este campo en el contexto del schema. Debe ser natural y útil para búsqueda semántica.

Responde SOLO con este JSON (sin markdown, sin backticks):
{
  "fieldName": "${job.fieldName}",
  "description": "<tu descripción aquí>"
}
    `.trim();
  }
}