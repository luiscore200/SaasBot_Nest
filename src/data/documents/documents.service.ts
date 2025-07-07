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
import {
  CreateDocumentDto,
  SingleDocumentDto,
} from './dto/create-document.dto';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly persistence: PersistenceService,
    private readonly dtoService: DtoService,
  ) {}

  async createDocuments(companyId: string, createDto: CreateDocumentDto) {
    try {
      const { documents } = createDto;

      if (!documents || documents.length === 0) {
        throw new BadRequestException({
          message: 'No se enviaron documentos para crear.',
          details: 'Array `documents` vacío o indefinido.',
        });
      }

      const schemaId = documents[0].schema_id;

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
          details: `Schema con id ${schemaId} no encontrado en la base.`,
        });
      }

      this.dtoService.validateDataAgainstSchema(
        documents.map((d) => d.data),
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
        for (const doc of documents) {
          const toCreate = {
            ...doc,
            company_id: companyId,
            category: doc.category || schema.category,
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

  async updateDocuments(companyId: string, updates: SingleDocumentDto[]) {
    try {
      if (!updates || updates.length === 0) {
        throw new BadRequestException({
          message: 'No se enviaron documentos para actualizar.',
          details: 'Array `updates` vacío o indefinido.',
        });
      }

      const docModel = await this.persistence.getTenantModel<DocumentModel>(
        companyId,
        'Document',
        DocumentModelSchema,
      );
      const docOrm = new MongoOrmService<DocumentModel>(docModel);

      return docOrm.transaction(async (ormScoped) => {
        const updated: any[] = [];
        for (const update of updates) {
          const existing = await ormScoped.findById(update['id']);
          if (!existing) {
            throw new NotFoundException({
              message: `El documento "${update['id']}" no existe.`,
              details: `Document con id ${update['id']} no encontrado.`,
            });
          }

          const schemaModel =
            await this.persistence.getTenantModel<SchemaModel>(
              companyId,
              'Schema',
              SchemaModelSchema,
            );
          const schemaOrm = new MongoOrmService<SchemaModel>(schemaModel);
          const schema = await schemaOrm.findById(update.schema_id);
          if (!schema) {
            throw new NotFoundException({
              message: `El esquema "${update.schema_id}" no existe.`,
              details: `Schema con id ${update.schema_id} no encontrado.`,
            });
          }

          this.dtoService.validateDataAgainstSchema(update.data, schema, {
            strict: true,
          });

          const toUpdate = {
            ...update,
            company_id: companyId,
          };
          const updatedDoc = await ormScoped.updateById(
            update['id'],
            toUpdate,
          );
          updated.push(updatedDoc);
        }
        return updated;
      });
    } catch (error: any) {
      console.error(`[DocumentsService][updateDocuments]`, error);
      throw new InternalServerErrorException({
        message: 'No se pudieron actualizar los documentos.',
        details: error.message,
      });
    }
  }

  async deleteDocuments(companyId: string, ids: string[], hard = false) {
    try {
      if (!ids || ids.length === 0) {
        throw new BadRequestException({
          message: 'No se enviaron IDs para eliminar.',
          details: 'Array `ids` vacío o indefinido.',
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
        for (const id of ids) {
          if (hard) {
            const deleted = await ormScoped.deleteById(id);
            results.push(deleted);
          } else {
            const soft = await ormScoped.updateById(id, { active: false });
            results.push(soft);
          }
        }
        return results;
      });
    } catch (error: any) {
      console.error(`[DocumentsService][deleteDocuments]`, error);
      throw new InternalServerErrorException({
        message: 'No se pudieron eliminar los documentos.',
        details: error.message,
      });
    }
  }

  async findAll(companyId: string, filter: any = {}) {
    try {
      const docModel = await this.persistence.getTenantModel<DocumentModel>(
        companyId,
        'Document',
        DocumentModelSchema,
      );
      const docOrm = new MongoOrmService<DocumentModel>(docModel);
      return docOrm.findAll(filter);
    } catch (error: any) {
      console.error(`[DocumentsService][findAll]`, error);
      throw new InternalServerErrorException({
        message: 'No se pudieron obtener los documentos.',
        details: error.message,
      });
    }
  }

  async findOne(companyId: string, id: string) {
    try {
      const docModel = await this.persistence.getTenantModel<DocumentModel>(
        companyId,
        'Document',
        DocumentModelSchema,
      );
      const docOrm = new MongoOrmService<DocumentModel>(docModel);
      return await docOrm.findById(id);
    } catch (error: any) {
      console.error(`[DocumentsService][findOne]`, error);
      throw new InternalServerErrorException({
        message: 'No se pudo obtener el documento.',
        details: error.message,
      });
    }
  }
}
