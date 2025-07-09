import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PersistenceService } from 'src/common/services/percistence/persistence.service';
import { MongoOrmService } from 'src/mongoose/mongoose.service';
import { SchemaModel, SchemaModelSchema } from 'src/mongoose/schemas.schema';
import {
  DocumentItem,
  DocumentModel,
  DocumentModelSchema,
} from 'src/mongoose/documents.schema';
import { DtoService } from './dto/dto.service';
import { UpdateDocumentDto } from './dto/update-document.dto';


@Injectable()
export class DocumentsService {
  constructor(
    private readonly persistence: PersistenceService,
    private readonly dtoService: DtoService,
  ) {}

  // --- Crear múltiples documentos ---
  async createDocuments(
    companyId: string,
    schemaId: string,
    createDto: any,
  ) {
    try {
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
  
      // ✅ Valida cada `doc` como un objeto `data`
      this.dtoService.validateDataAgainstSchema(
        documents,
        schema,
        { isArray: true, strict: true },
      );
  
      const docModel = await this.persistence.getTenantModel<DocumentModel>(
        companyId,
        'Document',
        DocumentModelSchema,
      );
      const docOrm = new MongoOrmService<DocumentModel>(docModel);
  
      return docOrm.transaction(async (ormScoped) => {
        const created: any[] = [];
        for (const data of documents) {
          const toCreate = {
            data, // 👈 cada item es la `data` pura
            company_id: companyId,
            schema_id: schemaId,
            category: schema.category,
          };
          const newDoc = await ormScoped.create(toCreate);
          created.push(newDoc);
        }
        return created;
      });
    } catch (error: any) {
      console.error(`[DocumentsService][createDocuments]`, error);
      throw new InternalServerErrorException({
        message: 'No se pudieron crear los documentos.',
        details: error.message,
      });
    }
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

      this.dtoService.validateDataAgainstSchema(dto, schema, {
        strict: true,
      });

  
      const docModel = await this.persistence.getTenantModel<DocumentModel>(
        companyId,
        'Document',
        DocumentModelSchema,
      );
      const docOrm = new MongoOrmService<DocumentModel>(docModel);

      const toCreate = {
        data:dto,
        company_id: companyId,
        schema_id: schemaId,
        category:  schema.category,
      };

      return await docOrm.create(toCreate);
   
  }

  // --- Actualizar un documento ---
  async updateDocument(
    companyId: string,
    schemaId: string,
    id: string,
    dto: UpdateDocumentDto,
  ) {
    try {
      // --- Paso 1: Obtener el modelo y ORM
      const docModel = await this.persistence.getTenantModel<DocumentModel>(
        companyId,
        'Document',
        DocumentModelSchema,
      );
      const docOrm = new MongoOrmService<DocumentModel>(docModel);
  
      // --- Paso 2: Verificar existencia del documento
      const existing = await docOrm.findById(id);
      if (!existing) {
        throw new NotFoundException({
          message: `El documento "${id}" no existe.`,
          details: `Document con id ${id} no encontrado.`,
        });
      }
  
      // --- Paso 3: Obtener el esquema
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
  
      // --- Paso 4: Si hay `data`, validarla como partial y limpiar
      let cleanData: Record<string, any> | undefined = undefined;
  
      if (dto.data !== undefined) {
        // Validar
        this.dtoService.validateDataAgainstSchema(dto.data, schema, {
          strict: false,
          partial: false,
        });
      
        // Filtrar solo campos permitidos del schema
        const allowed = schema.fields.map(f => f.name);
      
        cleanData = Object.keys(dto.data || {}).reduce((acc, key) => {
          if (allowed.includes(key)) {
            acc[key] = dto.data![key]; // <-- usa el `!` porque ya verificaste que no es undefined
          }
          return acc;
        }, {} as Record<string, any>);
      }
  
      // --- Paso 5: Construir el objeto final a actualizar
      const toUpdate: any = {
        ...dto,
      };
  
      if (cleanData !== undefined) {
        toUpdate.data = cleanData;
      }
  
      // --- Paso 6: Actualizar
      return await docOrm.updateById(id, toUpdate);
    } catch (error: any) {
      console.error(`[DocumentsService][updateDocument]`, error);
      throw new InternalServerErrorException({
        message: 'No se pudo actualizar el documento.',
        details: error.message,
      });
    }
  }
  
  // --- Eliminar múltiples documentos ---
  async deleteDocuments(
    companyId: string,
    schemaId: string,
    ids: string[],
  ) {
   
      console.log(ids);
      if (!ids || ids.length === 0) {
        throw new BadRequestException({
          message: 'No se enviaron IDs para eliminar.',
          details: 'Array `ids` vacío o indefinido.',
        });
      }
  
      // 🧹 Normaliza y limpia cada ID
      const cleanedIds = ids.map(id => id.trim()).filter(id => id.length > 0);
  
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
    try {
      const docModel = await this.persistence.getTenantModel<DocumentModel>(
        companyId,
        'Document',
        DocumentModelSchema,
      );
      const docOrm = new MongoOrmService<DocumentModel>(docModel);

      const deleted = await docOrm.deleteById(id);
      return deleted;
    } catch (error: any) {
      console.error(`[DocumentsService][deleteDocument]`, error);
      throw new InternalServerErrorException({
        message: 'No se pudo eliminar el documento.',
        details: error.message,
      });
    }
  }

  // --- Obtener todos ---
  async findAll(companyId: string, schemaId: string, filter: any = {}) {
    try {
      const docModel = await this.persistence.getTenantModel<DocumentModel>(
        companyId,
        'Document',
        DocumentModelSchema,
      );
      const docOrm = new MongoOrmService<DocumentModel>(docModel);
      console.log(schemaId);
      const finalFilter = { ...filter, schema_id: schemaId };
      console.log(finalFilter);
      return await docOrm.findAll(finalFilter);
    } catch (error: any) {
      console.error(`[DocumentsService][findAll]`, error);
      throw new InternalServerErrorException({
        message: 'No se pudieron obtener los documentos.',
        details: error.message,
      });
    }
  }

  // --- Obtener uno ---
  async findOne(companyId: string, schemaId: string, id: string) {
    try {
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
    } catch (error: any) {
      console.error(`[DocumentsService][findOne]`, error);
      throw new InternalServerErrorException({
        message: 'No se pudo obtener el documento.',
        details: error.message,
      });
    }
  }
}
