// ─────────────────────────────────────────────────────────────────────────────
// engine/node/output/dataResolver.service.ts
// ─────────────────────────────────────────────────────────────────────────────
import { Injectable, Logger } from '@nestjs/common';
import { QdrantService } from '../../../qdrant/qdrant.service';
import { OllamaService } from '../../../ollama/ollama.service';
import { PersistenceService } from '../../../common/services/percistence/persistence.service';
import { ChatGroqService } from '../../groq/chatGroq.service';
import { Schema } from 'mongoose';

export interface SchemeObject {
  id: string;
  selectedSchema: string;
  selectedFields: string[];
  schemaName: string; // ← nuevo: nombre visual del schema (ej: "inventario_farmaceutico")
}

export interface GlobalCriteria {
  scheme: string;
  column: string;
  condition: string;
  value: string;
  valueSource: 'form' | 'static';
}

export interface ResolveParams {
  companyId: string;
  schemes: SchemeObject[];
  globalCriteria: GlobalCriteria[];
  formState: Record<string, any>;
  searchQuery?: string;
  useSemanticSearch: boolean;
  page?: number;
  pageSize?: number;
}

export interface ResolvedDocument {
  schemaId: string;
  schemaName: string; // ← nuevo
  documents: Record<string, any>[];
  totalFound: number;
  page: number;
  hasMore: boolean;
}

const QDRANT_COLLECTION = 'documents';
const DynamicDocSchema = new Schema({}, { strict: false });

@Injectable()
export class DataResolverService {
  private readonly logger = new Logger(DataResolverService.name);

  constructor(
    private readonly qdrant: QdrantService,
    private readonly ollama: OllamaService,
    private readonly persistence: PersistenceService,
    private readonly groq: ChatGroqService,
  ) {}

  // ── Punto de entrada ───────────────────────────────────────────────────────

  async resolve(params: ResolveParams): Promise<ResolvedDocument[]> {
    this.logger.log(
      `[resolve] companyId="${params.companyId}" ` +
      `useSemanticSearch=${params.useSemanticSearch} ` +
      `searchQuery="${params.searchQuery ?? 'null'}" ` +
      `schemes=${params.schemes.map(s => s.selectedSchema).join(',')}`,
    );

    const results: ResolvedDocument[] = [];
    for (const scheme of params.schemes) {
      const docs = params.useSemanticSearch && params.searchQuery
        ? await this.resolveViaSemantic(params, scheme)
        : await this.resolveViaMongo(params, scheme);
      results.push(docs);
    }
    return results;
  }

  // ── Búsqueda semántica: Qdrant → Mongo → LLM re-rank ─────────────────────

private async resolveViaSemantic(
  params: ResolveParams,
  scheme: SchemeObject,
): Promise<ResolvedDocument> {
  this.logger.log(`[semantic] schemaName="${scheme.schemaName}"`); // ← agregar esto

  // 1. Embed
  let vector: number[];
  try {
    vector = await this.ollama.embed(params.searchQuery!);
    this.logger.log(`[semantic] embed OK — dim=${vector.length}`);
  } catch (err: any) {
    this.logger.error(`[semantic] embed FAILED: ${err.message}`);
    throw err;
  }

  // 2. Filtro Qdrant
  const qdrantCriteria = this.buildQdrantCriteria(
    params.globalCriteria, params.formState, scheme.selectedSchema,
  );
  const filter = {
    must: [
      { key: 'company_id', match: { value: params.companyId } },
      { key: 'schema_id',  match: { value: scheme.selectedSchema } },
      ...qdrantCriteria,
    ],
  };
  this.logger.log(`[semantic] Qdrant filter=${JSON.stringify(filter)}`);

  // 3. Buscar en Qdrant
  let hits: any[];
  try {
    hits = await this.qdrant.search<{
      document_id: string;
      schema_id: string;
      company_id: string;
      category: string;
    }>(QDRANT_COLLECTION, { vector, filter, topK: 2 });
    this.logger.log(
      `[semantic] Qdrant hits=${hits.length} ` +
      `scores=${hits.map(h => h.score.toFixed(3)).join(',')}`,
    );
  } catch (err: any) {
    this.logger.error(`[semantic] Qdrant search FAILED: ${err.message}`);
    throw err;
  }

  if (!hits.length) {
    this.logger.log(`[semantic] Sin hits en Qdrant — devolviendo vacío`);
    return { schemaId: scheme.selectedSchema, schemaName: scheme.schemaName, documents: [], totalFound: 0, page: 1, hasMore: false };
  }

  // 4. Fetch en Mongo por document_id
  const documentIds = hits.map(h => h.payload.document_id);
  this.logger.log(`[semantic] Fetching Mongo por IDs: ${documentIds.join(',')}`);

  const candidates = await this.fetchDocumentsFromMongo(params.companyId, scheme, {
    _id: { $in: documentIds },
  });
  this.logger.log(`[semantic] Mongo devolvió ${candidates.length} candidatos`);

  // 5. Re-ranking LLM
  const reranked = await this.reRankWithLLM(
    candidates,
    params.searchQuery!,
    scheme.selectedFields,
  );
  this.logger.log(
    `[semantic] re-rank: ${candidates.length} candidatos → ${reranked.length} relevantes`,
  );

  if (!reranked.length) {
    this.logger.log(`[semantic] Ningún candidato pasó el re-ranking — devolviendo vacío`);
    return { schemaId: scheme.selectedSchema, schemaName: scheme.schemaName, documents: [], totalFound: 0, page: 1, hasMore: false };
  }

  // 6. Reordenar por score original de Qdrant
  const ordered = documentIds
    .map(id => reranked.find(d => d._id?.toString() === id))
    .filter(Boolean) as Record<string, any>[];

  this.logger.log(`[semantic] Resultado final: ${ordered.length} docs ordenados`);

  return {
    schemaId: scheme.selectedSchema,
    schemaName: scheme.schemaName,
    documents: ordered,
    totalFound: ordered.length,
    page: 1,
    hasMore: false,
  };
}

