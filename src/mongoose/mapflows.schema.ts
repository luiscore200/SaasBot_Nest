import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// ================== COMMON ==================
class FormField {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  type: string;
}

class NodePosition {
  @Prop({ required: true })
  x: number;

  @Prop({ required: true })
  y: number;
}

class NodeMeasured {
  @Prop({ required: true })
  width: number;

  @Prop({ required: true })
  height: number;
}

class Node {
  @Prop({ required: true })
  id: string;

  @Prop({
    required: true,
    enum: ['conversationNode', 'outputNode', 'inputNode', 'fallbackNode'],
  })
  type: 'conversationNode' | 'outputNode' | 'inputNode' | 'fallbackNode';

  @Prop({ type: NodePosition, required: true })
  position: NodePosition;

  @Prop({ type: NodeMeasured, required: true })
  measured: NodeMeasured;

  @Prop({ type: Object, required: true })
  data: Record<string, any>;

  // ⚡️ Cambiamos: no required, pero default false
  @Prop({ default: false })
  selected?: boolean;

  @Prop({ default: false })
  dragging?: boolean;
}

class Edge {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  source: string;

  @Prop({ required: true })
  target: string;

  @Prop({
    required: true,
    enum: ['default', 'custom', 'fallback'],
  })
  type: 'default' | 'custom' | 'fallback';

  @Prop({ type: Object })
  style?: Record<string, any>;
}

export type MapflowDocument = MapflowModel & Document;

@Schema({ timestamps: true })
export class MapflowModel {
  @Prop({ required: true })
  company_id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ type: [String], default: [] })
  selectedSchemas: string[];

  @Prop({ type: [FormField], default: [] })
  formFields: FormField[];

  @Prop({ type: [Node], default: [] })
  nodes: Node[];

  @Prop({ type: [Edge], default: [] })
  edges: Edge[];

  // flags de control (igual que SchemaModel)
  @Prop({ default: false })
  deleted: boolean;

  @Prop({ default: true })
  active: boolean;

  @Prop({ default: false })
  generated: boolean;
}

export const MapflowModelSchema = SchemaFactory.createForClass(MapflowModel);
MapflowModelSchema.index({ company_id: 1 });
