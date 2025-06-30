
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SchemaDocument = SchemaModel & Document;

@Schema({ timestamps: true })
export class SchemaModel {
  @Prop({ required: true })
  company_id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  category: string; // inventory | agenda | article

  @Prop({
    required: true,
    type: [
      {
        name: { type: String, required: true },
        type: { type: String, enum: ['string', 'number', 'boolean'], required: true },
        required: { type: Boolean, default: false },
      },
    ],
  })
  fields: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean';
    required: boolean;
  }>;

  @Prop({ default: false })
  generated: boolean;
}

export const SchemaModelSchema = SchemaFactory.createForClass(SchemaModel);
SchemaModelSchema.index({ company_id: 1 });