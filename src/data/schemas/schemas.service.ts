import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MongoOrmService } from 'src/mongoose/mongoose.service';
import { SchemaModel } from '../../mongoose/schemas.schema';
import { CreateSchemaDto } from './dto/create-schema.dto';

@Injectable()
export class SchemasService {
  private readonly orm: MongoOrmService<SchemaModel>;

  constructor(@InjectModel('Schema') schemaModel: Model<SchemaModel>) {
    this.orm = new MongoOrmService(schemaModel);
  }

  async createSchema(data: CreateSchemaDto) {
    try {
      return this.orm.create(data);
    } catch (error) {
      // Log or handle the error appropriately
      console.error('Error creating schema:', error);
      throw error; // Re-throw the error after handling
    }
  }

  async getSchemasByCompany(company_id: string, deleted?: boolean) {
    try {
      const query: any = { company_id };
      if (deleted !== undefined) {
        query.deleted = deleted;
      } else {
        query.deleted = false; // Default to not deleted
      }
      return this.orm.findAll(query);
    } catch (error) {
      console.error('Error getting schemas by company:', error);
      throw error;
    }
  }

  async getSchemaById(id: string, deleted?: boolean) {
    try {
      const query: any = { _id: id };
      if (deleted !== undefined) {
        query.deleted = deleted;
      } else {
        query.deleted = false; // Default to not deleted
      }
      const schema = await this.orm.findOne(query);
      if (!schema) {
        throw new NotFoundException(`Schema with ID "${id}" not found.`);
      }
      return schema;
    } catch (error) {
      console.error('Error getting schema by ID:', error);
      throw error;
    }
  }

  async updateSchema(id: string, data: any) {
    console.log(data);
    try {
      const existingSchema = await this.orm.findOne({ _id: id, deleted: false });
      if (!existingSchema) {
        throw new NotFoundException(`Schema with ID "${id}" not found or is deleted.`);
      }

      // Basic validation for fields structure (can be expanded)
      if (data.fields) {
        // Check if the number of fields matches (a simple check)
        if (data.fields.length !== existingSchema.fields.length) {
             throw new BadRequestException('Cannot change the number of fields in an existing schema.');
        }
        // More detailed validation could compare field names and types
        // For simplicity, we'll allow updates to existing fields but not structural changes
      }


      return this.orm.updateById(id, data);
    } catch (error) {
      console.error('Error updating schema:', error);
      throw error;
    }
  }

  async deleteSchema(id: string, hard?: boolean) {
    try {
      const existingSchema = await this.orm.findOne({ _id: id, deleted: hard?true:false });
      console.log(existingSchema);
      if (!existingSchema) {
        throw new NotFoundException(`Schema with ID "${id}" not found or is already deleted.`);
      }

      if (hard) {
       const del= this.orm.deleteById(id);
       console.log(del);
       return del;
      } else {
        const del= this.orm.updateById(id, { deleted: true });
        console.log(del);
       return del;
      }
    } catch (error) {
      console.error('Error deleting schema:', error);
      throw error;
    }
  }
}
