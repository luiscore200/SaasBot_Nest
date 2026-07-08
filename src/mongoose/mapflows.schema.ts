import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MapflowDocument = MapflowModel & Document;

const NODE_TYPES = [
  'conversationNode',
  'intentNode',
  'inputNode',
  'outputNode',
  'fallbackNode',
  'routerNode',
  'confirmationNode',
  'goToNode',
  'insertNode',   // ← nuevo
  'apiNode',      // ← nuevo
] as const;

const EDGE_TYPES = ['default', 'fallback', 'jump'] as const;

// ─────────────────────────────────────────────────────────────────────────────

class Position {
  @Prop({ required: true }) x!: number;
  @Prop({ required: true }) y!: number;
}

class Measured {
  @Prop({ required: true }) width!: number;
  @Prop({ required: true }) height!: number;
}

class FlowNode {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true, enum: NODE_TYPES })
  type!: string;

  @Prop({ type: Position, required: true })
  position!: Position;

  @Prop({ type: Object, required: true })
  data!: Record<string, any>;

  @Prop({ type: Measured })
  measured?: Measured;

  @Prop({ default: false }) selected?: boolean;
  @Prop({ default: false }) dragging?: boolean;
}

class FlowEdge {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true })
  source!: string;

  @Prop({ required: true })
  target!: string;

  @Prop()
  sourceHandle?: string;

  @Prop({ required: true, enum: EDGE_TYPES })
  type!: string;

  @Prop({ type: Object })
  data?: Record<string, any>;

  @Prop({ type: Object })
  style?: Record<string, any>;
}

class FormField {
  @Prop({ required: true }) name!: string;
  @Prop({ required: true }) type!: string;
}

// ─────────────────────────────────────────────────────────────────────────────

@Schema({ timestamps: true })
export class MapflowModel {
  _id?: Types.ObjectId | string;


  @Prop({ required: true })
  company_id!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: false })
  description?: string;

   @Prop({ required: false })
  md?: string;

  @Prop({ type: [Object], default: [] })
  nodes!: FlowNode[];

  @Prop({ type: [Object], default: [] })
  edges!: FlowEdge[];

  @Prop({ type: [Object], default: [] })
  formFields!: FormField[];

  @Prop({ type: [String], default: [] })
  selectedSchemas!: string[];

  @Prop({ default: false })
  deleted!: boolean;

  @Prop({ default: true })
  active!: boolean;
}

export const MapflowModelSchema = SchemaFactory.createForClass(MapflowModel);
MapflowModelSchema.index({ company_id: 1 });