  // ── Listado directo: Mongo con paginación ─────────────────────────────────

 private async resolveViaMongo(
  params: ResolveParams,
  scheme: SchemeObject,
): Promise<ResolvedDocument> {
  const page     = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  const skip     = (page - 1) * pageSize;

  const mongoFilter = this.buildMongoFilter(
    params.companyId, params.globalCriteria, params.formState, scheme.selectedSchema,
  );

  this.logger.debug(
    `[mongo] schema="${scheme.selectedSchema}" page=${page} ` +
    `filter=${JSON.stringify(mongoFilter)}`,
  );

  const model = await this.persistence.getTenantModel(
    params.companyId, 'Document', DynamicDocSchema,
  );

  const total = await model.countDocuments(mongoFilter);
  this.logger.log(`[mongo] countDocuments=${total} skip=${skip} limit=${pageSize}`);

  const rawDocs = await model.find(mongoFilter).skip(skip).limit(pageSize).lean();
  const documents = rawDocs.map(doc =>
    this.projectFields(doc as Record<string, any>, scheme.selectedFields, scheme.schemaName),
  );

  this.logger.log(`[mongo] docs devueltos=${documents.length} hasMore=${skip + documents.length < total}`);

  return {
    schemaId: scheme.selectedSchema,
    schemaName: scheme.schemaName,
    documents,
    totalFound: total,
    page,
    hasMore: skip + documents.length < total,
  };
}

  // ── Fetch puntual por IDs ─────────────────────────────────────────────────

  private async fetchDocumentsFromMongo(
    companyId: string,
    scheme: SchemeObject,
    filter: Record<string, any>,
  ): Promise<Record<string, any>[]> {
    const model = await this.persistence.getTenantModel(
      companyId, 'Document', DynamicDocSchema,
    );
    const docs = await model.find(filter).lean();
  return docs.map(doc =>
  this.projectFields(doc as Record<string, any>, scheme.selectedFields, scheme.schemaName),
);
  }

  // ── Re-ranking LLM ────────────────────────────────────────────────────────

