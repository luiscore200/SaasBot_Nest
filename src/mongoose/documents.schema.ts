
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DocumentItem = DocumentModel & Document;

@Schema({ timestamps: true })
export class DocumentModel {
  @Prop({ required: true })
  company_id: string;

  @Prop({ required: true })
  schema_id: string;

  @Prop({ required: true })
  description: string;

  @Prop({ type: Object, required: true })
  data: Record<string, any>;

  @Prop({ required: true })
  category: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ default: false })
  generated: boolean;


  @Prop({ enum: ['upload', 'llm', 'form'], default: 'upload' })
  source: string;
 
  @Prop({ required: false, index: true })
  vector_id?: string;

}





export const DocumentModelSchema = SchemaFactory.createForClass(DocumentModel);
DocumentModelSchema.index({ company_id: 1, category: 1 });
DocumentModelSchema.index({ tags: 1 });
DocumentModelSchema.index({ company_id: 1, vector_id: 1 });
