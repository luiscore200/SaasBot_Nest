// src/data/mapflow/mapflow-pattern.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { OllamaService } from 'src/ollama/ollama.service';
import { QdrantService } from 'src/qdrant/qdrant.service';

export const MAPFLOW_PATTERN_COLLECTION = 'mapflow_pattern';
export const MAPFLOW_PATTERN_VECTOR_SIZE = 768;

export interface MapflowPatternQdrantPayload {
  /** Estable a través de versiones — usado para limpieza/cleanup */
  mapflow_id: string;
  /** Apunta a la versión específica del runtime que se indexó */
  runtime_id: string;
  /** Colección mongo real donde vive el contenido referenciado */
  collection: 'runtimes';
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
      payloadIndexFields: ['mapflow_id', 'runtime_id', 'tenant'],
    });
  }

  indexPattern(params: { mapflowId: string; runtimeId: string; tenant: string; description: string }): void {
    this.create(params).catch((err) =>
      this.logger.warn(`No se pudo indexar pattern para mapflow="${params.mapflowId}": ${err.message}`),
    );
  }

  /** Sigue filtrando por mapflow_id (estable) — la deleción del flow no depende de qué versión de runtime esté activa. */
  deletePattern(mapflowId: string): void {
    this.qdrant
      .delete(MAPFLOW_PATTERN_COLLECTION, { must: [{ key: 'mapflow_id', match: { value: mapflowId } }] })
      .catch((err) =>
        this.logger.warn(`No se pudo eliminar pattern de Qdrant para mapflow="${mapflowId}": ${err.message}`),
      );
  }

  /**
   * Borra por mapflow_id (captura el punto de la versión anterior, sea cual
   * sea el runtime_id que tuviera) y crea uno nuevo apuntando al runtime_id
   * de la versión recién publicada.
   */
  reindexPattern(params: { mapflowId: string; runtimeId: string; tenant: string; description: string }): void {
    this.run(async () => {
      await this.qdrant.delete(MAPFLOW_PATTERN_COLLECTION, {
        must: [{ key: 'mapflow_id', match: { value: params.mapflowId } }],
      });
      await this.create(params);
    }, params.mapflowId);
  }

  private async create(params: { mapflowId: string; runtimeId: string; tenant: string; description: string }) {
    const vector = await this.ollama.embed(params.description);
    const qdrantId = uuidv4();

    await this.qdrant.upsert<MapflowPatternQdrantPayload>(MAPFLOW_PATTERN_COLLECTION, {
      id: qdrantId,
      vector,
      payload: {
        mapflow_id: params.mapflowId,
        runtime_id: params.runtimeId,
        collection: 'runtimes',
        tenant: params.tenant,
      },
    });

    this.logger.log(
      `Pattern indexado — mapflow="${params.mapflowId}" runtime="${params.runtimeId}" qdrantId="${qdrantId}"`,
    );
  }

  private run(fn: () => Promise<void>, mapflowId: string): void {
    fn().catch((err) => this.logger.warn(`Fallo reindexando pattern mapflow="${mapflowId}": ${err.message}`));
  }
}