import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  QdrantPoint,
  QdrantSearchResult,
  QdrantSearchParams,
  QdrantFilter,
  QdrantCollectionConfig,
} from './qdrant.types';

@Injectable()
export class QdrantService implements OnModuleInit {
  private readonly logger = new Logger(QdrantService.name);
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('QDRANT_URL', 'http://localhost:6333');
    const apiKey = this.config.get<string>('QDRANT_API_KEY', '');
    this.headers = {
      'Content-Type': 'application/json',
      ...(apiKey && { 'api-key': apiKey }),
    };
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.ping();
  }

  // ─── Conexión ─────────────────────────────────────────────────────────────

  private async ping(): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/healthz`, {
        headers: this.headers,
      });
      if (res.ok) {
        this.logger.log(`Qdrant conectado en ${this.baseUrl}`);
      } else {
        this.logger.warn(`Qdrant respondió ${res.status} en healthcheck`);
      }
    } catch (err: any) {
      this.logger.error(`No se pudo conectar a Qdrant: ${err.message}`);
    }
  }

  // ─── Gestión de colecciones ───────────────────────────────────────────────

  /**
   * Garantiza que una colección existe.
   * Si no existe, la crea con la config indicada.
   * Idempotente — seguro llamarlo en onModuleInit de otros módulos.
   */
  async ensureCollection(config: QdrantCollectionConfig): Promise<void> {
    const exists = await this.collectionExists(config.name);

    if (exists) {
      this.logger.log(`Colección "${config.name}" ya existe`);
      return;
    }

    await this.createCollection(config);
  }

  async collectionExists(name: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/collections/${name}`, {
      headers: this.headers,
    });
    return res.status === 200;
  }

  private async createCollection(config: QdrantCollectionConfig): Promise<void> {
    const res = await fetch(`${this.baseUrl}/collections/${config.name}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify({
        vectors: {
          size: config.vectorSize,
          distance: config.distance ?? 'Cosine',
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Error creando colección "${config.name}": ${body}`);
    }

    this.logger.log(`Colección "${config.name}" creada`);

    // Crear índices de payload para filtros eficientes
    if (config.payloadIndexFields?.length) {
      await this.createPayloadIndexes(config.name, config.payloadIndexFields);
    }
  }

  private async createPayloadIndexes(
    collectionName: string,
    fields: string[],
  ): Promise<void> {
    for (const field of fields) {
      const res = await fetch(
        `${this.baseUrl}/collections/${collectionName}/index`,
        {
          method: 'PUT',
          headers: this.headers,
          body: JSON.stringify({
            field_name: field,
            field_schema: 'keyword',
          }),
        },
      );

      if (!res.ok) {
        this.logger.warn(
          `No se pudo crear índice para campo "${field}" en colección "${collectionName}"`,
        );
      } else {
        this.logger.debug(`Índice creado: ${collectionName}.${field}`);
      }
    }
  }

  // ─── Operaciones CRUD ─────────────────────────────────────────────────────

  /**
   * Inserta o actualiza un punto en la colección.
   * Genérico — el payload es T, definido por el módulo llamador.
   */
  async upsert<T = Record<string, any>>(
    collectionName: string,
    point: QdrantPoint<T>,
  ): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/collections/${collectionName}/points`,
      {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify({
          points: [
            {
              id:      point.id,
              vector:  point.vector,
              payload: point.payload,
            },
          ],
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Qdrant upsert falló en "${collectionName}": ${body}`);
    }
  }

  /**
   * Inserta o actualiza múltiples puntos en batch.
   */
  async upsertBatch<T = Record<string, any>>(
    collectionName: string,
    points: QdrantPoint<T>[],
  ): Promise<void> {
    if (points.length === 0) return;

    const res = await fetch(
      `${this.baseUrl}/collections/${collectionName}/points`,
      {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify({ points }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Qdrant upsertBatch falló en "${collectionName}": ${body}`);
    }
  }

  /**
   * Elimina puntos que cumplan el filtro.
   */
  async delete(
    collectionName: string,
    filter: QdrantFilter,
  ): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/collections/${collectionName}/points/delete`,
      {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ filter }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Qdrant delete falló en "${collectionName}": ${body}`);
    }
  }

  /**
   * Elimina un punto por su ID directo.
   */
  async deleteById(collectionName: string, id: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/collections/${collectionName}/points/delete`,
      {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ points: [id] }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Qdrant deleteById falló en "${collectionName}": ${body}`);
    }
  }

  // ─── Búsqueda semántica ───────────────────────────────────────────────────

  /**
   * Búsqueda semántica genérica.
   * T define el tipo del payload que se espera en los resultados.
   */
  async search<T = Record<string, any>>(
    collectionName: string,
    params: QdrantSearchParams,
  ): Promise<QdrantSearchResult<T>[]> {
    const body: any = {
      vector:       params.vector,
      limit:        params.topK ?? 5,
      with_payload: true,
    };

    if (params.filter) {
      body.filter = params.filter;
    }

    const res = await fetch(
      `${this.baseUrl}/collections/${collectionName}/points/search`,
      {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Qdrant search falló en "${collectionName}": ${text}`);
    }

    const data = await res.json();

    return (data.result ?? []).map((r: any) => ({
      id:      r.id,
      score:   r.score,
      payload: r.payload as T,
    }));
  }
}