import { NodeType } from "../data/mapflow/types";

// ─────────────────────────────────────────────────────────────────────────────
// Input del endpoint POST /mapflow-ai/:companyId
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateMapflowAiDto {
  /** Nombre del MapFlow a crear */
  name: string;
  /** Descripción detallada del flujo deseado por el cliente */
  description: string;
  /**
   * Opcional — IDs de schemas existentes para darle contexto al LLM.
   * El front puede pasar uno o varios. Si no viene, el LLM infiere los schemas.
   */
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
  /** Nombre semántico del schema, ej: "pedidos", "productos" */
  name: string;
  description?: string;
  category: SchemaCategoryType;
  fields: InferredSchemaField[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema existente que se le pasa al LLM como contexto (cuando schemaId viene)
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
// Output del LLM — lo que vive en el job hasta que el cliente confirme
// ─────────────────────────────────────────────────────────────────────────────

/** Nodo tal como lo devuelve el LLM — sin coordenadas */
export interface LlmNode {
  id: string;
  type: NodeType;
  label: string;
  config: Record<string, any>;
}

export interface LlmEdge {
  source: string;
  target: string;
  /** Nombre del branch: "yes", "no", "comprar", etc. */
  label?: string;
}

/** Output completo del pipeline LLM — lo que se envía al front en preview_ready */
export interface MapflowAiOutput {
  nodes: LlmNode[];
  edges: LlmEdge[];
  /**
   * Schemas inferidos por el LLM — sin ID, solo la definición.
   * Vacío si el cliente pasó schemaId y el LLM no necesitó crear más.
   */
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
  /** Disponible desde preview_ready — vive en memoria hasta que el front confirme */
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
  | 'analyzing'     // Fase 0 — analizando qué tiene el negocio
  | 'generating'    // Fase 1..N — skeleton y config de nodos
  | 'preview_ready'
  | 'error';

export interface MapflowAiSseEvent {
  event: MapflowAiSseEventType;
  jobId: string;
  /** Solo en preview_ready — el front lo usa para renderizar el preview */
  data?: MapflowAiOutput;
  /** Solo en error */
  message?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos internos del pipeline de inferencia
// ─────────────────────────────────────────────────────────────────────────────

export interface SkeletonNode {
  id: string;
  type: NodeType;
  purpose: string;
  /** Solo para storeNode: ID del outputNode del que lee */
  readsFrom?: string;
}

export interface FlowSkeleton {
  /**
   * Schemas que el LLM necesita crear para este flujo.
   * Vacío si el cliente pasó schemaId y es suficiente.
   */
  inferredSchemas: InferredSchema[];
  nodes: SkeletonNode[];
  edges: LlmEdge[];
}

export interface NodeConfigResult {
  success: boolean;
  config?: Record<string, any>;
  /** Solo si success=false: razón de la incongruencia para reformular */
  reformulationReason?: string;
}