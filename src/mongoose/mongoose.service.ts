import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Model, Connection, ClientSession } from 'mongoose';

/**
 * Generic Mongo ORM Service for reusable CRUD with transactions.
 */
export class MongoOrmService<T> {
  constructor(
    protected readonly model: Model<T>,
    protected readonly connection?: Connection,
    protected readonly session?: ClientSession,
  ) {
    this.connection = connection || model.db;
  }

  private normalizeSession(s?: ClientSession): ClientSession | null {
    return s || null;
  }

  async create(data: Partial<T>, session?: ClientSession) {
 
      const s = this.normalizeSession(session || this.session);
      const doc = new this.model(data);
      return s ? await doc.save({ session: s }) : await doc.save();
   
  }

  async findAll(filter: any = {}, session?: ClientSession) {
   
      const s = this.normalizeSession(session || this.session);
      return this.model.find(filter).session(s).exec();
   
  }

  async findOne(filter: any, session?: ClientSession) {
    
      const s = this.normalizeSession(session || this.session);
      const doc = await this.model.findOne(filter).session(s).exec();

      if (!doc) {
        throw new NotFoundException({
          message: 'Recurso no encontrado.',
          details: `Filtro: ${JSON.stringify(filter)}`,
        });
      }

      return doc;
   
  }

  async findById(id: string, session?: ClientSession) {
   
      const s = this.normalizeSession(session || this.session);
      const doc = await this.model.findById(id).session(s).exec();

      if (!doc) {
        throw new NotFoundException({
          message: 'Recurso no encontrado por ID.',
          details: `ID: ${id}`,
        });
      }

      return doc;
    
  }

  async updateById(id: string, data: Partial<T>, session?: ClientSession) {
  
      const s = this.normalizeSession(session || this.session);
      const updated = await this.model
        .findByIdAndUpdate(id, data, { new: true, session: s })
        .exec();

      if (!updated) {
        throw new NotFoundException({
          message: 'No se encontró el recurso para actualizar.',
          details: `ID: ${id}`,
        });
      }

      return updated;
 
  }

  async deleteById(id: string, session?: ClientSession) {
   
      const s = this.normalizeSession(session || this.session);
      const deleted = await this.model.findByIdAndDelete(id, { session: s }).exec();

      if (!deleted) {
        throw new NotFoundException({
          message: 'No se encontró el recurso para eliminar.',
          details: `ID: ${id}`,
        });
      }

      return deleted;
    
  }

  async count(filter: any = {}, session?: ClientSession) {
    
      const s = this.normalizeSession(session || this.session);
      return this.model.countDocuments(filter).session(s).exec();
   
  }

  async transaction<R>(operations: (orm: MongoOrmService<T>) => Promise<R>): Promise<R> {
    if (!this.connection) {
      throw new InternalServerErrorException({
        message: 'No hay conexión de base de datos para transacciones.',
      });
    }

    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const scopedOrm = new MongoOrmService<T>(this.model, this.connection, session);
      const result = await operations(scopedOrm);
      await session.commitTransaction();
      return result;
    } catch (error: any) {
      await session.abortTransaction();
      console.error(`[MongoOrmService][transaction]`, error);

      throw new InternalServerErrorException({
        message: 'Error inesperado durante la transacción.',
        details: error.message,
      });
    } finally {
      session.endSession();
    }
  }
}
