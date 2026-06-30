import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PersistenceService } from 'src/common/services/percistence/persistence.service';
import { MongoOrmService } from 'src/mongoose/mongoose.service';
import { SchemaModel, SchemaModelSchema } from 'src/mongoose/schemas.schema';
import {
  DocumentModel,
  DocumentModelSchema,
} from 'src/mongoose/documents.schema';
import { DtoService } from './dto/dto.service';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { IndexingService } from '../../indexing/indexing/indexing.service'
import { QdrantService } from '../../qdrant/qdrant.service';
import { AutoFieldType } from '../schemas/dto/create-schema.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly persistence: PersistenceService,
    private readonly dtoService: DtoService,
    private readonly indexing: IndexingService,
    private readonly qdrant: QdrantService,
  ) {}

  // --- Crear múltiples documentos ---
  async createDocuments(
    companyId: string,
    schemaId: string,
    createDto: any,
     strict: boolean = true,  
  ) {
    const documents = createDto;
    if (!documents || documents.length === 0) {
      throw new BadRequestException({
        message: 'No se enviaron documentos para crear.',
        details: 'Array `documents` vacío o indefinido.',
      });
    }

    const schemaModel = await this.persistence.getTenantModel<SchemaModel>(
      companyId,
      'Schema',
      SchemaModelSchema,
    );
    const schemaOrm = new MongoOrmService<SchemaModel>(schemaModel);
    const schema = await schemaOrm.findById(schemaId);
    if (!schema) {
      throw new NotFoundException({
        message: `El esquema "${schemaId}" no existe.`,
        details: `Schema con id ${schemaId} no encontrado.`,
      });
    }

    this.dtoService.validateDataAgainstSchema(
      documents,
      schema,
      { isArray: true, strict},
    );

    const docModel = await this.persistence.getTenantModel<DocumentModel>(
      companyId,
      'Document',
      DocumentModelSchema,
    );
    const docOrm = new MongoOrmService<DocumentModel>(docModel);


    const batchId   = uuidv4();
   const timestamp = new Date().toISOString();
   
    const created = await docOrm.transaction(async (ormScoped) => {
      const results: any[] = [];
      for (const data of documents) {
           const resolvedData = this.resolveAutoFields(data, schema.fields, { batchId, timestamp });
   
        const toCreate = {
           data: resolvedData, 
          company_id: companyId,
          schema_id: schemaId,
          category: schema.category,
        };
        const newDoc = await ormScoped.create(toCreate);
        results.push(newDoc);
      }
      return results;
    });

    // ── Indexado en background — fuera de la transacción ─────────────────
    // Si falla Qdrant no hace rollback de los documentos ya creados.
    // La cola reintentará automáticamente.
    this.indexing.indexDocuments(
      created.map((doc) => ({
        documentId:   doc._id.toString(),
        schemaId,
        companyId,
        category:     schema.category,
        documentData: doc.data,
        schemaFields: schema.fields,
      })),
    );

    return created;
  }

  // --- Crear un documento ---
  async createDocument(
    companyId: string,
    schemaId: string,
    dto: any,
    
  ) {
    const schemaModel = await this.persistence.getTenantModel<SchemaModel>(
      companyId,
      'Schema',
      SchemaModelSchema,
    );
    const schemaOrm = new MongoOrmService<SchemaModel>(schemaModel);
    const schema = await schemaOrm.findById(schemaId);
    if (!schema) {
      throw new NotFoundException({
        message: `El esquema "${schemaId}" no existe.`,
        details: `Schema con id ${schemaId} no encontrado.`,
      });
    }

    this.dtoService.validateDataAgainstSchema(dto, schema, { strict: true });

    const docModel = await this.persistence.getTenantModel<DocumentModel>(
      companyId,
      'Document',
      DocumentModelSchema,
    );
    const docOrm = new MongoOrmService<DocumentModel>(docModel);

    const batchId   = uuidv4();
    const timestamp = new Date().toISOString();

    const resolvedData = this.resolveAutoFields(dto, schema.fields, { batchId, timestamp });


    const created = await docOrm.create({
      data: resolvedData, 
      company_id: companyId,
      schema_id: schemaId,
      category: schema.category,
    });

    // ── Indexado en background ────────────────────────────────────────────
    this.indexing.indexDocument({
      documentId:   (created as any)._id.toString(),
      schemaId,
      companyId,
      category:     schema.category,
      documentData: resolvedData, 
      schemaFields: schema.fields,
    });

    return created;
  }

  // --- Actualizar un documento ---
  async updateDocument(
    companyId: string,
    schemaId: string,
    id: string,
    dto: UpdateDocumentDto,
  ) {
    const docModel = await this.persistence.getTenantModel<DocumentModel>(
      companyId,
      'Document',
      DocumentModelSchema,
    );
    const docOrm = new MongoOrmService<DocumentModel>(docModel);

    const existing = await docOrm.findById(id);
    if (!existing) {
      throw new NotFoundException({
        message: `El documento "${id}" no existe.`,
        details: `Document con id ${id} no encontrado.`,
      });
    }

    const schemaModel = await this.persistence.getTenantModel<SchemaModel>(
      companyId,
      'Schema',
      SchemaModelSchema,
    );
    const schemaOrm = new MongoOrmService<SchemaModel>(schemaModel);
    const schema = await schemaOrm.findById(schemaId);
    if (!schema) {
      throw new NotFoundException({
        message: `El esquema "${schemaId}" no existe.`,
        details: `Schema con id ${schemaId} no encontrado.`,
      });
    }

    let cleanData: Record<string, any> | undefined = undefined;

    if (dto.data !== undefined) {
      this.dtoService.validateDataAgainstSchema(dto.data, schema, {
        strict: false,
        partial: false,
      });

      const allowed = schema.fields.map((f) => f.name);
      cleanData = Object.keys(dto.data || {}).reduce((acc, key) => {
        if (allowed.includes(key)) acc[key] = dto.data![key];
        return acc;
      }, {} as Record<string, any>);
    }

    const toUpdate: any = { ...dto };
    if (cleanData !== undefined) toUpdate.data = cleanData;

    const updated = await docOrm.updateById(id, toUpdate);

    // ── Re-indexar en background si cambió el data ────────────────────────
    if (cleanData !== undefined) {
      this.indexing.indexDocument({
        documentId:   id,
        schemaId,
        companyId,
        category:     schema.category,
        documentData: cleanData,
        schemaFields: schema.fields,
      });
    }

    return updated;
  }

  // --- Eliminar múltiples documentos ---
  async deleteDocuments(
    companyId: string,
    schemaId: string,
    ids: string[],
  ) {
    if (!ids || ids.length === 0) {
      throw new BadRequestException({
        message: 'No se enviaron IDs para eliminar.',
        details: 'Array `ids` vacío o indefinido.',
      });
    }

    const cleanedIds = ids.map((id) => id.trim()).filter((id) => id.length > 0);

    if (cleanedIds.length === 0) {
      throw new BadRequestException({
        message: 'Todos los IDs están vacíos después de limpiar espacios.',
      });
    }

    const docModel = await this.persistence.getTenantModel<DocumentModel>(
      companyId,
      'Document',
      DocumentModelSchema,
    );
    const docOrm = new MongoOrmService<DocumentModel>(docModel);

    // ── Eliminar de Qdrant en background antes de borrar en Mongo ─────────
    for (const id of cleanedIds) {
      this.qdrant
        .delete('documents', {
          must: [{ key: 'document_id', match: { value: id } }],
        })
        .catch((err) =>
          this.logger.warn(
            `No se pudo eliminar vector de Qdrant para doc="${id}": ${err.message}`,
          ),
        );
    }

    return docOrm.transaction(async (ormScoped) => {
      const results: any[] = [];
      for (const id of cleanedIds) {
        const deleted = await ormScoped.deleteById(id);
        results.push(deleted);
      }
      return results;
    });
  }

  // --- Eliminar uno ---
  async deleteDocument(
    companyId: string,
    schemaId: string,
    id: string,
  ) {
    const docModel = await this.persistence.getTenantModel<DocumentModel>(
      companyId,
      'Document',
      DocumentModelSchema,
    );
    const docOrm = new MongoOrmService<DocumentModel>(docModel);

    // ── Eliminar de Qdrant en background ─────────────────────────────────
    this.qdrant
      .delete('documents', {
        must: [{ key: 'document_id', match: { value: id } }],
      })
      .catch((err) =>
        this.logger.warn(
          `No se pudo eliminar vector de Qdrant para doc="${id}": ${err.message}`,
        ),
      );

    return docOrm.deleteById(id);
  }

  // --- Obtener todos ---
  async findAll(companyId: string, schemaId: string, filter: any = {}) {
    const docModel = await this.persistence.getTenantModel<DocumentModel>(
      companyId,
      'Document',
      DocumentModelSchema,
    );
    const docOrm = new MongoOrmService<DocumentModel>(docModel);

    const finalFilter = { ...filter, schema_id: schemaId };
    return docOrm.findAll(finalFilter);
  }

  // --- Obtener uno ---
  async findOne(companyId: string, schemaId: string, id: string) {
    const docModel = await this.persistence.getTenantModel<DocumentModel>(
      companyId,
      'Document',
      DocumentModelSchema,
    );
    const docOrm = new MongoOrmService<DocumentModel>(docModel);

    const doc = await docOrm.findById(id);
    if (!doc) {
      throw new NotFoundException({
        message: `El documento "${id}" no existe.`,
        details: `Document con id ${id} no encontrado.`,
      });
    }

    if (doc.schema_id !== schemaId) {
      throw new BadRequestException({
        message: `El documento "${id}" no pertenece al esquema "${schemaId}".`,
        details: `schema_id real: ${doc.schema_id}`,
      });
    }

    return doc;
  }

  // ── Helper: resuelve valores automáticos ──────────────────────────────────
private resolveAutoFields(
  data: Record<string, any>,
  fields: SchemaModel['fields'],
  context: { batchId: string; timestamp: string },
): Record<string, any> {
  const result = { ...data };

  for (const field of fields) {
    if (!field.auto) continue;

    switch (field.auto) {
      case AutoFieldType.UUID:
        result[field.name] = uuidv4();
        break;
      case AutoFieldType.TIMESTAMP:
        result[field.name] = context.timestamp;
        break;
      case AutoFieldType.BATCH_ID:
        result[field.name] = context.batchId;
        break;
    }
  }

  return result;
}
}