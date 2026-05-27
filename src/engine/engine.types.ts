// ─────────────────────────────────────────────────────────────────────────────
// chat-engine.types.ts  (v2 — multicanal)
// ─────────────────────────────────────────────────────────────────────────────

export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMMessage {
  role: LLMRole;
  content: string;
}

// ── Canal de entrada ──────────────────────────────────────────────────────────

/**
 * El engine es agnóstico al canal.
 * Cada adapter externo resuelve botConfigId + visitorId antes de llamar al engine.
 *
 * widget    → visitorId = UUID localStorage del browser
 * whatsapp  → visitorId = número de teléfono del usuario (+57300...)
 */
export type ChannelType = 'widget' | 'whatsapp';

// ── Formulario del mapflow ────────────────────────────────────────────────────

export interface FormFieldDef {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
}

export type FormState = Record<string, string | number | boolean | null>;

// ── Configuración del bot en runtime ─────────────────────────────────────────

/**
 * Snapshot inmutable cargado UNA VEZ por sesión desde Mongo.
 * Los runtimeNodes se guardan aquí para acceso O(1) sin queries adicionales.
 */
export interface BotRuntimeConfig {
  // — ChatbotModel —
  botConfigId: string;
  company_id: string;
  name: string;
  description: string;
  instructions: string;
  type: string;
  maxTurns: number;
  selectedSchemas: string[];

  // — MapflowModel —
  mapflowId: string;
  formFields: FormFieldDef[];

  // — FlowRuntime —
  startNode: string;
  runtimeNodes: Record<string, RuntimeNode>;
}

// ── Sesión en memoria ─────────────────────────────────────────────────────────

export interface ChatSession {
  sessionId: string;
  visitorId: string;      // UUID browser (widget) | número teléfono (whatsapp)
  channelId: string;      // botConfigId (widget)  | phoneNumberId (whatsapp)
  channel: ChannelType;
  company_id: string;

  config: BotRuntimeConfig;
  history: LLMMessage[];
  formState: FormState;
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
  | 'goToNode';

export interface RuntimeNode {
  id: string;
  type: NodeType;
  data: Record<string, any>;
  next: string[];                     // sucesor(es) lineales
  branches?: Record<string, string>;  // branch-key → nodeId (intent/router/confirmation/output)
  fallback?: string;                  // nodeId fallback (intentNode con maxRetries)
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
}

export interface ChatResponse {
  message: string;
  sessionId: string;
  currentNode: string;
  formState: FormState;
  done: boolean;
}