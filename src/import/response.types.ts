// ─────────────────────────────────────────────────────────────────────────────
// Contratos de respuesta — Módulo Import
// Estas interfaces definen exactamente qué retorna cada endpoint.
// El front puede copiar este archivo o usarlo como referencia.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Tipos base ───────────────────────────────────────────────────────────────

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'json';
export type SchemaCategory = 'inventory' | 'schedule';
export type ImportJobStatus =
  | 'pending'
  | 'analyzing'
  | 'preview_ready'
  | 'loading_data'
  | 'completed'
  | 'failed';

export interface FieldDefinition {
  name: string;
  type: FieldType;
  required: boolean;
  unique?: boolean;
  description?: string;
}

// ─── POST /import/:companyId ──────────────────────────────────────────────────
// Inicia el análisis. Retorna inmediatamente con el jobId.

export interface StartImportResponse {
  jobId: string;
}

// Errores posibles:
// 400 — falta archivo o name
// 409 — ya hay un job activo
//   { message: string, jobId: string, status: ImportJobStatus }

// ─── GET /import/:companyId/job ───────────────────────────────────────────────
// Consulta el job activo. Usado al cargar la página para detectar jobs pendientes.

export interface GetActiveJobResponse {
  active: false;
  job: null;
}

export interface GetActiveJobWithDataResponse {
  active: true;
  job: ImportJobData;
}

export interface ImportJobData {
  jobId: string;
  companyId: string;
  name: string;
  description?: string;
  filePath: string;
  originalName: string;
  status: ImportJobStatus;

  // Disponibles cuando status === 'preview_ready'
  schema?: FieldDefinition[];
  category?: SchemaCategory;
  sample?: Record<string, any>[];  // hasta 20 filas coercionadas
  hasHeader?: boolean;
  headerConfidence?: number;       // 0–1
  warnings?: string[];             // puede estar vacío []

  // Solo si status === 'failed'
  lastError?: string;

  createdAt: string;  // ISO 8601
  updatedAt: string;  // ISO 8601
}

// ─── GET /import/:companyId/progress — SSE ───────────────────────────────────
// Stream de eventos. Cada mensaje es un MessageEvent con data en JSON.
// El front hace: JSON.parse(event.data) para obtener ImportSseEvent.

export type ImportSseEvent =
  | ImportStepEvent
  | ImportPreviewReadyEvent
  | ImportErrorEvent;

export interface ImportStepEvent {
  event: 'step';
  data: {
    step: 'parsing' | 'inference' | 'validation';
    status: 'started' | 'done';
    detail?: string;  // ej: "6 columnas, con encabezado"
  };
}

export interface ImportPreviewReadyEvent {
  event: 'preview_ready';
  data: {
    jobId: string;
  };
}

export interface ImportErrorEvent {
  event: 'error';
  data: {
    message: string;
  };
}

// ─── DELETE /import/:companyId/job ────────────────────────────────────────────
// Descarta el job activo y borra el archivo.

export interface DiscardJobResponse {
  discarded: boolean;
  message: string;
}

// Errores posibles:
// 404 — no hay job activo

// ─── POST /import/:companyId/confirm ─────────────────────────────────────────
// Confirma el preview. Body: { action: 'schema_only' | 'schema_and_data' }

// action === 'schema_only'
export interface ConfirmSchemaOnlyResponse {
  schemaId: string;
}

// action === 'schema_and_data' — pendiente Fase B
export interface ConfirmSchemaAndDataResponse {
  schemaId: string;
  jobId: string;  // para abrir SSE de Fase B
}

// Errores posibles:
// 400 — action inválido, o schema_and_data aún no implementado
// 409 — no hay preview listo para confirmar