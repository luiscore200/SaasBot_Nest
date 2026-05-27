import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
// RuntimeNode se importa del helper para que ambos archivos usen
// exactamente el mismo tipo y no haya conflictos de asignación.
export type { RuntimeNode } from '../data/mapflow/runtime.helper';

export type FlowRuntimeDocument = FlowRuntime & Document;

// ─────────────────────────────────────────────────────────────────────────────

@Schema({ timestamps: true })
export class FlowRuntime {
  @Prop({ required: true })
  company_id!: string;

  @Prop({ required: true })
  flowDefinitionId!: string;

  @Prop({ required: true })
  version!: number;

  @Prop({ required: true })
  startNode!: string;

  /**
   * Grafo plano: { [nodeId]: RuntimeNode }
   * El engine accede a cualquier nodo en O(1) sin recorrer el árbol.
   */
  @Prop({ type: Object, required: true })
  nodes!: Record<string, any>;

  /** SHA-256 del grafo — permite detectar si el árbol cambió al hacer update */
  @Prop()
  hash?: string;

  @Prop({ default: true })
  active!: boolean;
}

export const FlowRuntimeSchema = SchemaFactory.createForClass(FlowRuntime);
FlowRuntimeSchema.index({ company_id: 1, flowDefinitionId: 1 });
FlowRuntimeSchema.index({ flowDefinitionId: 1, version: -1, active: 1 });
FlowRuntimeSchema.index(
  { flowDefinitionId: 1, version: 1 },
  { unique: true },
);