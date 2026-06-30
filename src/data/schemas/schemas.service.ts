import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { MongoOrmService } from 'src/mongoose/mongoose.service';
import {
  SchemaDocument,
  SchemaModel,
  SchemaModelSchema,
} from '../../mongoose/schemas.schema';
import { CreateSchemaDto } from './dto/create-schema.dto';
import { PersistenceService } from 'src/common/services/percistence/persistence.service';
import { EnrichmentService } from '../../embedding/enrichment/enrichment.service';
import { CascadeService } from '../cascade.service';

@Injectable()
export class SchemasService {

  constructor(
    private readonly persistence: PersistenceService,
    private readonly enrichment: EnrichmentService,
    private readonly cascade: CascadeService,
  ) {}

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

    // ── Enriquecimiento semántico en segundo plano ─────────────────────────
    const createdDoc = created.toObject() as SchemaModel & { _id: any };
    this.enrichment.enrichSchema({
      _id: createdDoc._id.toString(),
      company_id: companyId,
      name: createdDoc.name,
      description: createdDoc.description,
      fields: createdDoc.fields,
    });

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

    return (await orm.findAll(query)).reverse();
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
   * Si se desactiva (active=false), propaga la desactivación en cascada
   * a mapflows, bots y widgets asociados.
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

    // ── Cascade al desactivar ──────────────────────────────────────────────
    if (data.active === false) {
      await this.cascade.onSchemaDeactivated(companyId, id);
    }

    // ── Re-enriquecimiento en segundo plano ────────────────────────────────
    if (data.fields?.length) {
      const updatedDoc = updated.toObject() as SchemaModel & { _id: any };
      this.enrichment.enrichUpdatedFields(
        {
          _id: id,
          company_id: companyId,
          name: updatedDoc.name,
          description: updatedDoc.description,
        },
        data.fields,
      );
    }

    return updated;
  }

  /**
   * Activa o desactiva un esquema explícitamente.
   * Al desactivar, propaga la desactivación en cascada a mapflows, bots y widgets.
   */
  async toggleSchemaActive(companyId: string, id: string, active: boolean) {
    const model = await this.persistence.getTenantModel<SchemaModel>(
      companyId,
      'Schema',
      SchemaModelSchema,
    );
    const orm = new MongoOrmService<SchemaModel>(model);

    const existing = await orm.findOne({ _id: id, deleted: false });
    if (!existing) {
      throw new NotFoundException({
        message: `No se encontró un esquema con ID "${id}".`,
      });
    }

    const updated = await orm.updateById(id, { active });

    // ── Cascade al desactivar ──────────────────────────────────────────────
    if (!active) {
      await this.cascade.onSchemaDeactivated(companyId, id);
    }

    await this.persistence.refreshSchemas();
    return updated;
  }

  /**
   * Elimina un esquema (soft o hard delete).
   *
   * Hard delete:
   *   1. Elimina físicamente todos los documentos del schema en Mongo y Qdrant
   *   2. Elimina físicamente los mapflows que usaban este schema (y sus runtimes)
   *   3. Desanexa el mapflow de los bots afectados y los desactiva
   *   4. Desactiva los widgets de esos bots
   *   5. Elimina físicamente el schema
   *
   * Soft delete:
   *   1. Desactiva los mapflows que usaban este schema
   *   2. Desactiva los bots de esos mapflows
   *   3. Desactiva los widgets de esos bots
   *   4. Marca el schema como deleted=true (documentos se conservan)
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

    // ── Cascade ANTES de eliminar/desactivar el schema ─────────────────────
    await this.cascade.onSchemaRemoved(companyId, id, !!hard);

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