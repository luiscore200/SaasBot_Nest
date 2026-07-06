import { NodeType } from "../data/mapflow/types";

// ─────────────────────────────────────────────────────────────────────────────
// Input del endpoint POST /mapflow-ai/:companyId
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateMapflowAiDto {
  name: string;
  description: string;
  schemaIds?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Schemas — definiciones sin ID (viven solo en memoria hasta confirmación)
// ─────────────────────────────────────────────────────────────────────────────

export type SchemaFieldType = 'string' | 'number' | 'boolean' | 'json' | 'date';
export type SchemaAutoType  = 'uuid' | 'timestamp' | 'batch_id';
export type SchemaCategoryType = 'inventory' | 'schedule';

export interface InferredSchemaField {
  name: string;
  type: SchemaFieldType;
  required: boolean;
  auto?: SchemaAutoType;
  description?: string;
}

export interface InferredSchema {
  name: string;
  description?: string;
  category: SchemaCategoryType;
  fields: InferredSchemaField[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema existente que se le pasa al LLM como contexto
// ─────────────────────────────────────────────────────────────────────────────

export interface ExistingSchemaContext {
  id: string;
  name: string;
  description?: string;
  category: string;
  fields: Array<{
    name: string;
    type: string;
    required: boolean;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Output del LLM
// ─────────────────────────────────────────────────────────────────────────────

export interface LlmNode {
  id: string;
  type: NodeType;
  label: string;
  config: Record<string, any>;
}

export interface LlmEdge {
  source: string;
  target: string;
  label?: string;
}

export interface MapflowAiOutput {
  nodes: LlmNode[];
  edges: LlmEdge[];
  inferredSchemas: InferredSchema[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Job interno
// ─────────────────────────────────────────────────────────────────────────────

export type MapflowAiJobStatus =
  | 'pending'
  | 'generating'
  | 'preview_ready'
  | 'failed';

export interface MapflowAiJob {
  jobId: string;
  companyId: string;
  name: string;
  description: string;
  schemaIds?: string[];
  status: MapflowAiJobStatus;
  output?: MapflowAiOutput;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Eventos SSE
// ─────────────────────────────────────────────────────────────────────────────

export type MapflowAiSseEventType =
  | 'queued'
  | 'analyzing'
  | 'generating'
  | 'preview_ready'
  | 'error';

export interface MapflowAiSseEvent {
  event: MapflowAiSseEventType;
  jobId: string;
  data?: MapflowAiOutput;
  message?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos internos del pipeline de inferencia
// ─────────────────────────────────────────────────────────────────────────────

export interface SkeletonNode {
  id: string;
  type: NodeType;
  purpose: string;
  /**
   * Solo aplica a storeNode.
   * 'inline'   → vive en la cadena principal, con next/branches "success"/"empty".
   * 'floating' → store global SIN edges propios, activado/desactivado por
   *              initStores/finishStores declarados en OTROS nodos.
   * Si se omite para un storeNode, se asume 'inline'.
   */
  storeMode?: 'inline' | 'floating';
  /** IDs de storeNode (modo floating) que se activan al llegar a este nodo. */
  initStores?: string[];
  /** IDs de storeNode (modo floating) que se desactivan al llegar a este nodo. */
  finishStores?: string[];
}

export interface FlowSkeleton {
  inferredSchemas: InferredSchema[];
  nodes: SkeletonNode[];
  edges: LlmEdge[];
}

export interface NodeConfigResult {
  success: boolean;
  config?: Record<string, any>;
  reformulationReason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo — lectura de patrones indexados por el módulo de creación (admin)
//
// ⚠️ Este módulo (mapflow-ai) NO importa el módulo de creación (data/mapflow).
// Solo lee de la misma colección de Qdrant que ese módulo puebla — el
// contrato es el nombre de la colección y la forma del payload, documentados
// en catalogLookup.service.ts.
// ─────────────────────────────────────────────────────────────────────────────

export interface CatalogPatternPayload {
  mapflow_id: string;
  runtime_id: string;
  collection: 'runtimes';
  tenant: string;
}

export interface CatalogSchemaShape {
  name: string;
  description?: string;
  category: string;
  fields: Array<{ name: string; type: string; required: boolean }>;
}

export interface CatalogPatternMatch {
  mapflowId: string;
  runtimeId: string;
  tenant: string;
  score: number;
  /** FlowRuntime.lean() del tenant admin — { startNode, nodes, ... } */
  runtime: any;
  mapflowDescription?: string;
  mapflowMd?: string;
  catalogSchemas: CatalogSchemaShape[];
}