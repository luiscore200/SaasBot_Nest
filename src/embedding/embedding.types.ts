// ─── Estado de la Saga por campo ─────────────────────────────────────────────

export type JobStatus =
  | 'pending'      // en cola, sin procesar
  | 'llm_done'     // LLM respondió, aún no guardado en Mongo
  | 'mongo_done'   // guardado en Mongo, pendiente Qdrant
  | 'qdrant_done'  // completado (stub por ahora)
  | 'failed';      // falló tras todos los reintentos

// ─── Job individual (un campo de un schema) ──────────────────────────────────

export interface EmbeddingFieldJob {
  // Identidad
  jobId: string;           // UUID único para este job
  schemaId: string;
  companyId: string;

  // Contexto para el LLM
  schemaName: string;
  schemaDescription?: string;
  fieldName: string;
  fieldType: 'string' | 'number' | 'boolean' | 'json' | 'date';
  fieldDescription?: string;  // descripción previa si ya tenía una

  // Estado de la saga
  status: JobStatus;
  llmResult?: string;      // guardado tras llm_done, reutilizado en reintentos
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Resultado del LLM ───────────────────────────────────────────────────────

export interface LlmFieldDescriptionResult {
  fieldName: string;
  description: string;
}