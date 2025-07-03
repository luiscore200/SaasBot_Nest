import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MongoOrmService } from 'src/mongoose/mongoose.service';
import { SchemaModel } from '../../mongoose/schemas.schema';

@Injectable()
export class SchemasService {
  private readonly orm: MongoOrmService<SchemaModel>;

  constructor(@InjectModel('Schema') schemaModel: Model<SchemaModel>) {
    this.orm = new MongoOrmService(schemaModel);
  }

  async createSchema(data: any) {
    return this.orm.create(data);
  }

  async getSchemasByCompany(company_id: string) {
    return this.orm.findAll({ company_id });
  }

  async getSchemaById(id: string) {
    return this.orm.findById(id);
  }

  async updateSchema(id: string, data: any) {
    return this.orm.updateById(id, data);
  }

  async deleteSchema(id: string) {
    return this.orm.deleteById(id);
  }
}
