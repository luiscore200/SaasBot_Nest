
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SchemaDocument = SchemaModel & Document;

@Schema({ timestamps: true })
export class SchemaModel {
  @Prop({ required: true })
  company_id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: false })
  description?: string;

  @Prop({ required: true })
  category: string; // inventory | agenda | article

  @Prop({
    required: true,
    validate: [(v) => v.length > 0, 'fields must have at least one item'],
    type: [
      {
        name: { type: String, required: true },
        type: { 
          type: String, 
          enum: ['string', 'number', 'boolean', 'json', 'date'], 
          required: true 
        },
        required: { type: Boolean, default: false },
        unique: { type: Boolean, default: false },
      },
    ],
  })
  fields: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean' | 'json' | 'date';
    required: boolean;
    unique?: boolean;
  }>;

  @Prop({ default: false })
  generated: boolean;
}


export const SchemaModelSchema = SchemaFactory.createForClass(SchemaModel);
SchemaModelSchema.index({ company_id: 1 });
