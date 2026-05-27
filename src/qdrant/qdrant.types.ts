// ─── Punto a insertar/actualizar ─────────────────────────────────────────────

export interface QdrantPoint<T = Record<string, any>> {
  id: string;
  vector: number[];
  payload: T;
}

// ─── Resultado de búsqueda ────────────────────────────────────────────────────

export interface QdrantSearchResult<T = Record<string, any>> {
  id: string;
  score: number;
  payload: T;
}

// ─── Parámetros de búsqueda ───────────────────────────────────────────────────

export interface QdrantSearchParams {
  vector: number[];
  filter?: QdrantFilter;
  topK?: number;
}

// ─── Filtros ──────────────────────────────────────────────────────────────────

export interface QdrantFilter {
  must?: QdrantCondition[];
  should?: QdrantCondition[];
  must_not?: QdrantCondition[];
}

export interface QdrantCondition {
  key: string;
  match: { value: string | number | boolean };
}

// ─── Configuración de colección ───────────────────────────────────────────────

export interface QdrantCollectionConfig {
  name: string;
  vectorSize: number;
  distance?: 'Cosine' | 'Euclid' | 'Dot';
  payloadIndexFields?: string[];   // campos a indexar para filtros eficientes
}