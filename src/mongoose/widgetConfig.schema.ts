import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type WidgetConfigDocument = WidgetConfigModel & Document;

export const WIDGET_POSITIONS = ['bottom-right', 'bottom-left'] as const;
export type WidgetPosition = (typeof WIDGET_POSITIONS)[number];

// ─────────────────────────────────────────────────────────────────────────────

@Schema({ timestamps: true })
export class WidgetConfigModel {
  @Prop({ required: true })
  company_id!: string;

  /** Referencia al BotConfig que ejecuta este widget */
  @Prop({ required: true })
  botConfigId!: string;

  /** Nombre visible en la cabecera del widget */
  @Prop({ required: true })
  displayName!: string;

  /** URL pública del logo del cliente — opcional */
  @Prop()
  logoUrl?: string;

  /** Color primario del widget en hex — ej: "#3B82F6" */
  @Prop({ required: true, default: '#3B82F6' })
  primaryColor!: string;

  /** Color secundario / fondo de burbujas del bot — ej: "#F3F4F6" */
  @Prop({ required: true, default: '#F3F4F6' })
  secondaryColor!: string;

  /** Posición del widget en la página del cliente */
  @Prop({ required: true, enum: WIDGET_POSITIONS, default: 'bottom-right' })
  position!: WidgetPosition;

  @Prop({ default: false })
  deleted!: boolean;

  @Prop({ default: true })
  active!: boolean;
}

export const WidgetConfigSchema = SchemaFactory.createForClass(WidgetConfigModel);

WidgetConfigSchema.index({ company_id: 1 });
WidgetConfigSchema.index({ company_id: 1, botConfigId: 1 });