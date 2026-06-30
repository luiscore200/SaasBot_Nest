import { CreateSchemaFieldDto, SchemaCategory } from 'src/data/schemas/dto/create-schema.dto';

export { FieldType, SchemaCategory, AutoFieldType } from 'src/data/schemas/dto/create-schema.dto';

export type FieldDefinition = Omit<CreateSchemaFieldDto, 'auto'>;

export type ImportJobStatus =
  | 'pending'
  | 'analyzing'
  | 'preview_ready'
  | 'loading_data'
  | 'awaiting_decision'    // Fase B pausada esperando al usuario
  | 'completed'
  | 'completed_with_errors'
  | 'failed';

export interface InsertionProgress {
  insertados: number;
  errores: number;
  total: number;
}

export interface ImportJob {
  jobId: string;
  companyId: string;
  name: string;
  description?: string;
  filePath: string;
  originalName: string;
  status: ImportJobStatus;

  // Resultado Fase A
  schema?: FieldDefinition[];
  category?: SchemaCategory;
  sample?: any[];
  hasHeader?: boolean;
  headerConfidence?: number;
  warnings?: string[];

  // Fase B
  schemaId?: string;             // ID del schema creado en Mongo al confirmar
  progreso?: InsertionProgress;
  schemaNuevo?: FieldDefinition[]; // schema propuesto en reformulación Fase B

  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnqueueImportPayload {
  companyId: string;
  name: string;
  description?: string;
  filePath: string;
  originalName: string;
}