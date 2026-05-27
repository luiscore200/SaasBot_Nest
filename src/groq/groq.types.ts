// ─────────────────────────────────────────────────────────────────────────────
// Groq LLM — tipos compartidos
// ─────────────────────────────────────────────────────────────────────────────

export interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GroqTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>; // JSON Schema
  };
}

export interface GroqToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string — parsear en el caller
  };
}

// ─── Opciones por llamada ─────────────────────────────────────────────────────

export interface GroqChatOptions {
  /** Override del modelo para esta llamada específica */
  model?: string;
  temperature?: number;
  maxCompletionTokens?: number;
  topP?: number;
  stop?: string | string[] | null;
  /** Si se pasa, el LLM responderá en JSON. El caller define la forma del schema. */
  responseFormat?: 'json_object';
}

export interface GroqStreamOptions extends Omit<GroqChatOptions, 'responseFormat'> {}

export interface GroqEmbedOptions {
  model?: string;
}

export interface GroqToolOptions extends GroqChatOptions {
  /**
   * 'auto'   → el LLM decide si llama una tool o no
   * 'none'   → no llama ninguna tool
   * nombre   → fuerza el uso de una tool específica
   */
  toolChoice?: 'auto' | 'none' | string;
}

// ─── Respuestas normalizadas ──────────────────────────────────────────────────

export interface GroqUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface GroqChatResult {
  content: string;
  model: string;
  usage: GroqUsage;
}

export interface GroqEmbedResult {
  vector: number[];
  model: string;
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
}

export interface GroqToolResult {
  /** Contenido de texto si el LLM respondió sin llamar una tool */
  content: string | null;
  /** Tool calls si el LLM decidió usar herramientas */
  toolCalls: GroqToolCall[];
  model: string;
  usage: GroqUsage;
}

// ─── Config de instancia ──────────────────────────────────────────────────────

export interface GroqInstanceConfig {
  apiKey: string;
  /** Modelo de chat por defecto para esta instancia */
  defaultChatModel: string;
  /** Modelo de embeddings por defecto para esta instancia */
  defaultEmbedModel: string;
}