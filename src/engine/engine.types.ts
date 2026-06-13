// ─────────────────────────────────────────────────────────────────────────────
// chat-engine.types.ts  (v5 — outputCache en sesión)
// ─────────────────────────────────────────────────────────────────────────────

export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMMessage {
  role: LLMRole;
  content: string;
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

export type FormState = Record<string, string | number | boolean | null | Record<string, number>>;

// ── Paginación múltiple ───────────────────────────────────────────────────────

/**
 * Entrada de paginación por nodo.
 * El frontend mantiene este mapa y, al presionar "ver más",
 * envía el nodeId correspondiente para reactivar ese outputNode específico.
 */
export interface PaginationEntry {
  nodeId: string;
  hasMore: boolean;
  currentPage: number;
}

// ── Mensaje tipado ────────────────────────────────────────────────────────────

/**
 * Mensaje individual dentro de un turno.
 * El campo pagination solo está presente en el mensaje del outputNode
 * que tiene más páginas — el frontend usa esto para saber exactamente
 * en qué burbuja renderizar el botón "ver más".
 */
export interface ChatMessage {
  text: string;
  pagination?: PaginationEntry;
}

// ── Caché de documentos por outputNode ───────────────────────────────────────

/**
 * Caché acumulativo de documentos crudos resueltos por cada outputNode en modo list.
 * Vive en la sesión (no en formState) para no contaminar el contexto del LLM
 * ni el formulario que se expone al usuario.
 *
 * Clave: nodeId del outputNode.
 * Valor: array acumulativo de documentos (sin formatear, sin template).
 *
 * Se acumula página a página para que el inputNode con extractFromNodeId
 * tenga siempre el universo completo de items mostrados hasta ese momento.
 */
export type OutputCache = Record<string, Record<string, any>[]>;

// ── Configuración del bot en runtime ─────────────────────────────────────────

export interface BotRuntimeConfig {
  botConfigId: string;
  company_id: string;
  name: string;
  description: string;
  instructions: string;
  type: string;
  maxTurns: number;
  selectedSchemas: string[];
  mapflowId: string;
  formFields: FormFieldDef[];
  startNode: string;
  runtimeNodes: Record<string, RuntimeNode>;
}

// ── Sesión en memoria ─────────────────────────────────────────────────────────

export interface ChatSession {
  sessionId: string;
  visitorId: string;
  channelId: string;
  channel: ChannelType;
  company_id: string;
  config: BotRuntimeConfig;
  history: LLMMessage[];
  formState: FormState;
  /**
   * Caché de documentos crudos por outputNode.
   * Solo outputNodes en modo list escriben aquí.
   * Los inputNodes con extractFromNodeId leen de aquí.
   */
  outputCache: OutputCache;
  currentNodeId: string;
  turns: number;
  lastActivity: number;
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
  | 'insertNode'   // ← nuevo
  | 'apiNode'; 

export interface RuntimeNode {
  id: string;
  type: NodeType;
  data: Record<string, any>;
  next: string[];
  branches?: Record<string, string>;
  fallback?: string;
}

// ── Respuesta estructurada del LLM ────────────────────────────────────────────

export interface LLMStructuredResponse {
  message: string;
  data: FormState;
  intent?: string;
  done: boolean;
}

// ── Request / Response del controller ────────────────────────────────────────

export interface ChatRequest {
  message: string;
  sessionId?: string;
  visitorId: string;
  /**
   * Presente cuando el frontend activa "ver más" para un outputNode específico.
   * El engine intercepta esto antes del chain normal y redirige al nodo correcto.
   */
  paginateNodeId?: string;
}

export interface ChatResponse {
  message: string;          // último mensaje (compatibilidad con canales simples)
  messages: ChatMessage[];  // array tipado — cada burbuja puede llevar su paginación
  sessionId: string;
  currentNode: string;
  formState: FormState;
  done: boolean;
}