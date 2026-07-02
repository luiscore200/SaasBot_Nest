// src/data/mapflow/mapflow-pattern.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { OllamaService } from 'src/ollama/ollama.service';
import { QdrantService } from 'src/qdrant/qdrant.service';

export const MAPFLOW_PATTERN_COLLECTION = 'mapflow_pattern';
export const MAPFLOW_PATTERN_VECTOR_SIZE = 768;

export interface MapflowPatternQdrantPayload {
  mapflow_id: string;
  collection: string;
  tenant: string;
}

@Injectable()
export class MapflowPatternService implements OnModuleInit {
  private readonly logger = new Logger(MapflowPatternService.name);

  constructor(
    private readonly ollama: OllamaService,
    private readonly qdrant: QdrantService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.qdrant.ensureCollection({
      name: MAPFLOW_PATTERN_COLLECTION,
      vectorSize: MAPFLOW_PATTERN_VECTOR_SIZE,
      distance: 'Cosine',
      payloadIndexFields: ['mapflow_id', 'tenant'],
    });
  }

  /**
   * Inserta el pattern. Fire-and-forget.
   */
  indexPattern(params: { mapflowId: string; tenant: string; description: string }): void {
    this.create(params).catch((err) =>
      this.logger.warn(
        `No se pudo indexar pattern para mapflow="${params.mapflowId}": ${err.message}`,
      ),
    );
  }

  /**
   * Borra el/los punto(s) asociados a un mapflow. Fire-and-forget.
   * No necesitamos guardar el qdrant point id en Mongo — filtramos
   * directamente por mapflow_id, que está indexado en Qdrant.
   */
  deletePattern(mapflowId: string): void {
    this.qdrant
      .delete(MAPFLOW_PATTERN_COLLECTION, {
        must: [{ key: 'mapflow_id', match: { value: mapflowId } }],
      })
      .catch((err) =>
        this.logger.warn(
          `No se pudo eliminar pattern de Qdrant para mapflow="${mapflowId}": ${err.message}`,
        ),
      );
  }

  /**
   * Update = borra el pattern anterior (si existía) + crea uno nuevo
   * con la description actualizada. Evita puntos duplicados/huérfanos
   * para el mismo mapflow_id.
   */
  reindexPattern(params: { mapflowId: string; tenant: string; description: string }): void {
    this.run(async () => {
      await this.qdrant.delete(MAPFLOW_PATTERN_COLLECTION, {
        must: [{ key: 'mapflow_id', match: { value: params.mapflowId } }],
      });
      await this.create(params);
    }, params.mapflowId);
  }

  private async create(params: { mapflowId: string; tenant: string; description: string }) {
    const vector = await this.ollama.embed(params.description);
    const qdrantId = uuidv4();

    await this.qdrant.upsert<MapflowPatternQdrantPayload>(MAPFLOW_PATTERN_COLLECTION, {
      id: qdrantId,
      vector,
      payload: {
        mapflow_id: params.mapflowId,
        collection: MAPFLOW_PATTERN_COLLECTION,
        tenant: params.tenant,
      },
    });

    this.logger.log(`Pattern indexado — mapflow="${params.mapflowId}" qdrantId="${qdrantId}"`);
  }

  private run(fn: () => Promise<void>, mapflowId: string): void {
    fn().catch((err) =>
      this.logger.warn(`Fallo reindexando pattern mapflow="${mapflowId}": ${err.message}`),
    );
  }
}