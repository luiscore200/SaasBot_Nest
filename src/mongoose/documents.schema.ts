import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DocumentItem = DocumentModel & Document;

@Schema({ timestamps: true })
export class DocumentModel {
  @Prop({ required: true })
  company_id!: string;

  @Prop({ required: true })
  schema_id!: string;

  @Prop({ required: true })
  category!: string; // Ej: "inventory"

  @Prop({ type: Object, required: true })
  data!: Record<string, any>; // Validado en servicio según schema.fields

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({ default: false })
  generated!: boolean; // Por IA o no

  @Prop({ required: false, index: true })
  vector_id?: string; // Para embeddings

  @Prop({ default: true })
  active!: boolean; // Soft enable/disable
}

export const DocumentModelSchema = SchemaFactory.createForClass(DocumentModel);

// Índices recomendados
DocumentModelSchema.index({ company_id: 1, category: 1 });
DocumentModelSchema.index({ tags: 1 });
DocumentModelSchema.index({ company_id: 1, vector_id: 1 });