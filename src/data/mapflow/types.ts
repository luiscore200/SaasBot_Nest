// ─────────────────────────────────────────────────────────────────────────────
// types.ts  (v3 — outputNode eliminado, storeNode con search/searchOutput)
// ─────────────────────────────────────────────────────────────────────────────

export type NodeType =
  | "conversationNode"
  | "intentNode"
  | "inputNode"
  | "fallbackNode"
  | "routerNode"
  | "confirmationNode"
  | "goToNode"
  | "insertNode"
  | "apiNode"
  | "storeNode";

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

export interface GlobalCriteria {
  scheme: string;
  column: string;
  condition: string;
  value: string;
  valueSource: "form" | "static";
}

/** Se mezcla en cualquier *NodeData que NO sea storeNode. */
export interface StoreLifecycleHooks {
  initStores?: string[];
  finishStores?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// ConversationNodeData
// ─────────────────────────────────────────────────────────────────────────────

export interface ConversationNodeData extends StoreLifecycleHooks {
  label: string;
  type: "start" | "message" | "question" | "condition" | "end";
  mode?: "template" | "ia";
  message: string;
  availableFormFields?: FormField[];
}

// ─────────────────────────────────────────────────────────────────────────────
// InputNodeData
// ─────────────────────────────────────────────────────────────────────────────

export interface InputNodeData extends StoreLifecycleHooks {
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

export interface FallbackNodeData extends StoreLifecycleHooks {
  label: string;
  message: string;
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

export interface IntentNodeData extends StoreLifecycleHooks {
  label: string;
  contextPrompt: string;
  intents: Intent[];
  fallbackBehavior: "fallback_node" | "retry" | "goto_start";
  maxRetries: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// RouterNodeData
// ─────────────────────────────────────────────────────────────────────────────

export interface RouterCondition {
  field: string;
  operator: string;
  value: string;
}

export interface RouterNodeData extends StoreLifecycleHooks {
  label: string;
  conditions: RouterCondition[];
  availableFormFields: FormField[];
}

// ─────────────────────────────────────────────────────────────────────────────
// ConfirmationNodeData
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfirmationNodeData extends StoreLifecycleHooks {
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
  targetNodeId: string;
  targetNodeLabel: string;
  reason: string;
  clearFields?: string[];
  // NO extiende StoreLifecycleHooks — ver justificación en versiones anteriores.
}

// ─────────────────────────────────────────────────────────────────────────────
// InsertNodeData
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldMapping {
  schemaField: string;
  source: string;
}

export interface InsertNodeData extends StoreLifecycleHooks {
  label: string;
  selectedSchemaId: string;
  schemaName: string;
  fieldMappings: FieldMapping[];
  outputEnabled?: boolean;
  outputTemplate?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ApiNodeData
// ─────────────────────────────────────────────────────────────────────────────

export interface BodyField {
  id: string;
  fieldName: string;
  fieldType: "string" | "number" | "boolean" | "date";
  source: string;
}

export interface ApiNodeData extends StoreLifecycleHooks {
  label: string;
  url: string;
  bodyFields: BodyField[];
  responseVar?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// StoreNodeData — absorbe lo que hacía OutputNodeData
// ─────────────────────────────────────────────────────────────────────────────

export interface StorePermissions {
  create: boolean;
  show: boolean;
  delete: boolean;
  update: boolean;
}

export interface StoreSearchOutput {
  searchFeedback: boolean;
  templateList?: string;
  templateObj?: string;
  emptyFallbackEnabled?: boolean;
  emptyFallbackMessage?: string;
  pageSize?: number;
  globalCriteria?: GlobalCriteria[];
}

/**
 * NO extiende StoreLifecycleHooks — el store no se auto-inicializa.
 * Puede correr en dos modos según cómo lo conecte el frontend:
 *   - flotante: sin next/branches, activado por initStores/finishStores
 *     de otros nodos.
 *   - inline: con next/branches (como el viejo outputNode), corre dentro
 *     de la cadena del flujo cuando search === true.
 */


export interface StoreLinkedNode {
  id: string;
  label: string;
}

export interface StoreNodeData {
  nodeId: string;
  objectVar: string;
  schemas: string[];
  isArray: boolean;
  storePermissions: StorePermissions;
  search: boolean;
  searchOutput?: StoreSearchOutput;
  feedbackVisible: boolean;
  feedbackMessage?: string;
  llmDescription?: string;
  configHash?: string;
  operatorNotes?: string;
   initNodes: StoreLinkedNode[];
  finishNodes: StoreLinkedNode[];
  label?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// NodeData — union discriminada
// ─────────────────────────────────────────────────────────────────────────────

export type NodeData =
  | ConversationNodeData
  | InputNodeData
  | FallbackNodeData
  | IntentNodeData
  | RouterNodeData
  | ConfirmationNodeData
  | GoToNodeData
  | InsertNodeData
  | ApiNodeData
  | StoreNodeData;