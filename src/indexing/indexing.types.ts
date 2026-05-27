// ─── Estado de la Saga por documento ─────────────────────────────────────────

export type DocumentJobStatus =
  | 'pending'       // en cola, sin procesar
  | 'text_done'     // texto enriquecido construido
  | 'embed_done'    // vector generado por groq.embed()
  | 'qdrant_done'   // insertado en Qdrant
  | 'mongo_done'    // vector_id guardado en Mongo ✅
  | 'failed';       // falló tras todos los reintentos

// ─── Job individual (un documento) ───────────────────────────────────────────

export interface DocumentIndexJob {
  // Identidad
  jobId: string;
  documentId: string;
  schemaId: string;
  companyId: string;
  category: string;

  // Datos del documento
  documentData: Record<string, any>;

  // Campos del schema con descripción enriquecida
  schemaFields: Array<{
    name: string;
    type: string;
    description?: string;
  }>;

  // Estado de la saga
  status: DocumentJobStatus;
  enrichedText?: string;   // paso text_done
  vector?: number[];       // paso embed_done
  qdrantId?: string;       // paso qdrant_done

  attempts: number;
  maxAttempts: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Payload propio de este módulo para Qdrant ────────────────────────────────
// QdrantService no conoce este tipo — se lo pasamos como <T>

export interface DocumentQdrantPayload {
  document_id: string;
  schema_id: string;
  company_id: string;
  category: string;
}

// ─── Constantes de la colección ───────────────────────────────────────────────

export const DOCUMENTS_COLLECTION = 'documents';
export const DOCUMENTS_VECTOR_SIZE = 768; // nomic-embed-text