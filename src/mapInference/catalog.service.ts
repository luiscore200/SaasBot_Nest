import { Injectable, Logger } from '@nestjs/common';
import { OllamaService } from 'src/ollama/ollama.service';
import { QdrantService } from 'src/qdrant/qdrant.service';
import { PersistenceService } from 'src/common/services/percistence/persistence.service';
import { FlowRuntime, FlowRuntimeSchema } from 'src/mongoose/runtimes.schema';
import { MapflowModel, MapflowModelSchema } from 'src/mongoose/mapflows.schema';
import { SchemasService } from '../data/schemas/schemas.service';
import { CatalogPatternMatch, CatalogPatternPayload, CatalogSchemaShape } from './types';

/**
 * ⚠️ Debe coincidir exactamente con MAPFLOW_PATTERN_COLLECTION en
 * src/data/mapflow/mapflowPattern.service.ts.
 */
const MAPFLOW_PATTERN_COLLECTION = 'mapflow_pattern';

const CATALOG_SIMILARITY_THRESHOLD = 0.72;
const CATALOG_TOP_K = 3;
/** Límite defensivo — evita cargar decenas de schemas si un patrón viejo acumuló muchos */
const CATALOG_MAX_SCHEMAS = 5;

@Injectable()
export class CatalogLookupService {
  private readonly logger = new Logger(CatalogLookupService.name);

  constructor(
    private readonly ollama: OllamaService,
    private readonly qdrant: QdrantService,
    private readonly persistence: PersistenceService,
    private readonly schemas: SchemasService,
  ) {}

  async findCompatiblePattern(description: string): Promise<CatalogPatternMatch | null> {
    let results: Awaited<ReturnType<typeof this.qdrant.search<CatalogPatternPayload>>>;

    try {
      const vector = await this.ollama.embed(description);
      results = await this.qdrant.search<CatalogPatternPayload>(MAPFLOW_PATTERN_COLLECTION, {
        vector,
        topK: CATALOG_TOP_K,
      });
    } catch (err: any) {
      this.logger.warn(`Búsqueda en catálogo falló, se omite el paso: ${err.message}`);
      return null;
    }

    if (!results.length) return null;

    const best = results[0];
    if (best.score < CATALOG_SIMILARITY_THRESHOLD) {
      this.logger.log(`Mejor match de catálogo (score=${best.score.toFixed(3)}) bajo el umbral — se ignora.`);
      return null;
    }

    const { mapflow_id, runtime_id, tenant } = best.payload;

    try {
      const runtimeModel = await this.persistence.getTenantModel<FlowRuntime>(
        tenant, 'FlowRuntime', FlowRuntimeSchema,
      );
      const runtime = await runtimeModel.findById(runtime_id).lean();

      if (!runtime) {
        this.logger.warn(
          `Pattern en Qdrant (mapflow="${mapflow_id}") ya no tiene runtime "${runtime_id}" en tenant="${tenant}".`,
        );
        return null;
      }

      // Contexto de negocio — best-effort, no crítico si falla
      let mapflowDescription: string | undefined;
      let mapflowMd: string | undefined;
      let catalogSchemas: CatalogSchemaShape[] = [];

      try {
        const mapflowModel = await this.persistence.getTenantModel<MapflowModel>(
          tenant, 'Mapflow', MapflowModelSchema,
        );
        const mapflowDoc = await mapflowModel.findById(mapflow_id).lean();

        if (mapflowDoc) {
          mapflowDescription = mapflowDoc.description;
          mapflowMd = mapflowDoc.md;
          catalogSchemas = await this.loadSchemaShapes(tenant, mapflowDoc.selectedSchemas ?? []);
        }
      } catch (err: any) {
        this.logger.warn(
          `No se pudo cargar contexto de negocio del patrón "${mapflow_id}": ${err.message}`,
        );
      }

      this.logger.log(
        `Catálogo: match compatible — mapflow="${mapflow_id}" runtime="${runtime_id}" ` +
        `score=${best.score.toFixed(3)} schemas=${catalogSchemas.length}`,
      );

      return {
        mapflowId: mapflow_id,
        runtimeId: runtime_id,
        tenant,
        score: best.score,
        runtime,
        mapflowDescription,
        mapflowMd,
        catalogSchemas,
      };
    } catch (err: any) {
      this.logger.warn(`No se pudo cargar runtime de catálogo "${runtime_id}": ${err.message}`);
      return null;
    }
  }

  private async loadSchemaShapes(tenant: string, schemaIds: string[]): Promise<CatalogSchemaShape[]> {
    const shapes: CatalogSchemaShape[] = [];

    for (const schemaId of schemaIds.slice(0, CATALOG_MAX_SCHEMAS)) {
      try {
        const raw = await this.schemas.getSchemaById(tenant, schemaId);
        shapes.push({
          name: raw.name,
          description: raw.description,
          category: raw.category,
          fields: raw.fields.map((f: any) => ({
            name: f.name,
            type: f.type,
            required: f.required,
          })),
        });
      } catch (err: any) {
        this.logger.warn(
          `No se pudo cargar schema de catálogo "${schemaId}" (tenant="${tenant}"): ${err.message}`,
        );
      }
    }

    return shapes;
  }
}