  /**
   * Pasa los documentos candidatos (ya legibles desde Mongo) al LLM para que
   * decida cuáles coinciden genuinamente con la búsqueda del usuario.
   *
   * Esto resuelve el problema de que Qdrant siempre devuelve los K más cercanos
   * aunque la coincidencia semántica sea baja: el LLM actúa como árbitro final
   * con los textos reales, sin depender de umbrales de score que pueden generar
   * tanto falsos positivos como falsos negativos.
   */
private async reRankWithLLM(
  documents: Record<string, any>[],
  searchQuery: string,
  selectedFields: string[],
): Promise<Record<string, any>[]> {
  if (!documents.length) return [];

  const candidateSummaries = documents.map((doc, i) => {
    const data = doc.data ?? doc;
    const fields = selectedFields?.length
      ? selectedFields.map(f => `${f}: ${data[f] ?? '[sin valor]'}`).join(', ')
      : Object.entries(data).filter(([k]) => !k.startsWith('_')).map(([k, v]) => `${k}: ${v}`).join(', ');
    return `IDX_${i}: { ${fields} }`;
  });

  this.logger.log(
    `[reRankWithLLM] query="${searchQuery}"\ncandidatos:\n${candidateSummaries.join('\n')}`,
  );

const result = await this.groq.rawCall<{ relevantIndexes: number[] }>(
  `El usuario buscó: "${searchQuery}"

Candidatos recuperados:
${candidateSummaries.join('\n')}

Determina cuáles son genuinamente relevantes para la búsqueda.

Un candidato ES relevante si:
- Su nombre o descripción coincide directa o parcialmente con lo buscado
- Es un producto, ítem o recurso que satisface la necesidad, uso, función
  o característica que el usuario describió — usa tu conocimiento general
  para inferir la relación aunque las palabras no coincidan exactamente
- Es un sinónimo, nombre comercial o variante conocida de lo buscado

Un candidato NO es relevante si:
- No tiene ninguna relación funcional ni semántica con la búsqueda
- Pertenece a una categoría completamente distinta a lo que el usuario necesita

Si ninguno es relevante, devuelve array vacío.

Responde ÚNICAMENTE con JSON (sin markdown):
{"relevantIndexes": [0, 1]}`,
);

  this.logger.log(`[reRankWithLLM] LLM resultado: ${JSON.stringify(result)}`);

  if (!Array.isArray(result?.relevantIndexes) || !result.relevantIndexes.length) {
    return [];
  }

  return result.relevantIndexes
    .filter(i => typeof i === 'number' && i >= 0 && i < documents.length)
    .map(i => documents[i]);
}

  // ── Helpers de filtros ────────────────────────────────────────────────────

  /**
   * Construye filtros Qdrant para búsqueda semántica.
   * Solo incluir criterios ESTÁTICOS (valueSource='static').
   * Los criterios 'form' no se aplican en Qdrant porque el valor del form
   * ya está representado en el vector de búsqueda.
   */
  private buildQdrantCriteria(
    criteria: GlobalCriteria[],
    formState: Record<string, any>,
    schemaId: string,
  ): Array<{ key: string; match: { value: any } }> {
    return criteria
      .filter(c => c.scheme === schemaId && c.valueSource === 'static')
      .map(c => ({ key: c.column, match: { value: c.value } }))
      .filter(c => c.match.value !== undefined && c.match.value !== null);
  }

  private buildMongoFilter(
    companyId: string,
    criteria: GlobalCriteria[],
    formState: Record<string, any>,
    schemaId: string,
  ): Record<string, any> {
    const filter: Record<string, any> = {
      company_id: companyId,
      schema_id: schemaId,
      active: true,
    };

    for (const c of criteria.filter(c => c.scheme === schemaId)) {
      const value = c.valueSource === 'form'
        ? formState[c.value] ?? c.value
        : c.value;

      if (value === undefined || value === null) continue;

      const fieldKey = `data.${c.column}`;
      switch (c.condition) {
        case 'equals':   filter[fieldKey] = value; break;
        case 'LIKE':
        case 'contains': filter[fieldKey] = { $regex: value, $options: 'i' }; break;
        case 'gt':       filter[fieldKey] = { $gt: value }; break;
        case 'lt':       filter[fieldKey] = { $lt: value }; break;
        case 'gte':      filter[fieldKey] = { $gte: value }; break;
        case 'lte':      filter[fieldKey] = { $lte: value }; break;
        default:         filter[fieldKey] = value;
      }
    }

    this.logger.debug(`[buildMongoFilter] resultado: ${JSON.stringify(filter)}`);
    return filter;
  }

private projectFields(
  doc: Record<string, any>,
  selectedFields: string[],
  schemaName?: string,       // ← nuevo parámetro
): Record<string, any> {
  if (!selectedFields?.length) return doc;

  const data = doc.data ?? doc;
  const projected: Record<string, any> = { _id: doc._id };

  for (const field of selectedFields) {
    if (field in data) {
      const value = data[field];
      projected[field] = value;                                   // acceso plano: ${campo}
      if (schemaName) {
        projected[`${schemaName}.${field}`] = value;              // con namespace: ${db.schema.campo}
      }
    }
  }

  return projected;
}
}