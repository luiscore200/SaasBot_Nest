import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type WidgetConfigDocument = WidgetConfigModel & Document;

export const WIDGET_POSITIONS = ['bottom-right', 'bottom-left'] as const;
export type WidgetPosition = (typeof WIDGET_POSITIONS)[number];

@Schema({ timestamps: true })
export class WidgetConfigModel {
  @Prop({ required: true })
  company_id!: string;

  @Prop({ required: true })
  botConfigId!: string;

  @Prop({ required: true })
  displayName!: string;

  @Prop()
  logoUrl?: string;

  @Prop({ required: true, default: '#3B82F6' })
  primaryColor!: string;

  @Prop({ required: true, default: '#F3F4F6' })
  secondaryColor!: string;

  @Prop({ required: true, enum: WIDGET_POSITIONS, default: 'bottom-right' })
  position!: WidgetPosition;

  /**
   * Dominios autorizados para usar este widget.
   * El backend valida request.headers.origin contra esta lista
   * en cada llamada desde el script embebido.
   * Ejemplos: ['https://mitienda.com', 'https://app.mitienda.com']
   */
  @Prop({ type: [String], default: [] })
  allowedOrigins!: string[];

  @Prop({ default: false })
  deleted!: boolean;

  @Prop({ default: true })
  active!: boolean;
}

export const WidgetConfigSchema = SchemaFactory.createForClass(WidgetConfigModel);

WidgetConfigSchema.index({ company_id: 1 });
WidgetConfigSchema.index({ company_id: 1, botConfigId: 1 });