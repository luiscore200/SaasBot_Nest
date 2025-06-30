import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SchemaModel } from '../../mongoose/schemas.schema';
import { CreateSchemaDto } from './dto/create-schema.dto';
import { UpdateSchemaDto } from './dto/update-schema.dto';

@Injectable()
export class SchemasService {
  private readonly logger = new Logger(SchemasService.name);

  constructor(@InjectModel('Schema') private schemaModel: Model<SchemaModel>) {}

  async createSchema(createSchemaDto: CreateSchemaDto): Promise<SchemaModel> {
    try {
      const createdSchema = new this.schemaModel(createSchemaDto);
      return createdSchema.save();
    } catch (error) {
      this.logger.error('Error creating schema', error);
      throw error;
    }
  }

  async getSchemasByCompany(company_id: string): Promise<SchemaModel[]> {
    try {
      return this.schemaModel.find({ company_id }).exec();
    } catch (error) {
      this.logger.error('Error getting schemas by company', error);
      throw error;
    }
  }

  async getSchemaById(id: string): Promise<SchemaModel | null> {
    try {
      return this.schemaModel.findById(id).exec();
    } catch (error) {
      this.logger.error('Error getting schema by ID', error);
      throw error;
    }
  }

  async updateSchema(id: string, data: UpdateSchemaDto): Promise<SchemaModel | null> {
    try {
      return this.schemaModel.findByIdAndUpdate(id, data, { new: true }).exec();
    } catch (error) {
      this.logger.error('Error updating schema', error);
      throw error;
    }
  }

  async deleteSchema(id: string): Promise<SchemaModel | null> {
    try {
      return this.schemaModel.findByIdAndDelete(id).exec();
    } catch (error) {
      this.logger.error('Error deleting schema', error);
      throw error;
    }
  }
}
