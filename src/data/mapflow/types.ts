

// ─────────────────────────────────────────────────────────────────────────────
// NodeType
// ─────────────────────────────────────────────────────────────────────────────

export type NodeType =
  | "conversationNode"
  | "intentNode"
  | "inputNode"
  | "outputNode"
  | "fallbackNode"
  | "routerNode"
  | "confirmationNode"
  | "goToNode"
  | "insertNode"  // ← nuevo
  | "apiNode"    // ← nuevo
  | "storeNode"

// ─────────────────────────────────────────────────────────────────────────────
// Primitivos compartidos
// ─────────────────────────────────────────────────────────────────────────────

export interface FormField {
  name: string;
  type: string;
}

export interface SchemaInfo {
  id: string;
  name: string;
  attributes: Array<{ id: string; name: string; type: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ConversationNodeData
// ─────────────────────────────────────────────────────────────────────────────

export interface ConversationNodeData {
  label: string;
  type: "start" | "message" | "question" | "condition" | "end";
  mode?: "template" | "ia";
  message: string;
  availableFormFields?: FormField[];
}

// ─────────────────────────────────────────────────────────────────────────────
// InputNodeData
// ─────────────────────────────────────────────────────────────────────────────

export interface InputNodeData {
  label: string;
  fieldName: string;
  fieldType: "text" | "number" | "date" | "select";
  description: string;
  options?: string[];
  implicit?: boolean;
}
// ─────────────────────────────────────────────────────────────────────────────
// FallbackNodeData
// ─────────────────────────────────────────────────────────────────────────────

export interface FallbackNodeData {
  label: string;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// OutputNodeData
// ─────────────────────────────────────────────────────────────────────────────

export interface SchemeObject {
  id: string;
  selectedSchema: string;
  selectedFields: string[];
  schemaName: string; // ← nuevo: nombre visual del schema (ej: "inventario_farmaceutico")
}

export interface GlobalCriteria {
  scheme: string;
  column: string;
  condition: string;
  value: string;
  valueSource: "form" | "static";
}

export type TemplateMode = "message" | "list" | "raw";

export interface OutputNodeData {
  label: string;
  schemes: SchemeObject[];
  globalCriteria: GlobalCriteria[];
  outputTemplate?: string;
  outputVisible?: boolean;
  templateMode: TemplateMode;
  emptyFallbackEnabled?: boolean;
  emptyFallbackMessage?: string;
  availableSchemas?: SchemaInfo[];
  availableFormFields?: FormField[];
}

// ─────────────────────────────────────────────────────────────────────────────
// IntentNodeData
// ─────────────────────────────────────────────────────────────────────────────

export interface Intent {
  id: string;
  label: string;
  description: string;
  examples?: string;
}

export interface IntentNodeData {
  label: string;
  contextPrompt: string;
  intents: Intent[];
  fallbackBehavior: "fallback_node" | "retry" | "goto_start";
  maxRetries: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// StoreNode
// ─────────────────────────────────────────────────────────────────────────────

export enum StorePermission {
  INSERT = "insert",
  EDIT = "edit",
  DELETE = "delete",
  SHOW = "show",
}

export interface StoreNodeData {
  nodeId: string;
  objectVar: string;
  extractFromNodeId: string;
  isArray: boolean;
  isGlobal: boolean;
  closeNodeId?: string;
  permissions: StorePermission[];
  feedbackVisible: boolean;
  feedbackMessage?: string;
}
// ─────────────────────────────────────────────────────────────────────────────
// RouterNodeData
// ─────────────────────────────────────────────────────────────────────────────

export interface RouterCondition {
  field: string;
  operator: string;
  value: string;
}

export interface RouterNodeData {
  label: string;
  conditions: RouterCondition[];
  availableFormFields: FormField[];
}

// ─────────────────────────────────────────────────────────────────────────────
// ConfirmationNodeData
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfirmationNodeData {
  label: string;
  confirmationMessage: string;
  positiveLabel: string;
  negativeLabel: string;
  summaryFields: Array<{ fieldName: string; displayLabel: string }>;
  availableFormFields: FormField[];
}

// ─────────────────────────────────────────────────────────────────────────────
// GoToNodeData
// ─────────────────────────────────────────────────────────────────────────────

export interface GoToNodeData {
  label: string;
  /** ID del nodo destino. El engine lo resuelve en runtime — no se expande en el árbol. */
  targetNodeId: string;
  targetNodeLabel: string;
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// InsertNodeData
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldMapping {
  schemaField: string;
  source: string; // "form:x" | "obj:varName.attr" | "auto:now" | "auto:order" | ""
}

export interface InsertNodeData {
  label: string;
  selectedSchemaId: string;
  schemaName: string;   
  fieldMappings: FieldMapping[];
  outputEnabled?: boolean;   // ← nuevo
  outputTemplate?: string;   // ← nuevo
}

// ─────────────────────────────────────────────────────────────────────────────
// ApiNodeData
// ─────────────────────────────────────────────────────────────────────────────

export interface BodyField {
  id: string;         // solo UI, no lo usa el engine
  fieldName: string;
  fieldType: "string" | "number" | "boolean" | "date";
  source: string;     // mismo patrón que FieldMapping.source + "static:valor"
}

export interface ApiNodeData {
  label: string;
  url: string;
  bodyFields: BodyField[];
  responseVar?: string; // variable donde guardar el objeto retornado (opcional)
}

// ─────────────────────────────────────────────────────────────────────────────
// NodeData — union discriminada de todos los tipos
// ─────────────────────────────────────────────────────────────────────────────

export type NodeData =
  | ConversationNodeData
  | InputNodeData
  | OutputNodeData
  | FallbackNodeData
  | IntentNodeData
  | RouterNodeData
  | ConfirmationNodeData
  | GoToNodeData
  | InsertNodeData   // ← nuevo
  | ApiNodeData    // ← nuevo
  | StoreNodeData;

// ─────────────────────────────────────────────────────────────────────────────
// MappedNode2 — árbol serializado que va al backend / LLM
// ─────────────────────────────────────────────────────────────────────────────

export interface MappedNode2 {
  id: string;
  type: NodeType;
  data: NodeData;

  /** Nodos lineales: conversationNode, inputNode, fallbackNode, goToNode */
  next?: MappedNode2[];

  /**
   * Nodos de decisión:
   *   intentNode       → { [intentId]: MappedNode2 }
   *   routerNode       → { true: MappedNode2, false: MappedNode2 }
   *   confirmationNode → { yes: MappedNode2, no: MappedNode2 }
   *   outputNode       → { success: MappedNode2, empty: MappedNode2 }
   */
  branches?: Record<string, MappedNode2>;

  /** Exclusivo de intentNode — rama cuando se agotan los maxRetries */
  fallback?: MappedNode2;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI persistence (nodos y edges de ReactFlow)
// ─────────────────────────────────────────────────────────────────────────────

export interface FlowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: NodeData;
  measured?: { width: number; height: number };
  selected?: boolean;
  dragging?: boolean;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  type: "default" | "fallback" | "jump";
  data?: { visualOnly?: boolean };
  style?: Record<string, any>;
}

// ─────────────────────────────────────────────────────────────────────────────
// CreateMapflowPayload
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateMapflowPayload {
  name: string;
  selectedSchemas: string[];
  formFields: FormField[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  map: MappedNode2[];
}