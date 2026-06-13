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
  category!: string;

  @Prop({ type: Object, required: true })
  data!: Record<string, any>;

  @Prop({ type: [String], default: () => [] })
  tags!: string[];

  @Prop({ default: false })
  generated!: boolean;

  @Prop({ required: false, index: true })
  vector_id?: string;

  @Prop({ default: true })
  active!: boolean;
}

export const DocumentModelSchema = SchemaFactory.createForClass(DocumentModel);

// Middleware pre-save: garantiza defaults aunque el documento
// haya sido creado sin pasar por el ORM o con schema cacheado viejo
DocumentModelSchema.pre('save', function (next) {
  if (this.active === undefined) this.active = true;
  if (!Array.isArray(this.tags)) this.tags = [];
  if (this.generated === undefined) this.generated = false;
  next();
});

// Para insertMany y create masivo
DocumentModelSchema.pre('insertMany', function (next, docs: any[]) {
  for (const doc of docs) {
    if (doc.active === undefined) doc.active = true;
    if (!Array.isArray(doc.tags)) doc.tags = [];
    if (doc.generated === undefined) doc.generated = false;
  }
  next();
});

DocumentModelSchema.index({ company_id: 1, category: 1 });
DocumentModelSchema.index({ tags: 1 });
DocumentModelSchema.index({ company_id: 1, vector_id: 1 });