import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChatbotDocument = ChatbotModel & Document;

export const BOT_TYPES = ['searcher', 'advisor', 'scheduler'] as const;
export type BotType = (typeof BOT_TYPES)[number];

export const BOT_PLUGINS = ['widget', 'whatsapp'] as const;
export type BotPlugin = (typeof BOT_PLUGINS)[number];

// ─────────────────────────────────────────────────────────────────────────────

@Schema({ timestamps: true })
export class ChatbotModel {
  @Prop({ required: true })
  company_id!: string;

  /** Nombre interno del bot — identificador humano */
  @Prop({ required: true })
  name!: string;

  /** Propósito general del bot — se inyecta en el system prompt del engine */
  @Prop({ required: true })
  description!: string;

  /** Define qué tipo de flujo ejecuta el engine */
  @Prop({ required: true, enum: BOT_TYPES })
  type!: BotType;

  /**
   * Canal por el que opera este bot.
   * widget   → inyectado en páginas web via script JS
   * whatsapp → conectado vía Twilio / WhatsApp Business API
   */
  @Prop({ required: true, enum: BOT_PLUGINS })
  plugin!: BotPlugin;

  /** ID del mapflow que ejecuta este bot por defecto */
  @Prop({ required: true })
  mapflowId!: string;

  /**
   * IDs de los schemas de documentos que el bot puede consultar.
   * El engine los usa para resolver nodos outputNode y routerNode.
   */
  @Prop({ type: [String], default: [] })
  selectedSchemas!: string[];

  /**
   * Instrucciones de personalización escritas por el usuario.
   * Se concatenan al system prompt fijo del engine.
   * Ejemplo: "Habla siempre en tono formal. Refierete al usuario como 'estimado cliente'."
   */
  @Prop({ required: true })
  instructions!: string;

  /**
   * Número máximo de turnos (pares usuario/bot) por conversación.
   * El engine debe cortar y cerrar la sesión al alcanzarlo.
   */
  @Prop({ required: true, default: 20 })
  maxTurns!: number;

  @Prop({ default: false })
  deleted!: boolean;

  @Prop({ default: true })
  active!: boolean;
}

export const ChatbotSchema = SchemaFactory.createForClass(ChatbotModel);

ChatbotSchema.index({ company_id: 1 });
ChatbotSchema.index({ company_id: 1, plugin: 1 });
ChatbotSchema.index({ company_id: 1, mapflowId: 1 });