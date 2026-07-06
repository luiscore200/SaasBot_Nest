// ─────────────────────────────────────────────────────────────────────────────
// chat-engine.types.ts  (v9 — outputNode eliminado, absorbido por storeNode
// en modo dual: flotante (listener global) o inline (nodo de flujo con
// next/branches, comportamiento equivalente al viejo outputNode))
// ─────────────────────────────────────────────────────────────────────────────

export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMMessage {
  role: LLMRole;
  content: string;
  interceptedBy?: string;
  storeAction?: {
    nodeId:     string;
    type:       StoreOperationType;
    item:       string;
    result:     'success' | 'error' | 'not_found';
  };
}

export type ChannelType = 'widget' | 'whatsapp';

export interface FormFieldDef {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
}

export type FormState = Record<string, string | number | boolean | null | Record<string, number> | any[]>;

export interface PaginationEntry {
  nodeId: string;
  hasMore: boolean;
  currentPage: number;
}

export interface ChatMessage {
  text: string;
  pagination?: PaginationEntry;
}

// ── Caché — unificado por schemaId, acumulativo, deduplicado ─────────────────
export type OutputCache = Record<string, Record<string, any>[]>;

// ── StoreNode ──────────────────────────────────────────────────────────────

export interface StorePermissions {
  create: boolean;
  show:   boolean;
  delete: boolean;
  update: boolean;
}

export interface GlobalCriteria {
  scheme: string;
  column: string;
  condition: string;
  value: string;
  valueSource: 'form' | 'static';
}

export interface StoreSearchOutput {
  /** Si el resultado de la búsqueda se le muestra al usuario, o solo se usa
   *  internamente para resolver operaciones (insert/edit implícitos). */
  searchFeedback: boolean;
  /** Template determinístico para search.intent === 'list' (paginado) */
  templateList?: string;
  /** Template determinístico para search.intent === 'query' (ítem puntual) */
  templateObj?: string;
  emptyFallbackEnabled?: boolean;
  emptyFallbackMessage?: string;
  pageSize?: number;
  globalCriteria?: GlobalCriteria[];
}

export type StoreOperationType = 'insert' | 'edit' | 'delete' | 'show';

export interface StoreOperation {
  type: StoreOperationType;
  /** Ítem YA existente en la colección sobre el que se actúa (edit/delete) */
  target?: string;
  /** Ítem/valor a usar (insert/edit). Vacío → se resuelve contra lastFound */
  item?: string;
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
}

/**
 * Entrada en session.activeGlobalStores — solo para stores en modo flotante.
 * Un storeNode inline (con next/branches) NUNCA se registra aquí; se ejecuta
 * como cualquier otro nodo del chain, vía NodeService.
 */
export interface ActiveGlobalStore {
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
  /** Últimos docs encontrados por este store — resuelve referencias
   *  implícitas ("agrégalo", "cámbialo por esa") en turnos siguientes. */
  lastFound?: Record<string, any>[];
}

// ── Resolución de intercepción ────────────────────────────────────────────

export interface StoreSearchIntent {
  intent: 'none' | 'query' | 'list';
  query: string;
}

export interface StoreActionResolution {
  matched: boolean;
  storeNodeId: string | null;
  search: StoreSearchIntent;
  operations: StoreOperation[];
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

export interface VisitedNodeEntry {
  nodeId:  string;
  type:    NodeType;
  message: string;
  turn:    number;
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
  outputCache:   OutputCache;
  activeGlobalStores: ActiveGlobalStore[];
  nodeHistory:        VisitedNodeEntry[];
  currentNodeId: string;
  turns:         number;
  lastActivity:  number;
}

// ── Nodos del runtime ─────────────────────────────────────────────────────────
// outputNode ELIMINADO — su comportamiento vive ahora en storeNode (inline).

export type NodeType =
  | 'conversationNode'
  | 'intentNode'
  | 'inputNode'
  | 'fallbackNode'
  | 'routerNode'
  | 'confirmationNode'
  | 'goToNode'
  | 'insertNode'
  | 'apiNode'
  | 'storeNode';

/**
 * data flexible a propósito. Cualquier nodo (excepto storeNode) puede llevar:
 *   initStores?:   string[]
 *   finishStores?: string[]
 * Un storeNode con `next`/`branches` poblado corre INLINE dentro de la cadena
 * (NodeService.dispatch); un storeNode sin next/branches es FLOTANTE y solo
 * se activa vía initStores/finishStores de otros nodos.
 */
export interface RuntimeNode {
  id:        string;
  type:      NodeType;
  data:      Record<string, any>;
  next:      string[];
  branches?: Record<string, string>;
  fallback?: string;
}

export interface LLMStructuredResponse {
  message: string;
  data:    FormState;
  intent?: string;
  done:    boolean;
}

export interface ChatRequest {
  message:         string;
  sessionId?:      string;
  visitorId:       string;
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