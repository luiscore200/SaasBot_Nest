// ─────────────────────────────────────────────────────────────────────────────
// Contratos de respuesta — Módulo Import
// Este archivo re-exporta tipos canónicos y define solo las interfaces
// de respuesta HTTP. El front puede copiar este archivo como referencia.
// ─────────────────────────────────────────────────────────────────────────────

// Re-exportar tipos canónicos desde sus fuentes — no redefinir
export type { ImportJobStatus, FieldDefinition, InsertionProgress } from './import.types';
export type { ImportSseEvent } from './sse.service';
export { SchemaCategory, FieldType } from 'src/data/schemas/dto/create-schema.dto';

import type { ImportJobStatus, FieldDefinition, InsertionProgress } from './import.types';
import type { SchemaCategory } from 'src/data/schemas/dto/create-schema.dto';

// ─── GET /import/:companyId/job ───────────────────────────────────────────────

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
  sample?: Record<string, any>[];
  hasHeader?: boolean;
  headerConfidence?: number;
  warnings?: string[];

  // Fase B
  progreso?: InsertionProgress;

  // Solo si status === 'failed'
  lastError?: string;

  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
}

// ─── POST /import/:companyId ──────────────────────────────────────────────────

export interface StartImportResponse {
  jobId: string;
}

// ─── DELETE /import/:companyId/job ────────────────────────────────────────────

export interface DiscardJobResponse {
  discarded: boolean;
  message: string;
}

// ─── POST /import/:companyId/confirm ─────────────────────────────────────────

export interface ConfirmSchemaOnlyResponse {
  schemaId: string;
}

export interface ConfirmSchemaAndDataResponse {
  schemaId: string;
  jobId: string;
}