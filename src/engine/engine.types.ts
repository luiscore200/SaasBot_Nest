// ─────────────────────────────────────────────────────────────────────────────
// chat-engine.types.ts  (v7 — storeNode enriched context)
// ─────────────────────────────────────────────────────────────────────────────

export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMMessage {
  role: LLMRole;
  content: string;
  /**
   * Presente cuando el mensaje fue interceptado por un storeNode global.
   * El intentNode recibe el historial con el contenido reencuadrado;
   * el bot general sigue viendo el contenido original.
   */
  interceptedBy?: string;
  storeAction?: {
    nodeId:     string;
    permission: StorePermission;
    item:       string;
    result:     'success' | 'error';
  };
}

// ── Canal de entrada ──────────────────────────────────────────────────────────

export type ChannelType = 'widget' | 'whatsapp';

// ── Formulario del mapflow ────────────────────────────────────────────────────

export interface FormFieldDef {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
}

export type FormState = Record<string, string | number | boolean | null | Record<string, number> | any[]>;

// ── Paginación múltiple ───────────────────────────────────────────────────────

export interface PaginationEntry {
  nodeId: string;
  hasMore: boolean;
  currentPage: number;
}

// ── Mensaje tipado ────────────────────────────────────────────────────────────

export interface ChatMessage {
  text: string;
  pagination?: PaginationEntry;
}

// ── Caché de documentos por outputNode ───────────────────────────────────────

export type OutputCache = Record<string, Record<string, any>[]>;

// ── StoreNode — permisos y datos ──────────────────────────────────────────────

export enum StorePermission {
  INSERT = 'insert',
  EDIT   = 'edit',
  DELETE = 'delete',
  SHOW   = 'show',
}

export interface StoreNodeData {
  nodeId:            string;
  objectVar:         string;
  extractFromNodeId: string;
  isArray:           boolean;
  isGlobal:          boolean;
  closeNodeId?:      string;
  permissions:       StorePermission[];
  feedbackVisible:   boolean;
  feedbackMessage?:  string;
  /**
   * Descripción semántica del store en lenguaje natural.
   * Explica qué representa esta colección en el contexto del negocio.
   * Ej: "Lista de medicamentos que el cliente quiere pedir HOY"
   */
  description:       string;
  /**
   * Frases o expresiones típicas del usuario que indican que está
   * actuando sobre ESTE store (no sobre otro).
   * Ej: "agrega al pedido, ponlo, quiero ese, inclúyelo"
   */
  triggerPhrases:    string;
  /**
   * Frases o expresiones que el usuario usaría para un store DIFERENTE,
   * útiles para evitar falsos positivos cuando hay múltiples stores activos.
   * Ej: "para después, en favoritos, guardar para luego"
   */
  avoidPhrases:      string;
}

/**
 * Entrada en session.activeGlobalStores.
 * Se registra cuando el flujo pasa por un storeNode con isGlobal: true.
 * Se elimina cuando el flujo alcanza closeNodeId. objectVar permanece en formState.
 */
export interface ActiveGlobalStore {
  nodeId:            string;
  objectVar:         string;
  permissions:       StorePermission[];
  extractFromNodeId: string;
  closeNodeId?:      string;
  feedbackVisible:   boolean;
  feedbackMessage?:  string;
  isArray:           boolean;
  /** Descripción semántica del store — qué representa en el dominio del negocio */
  description:       string;
  /** Ejemplos de frases del usuario que SÍ apuntan a este store */
  triggerPhrases:    string;
  /** Ejemplos de frases del usuario que NO apuntan a este store (apuntan a otro) */
  avoidPhrases:      string;
}

// ── Resultado de resolución unificada de store ────────────────────────────────

/**
 * Resultado del método resolveStoreAction — resuelve en una sola LLM call
 * qué store aplica, qué permiso ejecutar y sobre qué ítem.
 */
export interface StoreActionResolution {
  matched:    boolean;
  storeNodeId: string | null;
  permission: StorePermission | null;
  item:       string;
}

// ── Configuración del bot en runtime ─────────────────────────────────────────

export interface BotRuntimeConfig {
  botConfigId:     string;
  company_id:      string;
  name:            string;
  description:     string;
  instructions:    string;
  type:            string;
  maxTurns:        number;
  selectedSchemas: string[];
  mapflowId:       string;
  formFields:      FormFieldDef[];
  startNode:       string;
  runtimeNodes:    Record<string, RuntimeNode>;
}

// ── Sesión en memoria ─────────────────────────────────────────────────────────
export interface VisitedNodeEntry {
  nodeId:  string;
  type:    NodeType;
  message: string;   // mensaje final mostrado al usuario en ese paso (puede ser '')
  turn:    number;   // session.turns en el momento de la visita
}


export interface ChatSession {
  sessionId:     string;
  visitorId:     string;
  channelId:     string;
  channel:       ChannelType;
  company_id:    string;
  config:        BotRuntimeConfig;
  history:       LLMMessage[];
  formState:     FormState;
  /**
   * Caché de documentos crudos por outputNode.
   * Solo outputNodes en modo list escriben aquí.
   */
  outputCache:   OutputCache;
  /**
   * Stores globales activos en esta sesión.
   * El engine intercepta cada mensaje entrante y evalúa si alguno
   * de estos stores debe manejar la acción antes de continuar el flujo.
   */
  activeGlobalStores: ActiveGlobalStore[];
  nodeHistory:        VisitedNodeEntry[]; 
  currentNodeId: string;
  turns:         number;
  lastActivity:  number;
}

// ── Nodos del runtime ─────────────────────────────────────────────────────────

export type NodeType =
  | 'conversationNode'
  | 'intentNode'
  | 'inputNode'
  | 'outputNode'
  | 'fallbackNode'
  | 'routerNode'
  | 'confirmationNode'
  | 'goToNode'
  | 'insertNode'
  | 'apiNode'
  | 'storeNode';

export interface RuntimeNode {
  id:        string;
  type:      NodeType;
  data:      Record<string, any>;
  next:      string[];
  branches?: Record<string, string>;
  fallback?: string;
}

// ── Respuesta estructurada del LLM ────────────────────────────────────────────

export interface LLMStructuredResponse {
  message: string;
  data:    FormState;
  intent?: string;
  done:    boolean;
}

// ── Request / Response del controller ────────────────────────────────────────

export interface ChatRequest {
  message:        string;
  sessionId?:     string;
  visitorId:      string;
  paginateNodeId?: string;
}

export interface ChatResponse {
  message:     string;
  messages:    ChatMessage[];
  sessionId:   string;
  currentNode: string;
  formState:   FormState;
  done:        boolean;
}