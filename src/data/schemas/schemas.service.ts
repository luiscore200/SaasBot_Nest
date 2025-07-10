import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { MongoOrmService } from 'src/mongoose/mongoose.service';
import {
  SchemaDocument,
  SchemaModel,
  SchemaModelSchema,
} from '../../mongoose/schemas.schema';
import { CreateSchemaDto } from './dto/create-schema.dto';
import { PersistenceService } from 'src/common/services/percistence/persistence.service';

@Injectable()
export class SchemasService {


  constructor(private readonly persistence: PersistenceService) {}

  /**
   * Crea un esquema en la DB del cliente correcto.
   */
  async createSchema(companyId: string, data: CreateSchemaDto) {

      const model = await this.persistence.getTenantModel<SchemaModel>(
        companyId,
        'Schema',
        SchemaModelSchema,
      );
      const orm = new MongoOrmService<SchemaModel>(model);

      const created = await orm.create(data);
      await this.persistence.refreshSchemas();

      return created;
  
  }

  /**
   * Lista esquemas desde la DB del cliente.
   */
  async getSchemasByCompany(companyId: string, deleted?: boolean) {

      const model = await this.persistence.getTenantModel<SchemaModel>(
        companyId,
        'Schema',
        SchemaModelSchema,
      );
      const orm = new MongoOrmService<SchemaModel>(model);

      const query: any = { company_id: companyId };
      query.deleted = deleted !== undefined ? deleted : false;

      return orm.findAll(query);
  
  }

  /**
   * Obtiene un esquema por ID desde la DB correcta.
   */
  async getSchemaById(companyId: string, id: string, deleted?: boolean) {
  
      const model = await this.persistence.getTenantModel<SchemaModel>(
        companyId,
        'Schema',
        SchemaModelSchema,
      );
      const orm = new MongoOrmService<SchemaModel>(model);

      const query: any = { _id: id };
      query.deleted = deleted !== undefined ? deleted : false;

      const schema = await orm.findOne(query);
      if (!schema) {
        throw new NotFoundException({
          message: `No se encontró un esquema con ID "${id}".`,
        });
      }

      return schema;
   
  }

  /**
   * Actualiza un esquema.
   */
  async updateSchema(companyId: string, id: string, data: any) {
  
      const model = await this.persistence.getTenantModel<SchemaModel>(
        companyId,
        'Schema',
        SchemaModelSchema,
      );
      const orm = new MongoOrmService<SchemaModel>(model);

      const existing = await orm.findOne({ _id: id, deleted: false });
      if (!existing) {
        throw new NotFoundException({
          message: `No se encontró un esquema con ID "${id}" o está eliminado.`,
        });
      }

      if (data.fields) {
        if (data.fields.length !== existing.fields.length) {
          throw new BadRequestException({
            message: 'No se puede cambiar la cantidad de campos del esquema.',
          });
        }
      }

      const updated = await orm.updateById(id, data);
      await this.persistence.refreshSchemas();
      return updated;
 
  }

  /**
   * Elimina un esquema (soft o hard delete).
   */
  async deleteSchema(companyId: string, id: string, hard?: boolean) {
   
      const model = await this.persistence.getTenantModel<SchemaModel>(
        companyId,
        'Schema',
        SchemaModelSchema,
      );
      const orm = new MongoOrmService<SchemaModel>(model);

      const existing = await orm.findOne({ _id: id });
      if (!existing) {
        throw new NotFoundException({
          message: `No se encontró un esquema con ID "${id}".`,
        });
      }

      let result;
      if (hard) {
        result = await orm.deleteById(id);
      } else {
        result = await orm.updateById(id, { deleted: true });
      }

      await this.persistence.refreshSchemas();
      return result;
    }
}
