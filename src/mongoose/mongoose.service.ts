// src/common/mongoose.service.ts

import { Model } from 'mongoose';

export class MongoOrmService<T> {
  constructor(protected readonly model: Model<T>) {}

  async create(data: Partial<T>) {
    return new this.model(data).save();
  }

  async findAll(filter: any = {}) {
    return this.model.find(filter).exec();
  }

  async findOne(filter: any) {
    return this.model.findOne(filter).exec();
  }

  async findById(id: string) {
    return this.model.findById(id).exec();
  }

  async updateById(id: string, data: Partial<T>) {
    return this.model.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async deleteById(id: string) {
    return this.model.findByIdAndDelete(id).exec();
  }

  async count(filter: any = {}) {
    return this.model.countDocuments(filter).exec();
  }
}
