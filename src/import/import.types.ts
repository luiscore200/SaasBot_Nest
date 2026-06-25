// ─────────────────────────────────────────────────────────────────────────────
// Import module — tipos compartidos
// ─────────────────────────────────────────────────────────────────────────────

// Reutilizar tipos canónicos del DTO de schemas — no redefinir
import { CreateSchemaFieldDto, SchemaCategory } from 'src/data/schemas/dto/create-schema.dto';

export { FieldType, SchemaCategory, AutoFieldType } from 'src/data/schemas/dto/create-schema.dto';

// Alias: un campo del schema inferido = CreateSchemaFieldDto (sin auto — el LLM nunca propone campos auto)
export type FieldDefinition = Omit<CreateSchemaFieldDto, 'auto'>;

// ─── Estados del job ─────────────────────────────────────────────────────────

export type ImportJobStatus =
  | 'pending'         // encolado, esperando procesamiento
  | 'analyzing'       // Fase A en curso (parseo + LLM)
  | 'preview_ready'   // Fase A completada, esperando confirmación del usuario
  | 'loading_data'    // Fase B en curso (inserción masiva)
  | 'completed'       // todo ok
  | 'failed';         // error irrecuperable

// ─── Job en memoria ──────────────────────────────────────────────────────────

export interface ImportJob {
  jobId: string;
  companyId: string;

  // Formulario del usuario
  name: string;
  description?: string;

  // Archivo
  filePath: string;      // path relativo — funciona en cualquier instancia
  originalName: string;

  status: ImportJobStatus;

  // Resultado de Fase A (se puebla al terminar el análisis)
  schema?: FieldDefinition[];
  category?: SchemaCategory;
  sample?: any[];          // hasta 20 filas coercionadas para el preview
  hasHeader?: boolean;
  headerConfidence?: number;
  warnings?: string[];

  // Error (si status === 'failed')
  lastError?: string;

  createdAt: Date;
  updatedAt: Date;
}

// ─── Payload de enqueue ──────────────────────────────────────────────────────

export interface EnqueueImportPayload {
  companyId: string;
  name: string;
  description?: string;
  filePath: string;
  originalName: string;
}