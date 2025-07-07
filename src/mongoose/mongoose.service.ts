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
  ) {}

  private normalizeSession(s?: ClientSession): ClientSession | null {
    return s || null;
  }

  async create(data: Partial<T>, session?: ClientSession) {
    try {
      const s = this.normalizeSession(session || this.session);
      const doc = new this.model(data);
      return s ? await doc.save({ session: s }) : await doc.save();
    } catch (error: any) {
      console.error(`[MongoOrmService][create]`, error);

      if (error?.name === 'ValidationError') {
        throw new BadRequestException({
          message: 'Datos inválidos. Verifica los campos enviados.',
          details: error.message,
        });
      }

      throw new InternalServerErrorException({
        message: 'Error inesperado al crear el recurso.',
        details: error.message,
      });
    }
  }

  async findAll(filter: any = {}, session?: ClientSession) {
    try {
      const s = this.normalizeSession(session || this.session);
      return this.model.find(filter).session(s).exec();
    } catch (error: any) {
      console.error(`[MongoOrmService][findAll]`, error);

      throw new InternalServerErrorException({
        message: 'Error inesperado al obtener los recursos.',
        details: error.message,
      });
    }
  }

  async findOne(filter: any, session?: ClientSession) {
    try {
      const s = this.normalizeSession(session || this.session);
      const doc = await this.model.findOne(filter).session(s).exec();

      if (!doc) {
        throw new NotFoundException({
          message: 'Recurso no encontrado.',
          details: `Filtro: ${JSON.stringify(filter)}`,
        });
      }

      return doc;
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;

      console.error(`[MongoOrmService][findOne]`, error);

      throw new InternalServerErrorException({
        message: 'Error inesperado al buscar el recurso.',
        details: error.message,
      });
    }
  }

  async findById(id: string, session?: ClientSession) {
    try {
      const s = this.normalizeSession(session || this.session);
      const doc = await this.model.findById(id).session(s).exec();

      if (!doc) {
        throw new NotFoundException({
          message: 'Recurso no encontrado por ID.',
          details: `ID: ${id}`,
        });
      }

      return doc;
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;

      console.error(`[MongoOrmService][findById]`, error);

      throw new InternalServerErrorException({
        message: 'Error inesperado al buscar por ID.',
        details: error.message,
      });
    }
  }

  async updateById(id: string, data: Partial<T>, session?: ClientSession) {
    try {
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
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;

      console.error(`[MongoOrmService][updateById]`, error);

      throw new InternalServerErrorException({
        message: 'Error inesperado al actualizar el recurso.',
        details: error.message,
      });
    }
  }

  async deleteById(id: string, session?: ClientSession) {
    try {
      const s = this.normalizeSession(session || this.session);
      const deleted = await this.model.findByIdAndDelete(id, { session: s }).exec();

      if (!deleted) {
        throw new NotFoundException({
          message: 'No se encontró el recurso para eliminar.',
          details: `ID: ${id}`,
        });
      }

      return deleted;
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;

      console.error(`[MongoOrmService][deleteById]`, error);

      throw new InternalServerErrorException({
        message: 'Error inesperado al eliminar el recurso.',
        details: error.message,
      });
    }
  }

  async count(filter: any = {}, session?: ClientSession) {
    try {
      const s = this.normalizeSession(session || this.session);
      return this.model.countDocuments(filter).session(s).exec();
    } catch (error: any) {
      console.error(`[MongoOrmService][count]`, error);

      throw new InternalServerErrorException({
        message: 'Error inesperado al contar los recursos.',
        details: error.message,
      });
    }
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
