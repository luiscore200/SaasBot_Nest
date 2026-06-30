import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { GroqService } from '../groq/groq.service';
import { GroqTool } from '../groq/groq.types';
import {
  MapflowAiOutput,
  InferredSchema,
  ExistingSchemaContext,
  LlmNode,
  LlmEdge,
  SkeletonNode,
  FlowSkeleton,
  NodeConfigResult,
} from './types';
import { NodeType } from 'src/data/mapflow/types';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos internos — Fase 0
// ─────────────────────────────────────────────────────────────────────────────

interface FlowAnalysis {
  /**
   * Clasificación de cada schema existente.
   * El LLM determina para qué sirve cada uno.
   */
  existingSchemaRoles: Array<{
    name: string;
    /** true si este schema sirve para CONSULTAR y mostrar datos (outputNode) */
    coversQuery: boolean;
    /** true si este schema sirve para INSERTAR datos del flujo (insertNode) */
    coversInsertion: boolean;
  }>;
  /**
   * Schemas que el flujo necesita pero no existen en los existentes.
   * Ej: el usuario subió "inventario" pero el flujo necesita "pedidos" → missingSchemas: ["pedidos"]
   */
  missingSchemas: string[];
  /** El flujo necesita insertar datos en algún schema */
  requiresInsertion: boolean;
  /** El flujo necesita mostrar una lista de items para que el usuario seleccione */
  requiresSelection: boolean;
  /** El flujo tiene bifurcaciones de intención (el usuario elige entre opciones) */
  requiresIntent: boolean;
  /** Razonamiento interno del LLM — se pasa como contexto al skeleton */
  reasoning: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tools
// ─────────────────────────────────────────────────────────────────────────────

const ANALYZE_FLOW_TOOL: GroqTool = {
  type: 'function',
  function: {
    name: 'analyze_flow',
    description: 'Analiza qué schemas tiene el negocio, para qué sirve cada uno, y qué schemas adicionales necesita el flujo.',
    parameters: {
      type: 'object',
      required: ['existingSchemaRoles', 'missingSchemas', 'requiresInsertion', 'requiresSelection', 'requiresIntent', 'reasoning'],
      properties: {
        existingSchemaRoles: {
          type: 'array',
          description: 'Clasificación de cada schema existente según su rol en el flujo.',
          items: {
            type: 'object',
            required: ['name', 'coversQuery', 'coversInsertion'],
            properties: {
              name: {
                type: 'string',
                description: 'Nombre exacto del schema existente.',
              },
              coversQuery: {
                type: 'boolean',
                description: 'true si este schema sirve para CONSULTAR y mostrar datos al usuario (outputNode). Ej: un schema de inventario/productos cubre consultas.',
              },
              coversInsertion: {
                type: 'boolean',
                description: 'true si este schema sirve para INSERTAR datos del flujo (insertNode). IMPORTANTE: un schema de inventario/productos NO cubre inserción de pedidos — los pedidos son una entidad diferente.',
              },
            },
          },
        },
        missingSchemas: {
          type: 'array',
          items: { type: 'string' },
          description: 'Nombres de schemas que el flujo necesita pero no existen en los schemas proporcionados. Ej: si el flujo inserta pedidos y no hay schema de pedidos → ["pedidos"]. Vacío [] si los schemas existentes cubren todo.',
        },
        requiresInsertion: {
          type: 'boolean',
          description: 'true si el flujo necesita guardar/insertar datos en MongoDB.',
        },
        requiresSelection: {
          type: 'boolean',
          description: 'true si el flujo muestra una lista al usuario para que seleccione items (necesita outputNode + storeNode).',
        },
        requiresIntent: {
          type: 'boolean',
          description: 'true si el flujo tiene bifurcaciones donde el usuario elige entre opciones (necesita intentNode).',
        },
        reasoning: {
          type: 'string',
          description: 'Razonamiento: qué tiene el negocio, para qué sirve cada schema, qué schemas faltan y por qué.',
        },
      },
    },
  },
};

const GENERATE_SKELETON_TOOL: GroqTool = {
  type: 'function',
  function: {
    name: 'generate_skeleton',
    description: 'Genera el esqueleto del flujo: qué nodos usar y en qué orden, más los schemas necesarios.',
    parameters: {
      type: 'object',
      required: ['inferredSchemas', 'nodes', 'edges'],
      properties: {
        inferredSchemas: {
          type: 'array',
          description: 'Schemas nuevos necesarios para este flujo. Vacío [] si el schema existente cubre todo.',
          items: {
            type: 'object',
            required: ['name', 'category', 'fields'],
            properties: {
              name:        { type: 'string' },
              description: { type: 'string' },
              category:    { type: 'string', enum: ['inventory', 'schedule'] },
              fields: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name', 'type', 'required'],
                  properties: {
                    name:        { type: 'string' },
                    type:        { type: 'string', enum: ['string', 'number', 'boolean', 'json', 'date'] },
                    required:    { type: 'boolean' },
                    auto:        { type: 'string', enum: ['uuid', 'timestamp', 'batch_id'] },
                    description: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'type', 'purpose'],
            properties: {
              id:        { type: 'string' },
              type: {
                type: 'string',
                enum: [
                  'conversationNode', 'intentNode', 'inputNode',
                  'outputNode', 'storeNode', 'insertNode',
                  'confirmationNode', 'goToNode',
                ],
              },
              purpose:   { type: 'string' },
              readsFrom: { type: 'string', description: 'Solo storeNode: ID del outputNode del que lee.' },
            },
          },
        },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            required: ['source', 'target'],
            properties: {
              source: { type: 'string' },
              target: { type: 'string' },
              label:  { type: 'string' },
            },
          },
        },
      },
    },
  },
};

const GENERATE_NODE_CONFIG_TOOL: GroqTool = {
  type: 'function',
  function: {
    name: 'generate_node_config',
    description: 'Genera la configuración completa de un nodo específico del flujo.',
    parameters: {
      type: 'object',
      required: ['success'],
      properties: {
        success: { type: 'boolean' },
        reformulationReason: { type: 'string' },
        config: { type: 'object' },
      },
    },
  },
};


const GENERATE_CHAIN_CONFIG_TOOL: GroqTool = {
  type: 'function',
  function: {
    name: 'generate_chain_config',
    description: 'Configura la cadena outputNode → storeNode → insertNode como una unidad atómica, garantizando coherencia de campos entre los tres nodos.',
    parameters: {
      type: 'object',
      required: ['success', 'outputConfig', 'storeConfig', 'insertConfig'],
      properties: {
        success: { type: 'boolean' },
        reformulationReason: { type: 'string' },
        outputConfig: {
          type: 'object',
          description: 'Config del outputNode.',
          required: ['label', 'schemes', 'globalCriteria', 'templateMode', 'outputTemplate'],
          properties: {
            label:               { type: 'string' },
            schemes: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'selectedSchema', 'selectedFields', 'schemaName'],
                properties: {
                  id:             { type: 'string', description: 'Identificador interno del scheme. Ej: "scheme_1". NUNCA el ObjectId de MongoDB.' },
                  selectedSchema: { type: 'string', description: 'Nombre exacto del schema.' },
                  selectedFields: { type: 'array', items: { type: 'string' }, description: 'Campos que serán cargados desde el schema. IMPORTANTE: si el outputNode alimenta un storeNode, SIEMPRE debe incluir el campo identificador ("id") aunque no aparezca en outputTemplate. El id es obligatorio para mantener referencias entre entidades.',},
                  schemaName:     { type: 'string', description: 'Mismo valor que selectedSchema.' },
                },
              },
            },
            globalCriteria:      { type: 'array', items: { type: 'object' }, description: 'Filtros globales. [] si no hay filtros.' },
            templateMode:        { type: 'string', enum: ['list', 'message', 'raw'], description: 'Usar "list" cuando va seguido de storeNode.' },
            outputTemplate:      { type: 'string', description: 'Template Handlebars. Ver formato en las instrucciones.' },
            outputVisible:       { type: 'boolean' },
            emptyFallbackEnabled:{ type: 'boolean' },
            emptyFallbackMessage:{ type: 'string' },
          },
        },
        storeConfig: {
          type: 'object',
          description: 'Config del storeNode. Los campos deben ser coherentes con los selectedFields del outputNode.',
          required: ['label', 'nodeId', 'objectVar', 'extractFromNodeId', 'isArray', 'isGlobal', 'permissions', 'feedbackVisible', 'description'],
          properties: {
            label:            { type: 'string' },
            nodeId:           { type: 'string', description: 'Mismo ID que el nodo en el skeleton.' },
            objectVar:        { type: 'string', description: 'Nombre de la variable en formState. Ej: "carrito", "pedido_seleccionado".' },
            extractFromNodeId:{ type: 'string', description: 'ID del outputNode del que lee. Debe coincidir exactamente.' },
            isArray:          { type: 'boolean', description: 'true si acumula múltiples objetos (carrito), false si es uno solo.' },
            isGlobal:         { type: 'boolean' },
            closeNodeId:      { type: 'string' },
            permissions:      { type: 'array', items: { type: 'string', enum: ['insert', 'edit', 'delete', 'show'] } },
            feedbackVisible:  { type: 'boolean' },
            feedbackMessage:  { type: 'string' },
            description:      { type: 'string' },
            triggerPhrases:   { type: 'string' },
            avoidPhrases:     { type: 'string' },
          },
        },
        insertConfig: {
          type: 'object',
          description: 'Config del insertNode. Los fieldMappings deben referenciar obj:objectVar.campo usando el objectVar del storeNode.',
          required: ['label', 'selectedSchemaId', 'schemaName', 'fieldMappings'],
          properties: {
            label:           { type: 'string' },
            selectedSchemaId:{ type: 'string', description: 'Nombre del schema de inserción (no el de consulta).' },
            schemaName:      { type: 'string' },
            fieldMappings: {
              type: 'array',
              items: {
                type: 'object',
                required: ['schemaField', 'source'],
                properties: {
                  schemaField: { type: 'string', description: 'Campo del schema de inserción.' },
                  source: {
                    type: 'string',
                    description: 'Origen del valor. Formato: "obj:objectVar.campo" | "form:campo" | "auto:now" | "auto:order".',
                  },
                },
              },
            },
            outputEnabled:   { type: 'boolean' },
            outputTemplate:  { type: 'string' },
          },
        },
      },
    },
  },
};


// ─────────────────────────────────────────────────────────────────────────────
// Descripción semántica de nodos (para skeleton)
// ─────────────────────────────────────────────────────────────────────────────

const NODE_SEMANTIC_DESCRIPTIONS = `
## Nodos disponibles

- **conversationNode**: Entrega un mensaje al usuario o hace una pregunta libre. Nodo de inicio obligatorio (type: "start"). También para mensajes intermedios y cierre.

- **inputNode**: Captura un valor escalar: texto, número, fecha, selección. Para campos simples como nombre, teléfono, cantidad. Para objetos complejos usa storeNode.

- **intentNode**: Clasifica el mensaje en ramas predefinidas. Cuando el flujo se bifurca: comprar vs consultar, continuar vs cancelar.

- **outputNode**: Consulta datos de un schema y los muestra. Si va seguido de storeNode, usar templateMode: "raw".

- **storeNode**: Captura objetos que el usuario selecciona de una lista mostrada por outputNode. Memoria dinámica del flujo. SIEMPRE después de outputNode, nunca antes.

- **insertNode**: Persiste datos en MongoDB. Siempre después de storeNode o inputNode.

- **confirmationNode**: Muestra resumen y pide confirmación. Genera 2 edges: "yes" y "no". Siempre ANTES de insertNode.

- **goToNode**: Redirige a otro nodo. Para loops o menús.

## Reglas estructurales OBLIGATORIAS

1. SIEMPRE empieza con conversationNode type "start".
2. storeNode SIEMPRE después de outputNode — nunca antes.
3. Cada storeNode tiene "readsFrom" apuntando a su outputNode.
4. insertNode SIEMPRE después de storeNode o inputNode.
5. confirmationNode SIEMPRE antes de insertNode — el flujo es: store → confirmation → insert.
6. confirmationNode genera exactamente 2 edges: label "yes" → insertNode, label "no" → nodo anterior.
7. goToNode solo para loops.
8. Edges de nodos lineales (conversationNode, outputNode, storeNode, insertNode, inputNode) NUNCA llevan label.
   label SOLO en edges de intentNode (id de la intención) y confirmationNode ("yes" / "no").
`;

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces TypeScript por tipo de nodo (para config)
// ─────────────────────────────────────────────────────────────────────────────

const NODE_INTERFACES: Partial<Record<NodeType, string>> = {
  conversationNode: `
interface ConversationNodeData {
  label: string;
  type: "start" | "message" | "question" | "end";
  mode?: "template" | "ia";
  message: string;
}
// IMPORTANTE: el campo "type" aquí es el subtipo del nodo (start/message/question/end).
// NO incluyas "type" con valor "conversationNode" dentro de config — eso va en el campo raíz del nodo.`,

  inputNode: `
interface InputNodeData {
  label: string;
  fieldName: string;
  fieldType: "text" | "number" | "date" | "select";
  description: string;
  options?: string[];
  implicit?: boolean;
}`,

  intentNode: `
interface Intent {
  id: string;
  label: string;
  description: string;
  examples?: string;
}
interface IntentNodeData {
  label: string;
  contextPrompt: string;
  intents: Intent[];
  fallbackBehavior: "retry" | "goto_start";
  maxRetries: number;
}`,

  outputNode: `
interface SchemeObject {
  id: string;             // identificador INTERNO del scheme dentro del nodo. Ej: "scheme_1", "scheme_2".
                          // NUNCA uses aquí el ID de MongoDB. Es solo un índice local.
  selectedSchema: string; // nombre exacto del schema (no el ID de MongoDB — se resuelve al confirmar)
  selectedFields: string[];
  schemaName: string;     // mismo valor que selectedSchema
}
interface GlobalCriteria {
  scheme: string;
  column: string;
  condition: string;
  value: string;
  valueSource: "form" | "static";
}
interface OutputNodeData {
  label: string;
  schemes: SchemeObject[];
  globalCriteria: GlobalCriteria[];
  outputTemplate?: string;
  outputVisible?: boolean;
  templateMode: "message" | "list" | "raw";
  emptyFallbackEnabled?: boolean;
  emptyFallbackMessage?: string;
}
// IMPORTANTE: NO incluyas "type" dentro de config.`,

  storeNode: `
interface StoreNodeData {
  nodeId: string;
  objectVar: string;
  extractFromNodeId: string;
  isArray: boolean;
  isGlobal: boolean;
  closeNodeId?: string;
  permissions: Array<"insert" | "edit" | "delete" | "show">;
  feedbackVisible: boolean;
  feedbackMessage?: string;
  description: string;
  triggerPhrases?: string;
  avoidPhrases?: string;
}
// CRÍTICO: SIEMPRE después de outputNode. Para escalares usa inputNode.
// IMPORTANTE: NO incluyas "type" dentro de config.`,

  insertNode: `
interface FieldMapping {
  schemaField: string;
  source: string; // "form:campo" | "obj:var.atributo" | "auto:now" | "auto:order"
}
interface InsertNodeData {
  label: string;
  selectedSchemaId: string; // nombre del schema (se resuelve al confirmar)
  schemaName: string;
  fieldMappings: FieldMapping[];
  outputEnabled?: boolean;
  outputTemplate?: string;
}`,

  confirmationNode: `
interface SummaryField {
  fieldName: string;
  displayLabel: string;
}
interface ConfirmationNodeData {
  label: string;
  confirmationMessage: string;
  positiveLabel: string;
  negativeLabel: string;
  summaryFields: SummaryField[];
}
// Genera exactamente 2 edges: label "yes" → insertNode, label "no" → nodo anterior.
// IMPORTANTE: NO incluyas "type" dentro de config.`,

  goToNode: `
interface GoToNodeData {
  label: string;
  targetNodeId: string;
  targetNodeLabel: string;
  reason: string;
}`,
};

// ─────────────────────────────────────────────────────────────────────────────
// MapflowInferenceService
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class MapflowInferenceService {
  private readonly logger = new Logger(MapflowInferenceService.name);
  private readonly MAX_REFORMULATIONS = 2;

  constructor(private readonly groq: GroqService) {}

  // ─── Entry point ───────────────────────────────────────────────────────────

  async inferMapflow(
    name: string,
    description: string,
    existingSchemas: ExistingSchemaContext[] = [],
  ): Promise<MapflowAiOutput> {
    // ── Fase 0: Análisis previo ───────────────────────────────────────────────
    const analysis = await this.callAnalyzeFlow(name, description, existingSchemas);

    this.logger.log(
      `[MapflowInference] Análisis completado — ` +
      `roles=${JSON.stringify(analysis.existingSchemaRoles)} ` +
      `requiresInsertion=${analysis.requiresInsertion} ` +
      `missingSchemas=${analysis.missingSchemas.join(',')} ` +
      `reasoning: ${analysis.reasoning}`,
    );

    // ── Fases 1..N: Skeleton + Config ─────────────────────────────────────────
    let reformulationContext = '';
    let attempt = 0;

    while (attempt <= this.MAX_REFORMULATIONS) {
      const skeleton = await this.callGenerateSkeleton(
        name,
        description,
        existingSchemas,
        analysis,
        reformulationContext,
      );

      this.validateSkeleton(skeleton);

      const configuredNodes: LlmNode[] = [];
      let reformulationReason = '';

      // Detectar cadenas output → store → insert para configurarlas como unidad atómica
      const processedIds = new Set<string>();

      for (let i = 0; i < skeleton.nodes.length; i++) {
        const current = skeleton.nodes[i];

        // Nodo ya procesado como parte de una cadena
        if (processedIds.has(current.id)) continue;

        // Detectar cadena: outputNode seguido de storeNode seguido de insertNode
        if (current.type === 'outputNode') {
          const storeNode = skeleton.nodes.find(
            (n) => n.type === 'storeNode' && n.readsFrom === current.id,
          );
          const insertNode = storeNode
            ? skeleton.nodes.find((n, idx) => {
                if (n.type !== 'insertNode') return false;
                // El insertNode debe venir después del storeNode en el skeleton
                const storeIdx = skeleton.nodes.findIndex((x) => x.id === storeNode.id);
                return idx > storeIdx;
              })
            : null;

          if (storeNode && insertNode) {
            // Configurar la cadena completa en una sola llamada
            const chainResult = await this.callGenerateChainConfig(
              current,
              storeNode,
              insertNode,
              skeleton,
              existingSchemas,
            );

            if (!chainResult.success) {
              reformulationReason = chainResult.reformulationReason ?? 'Incongruencia en la cadena output→store→insert.';
              this.logger.warn(`[MapflowInference] Reformulando cadena (intento ${attempt + 1}): ${reformulationReason}`);
              break;
            }

            configuredNodes.push({
              id: current.id, type: current.type,
              label: chainResult.outputConfig!.label ?? current.purpose,
              config: chainResult.outputConfig!,
            });
            configuredNodes.push({
              id: storeNode.id, type: storeNode.type,
              label: chainResult.storeConfig!.label ?? storeNode.purpose,
              config: chainResult.storeConfig!,
            });
            configuredNodes.push({
              id: insertNode.id, type: insertNode.type,
              label: chainResult.insertConfig!.label ?? insertNode.purpose,
              config: chainResult.insertConfig!,
            });

            processedIds.add(current.id);
            processedIds.add(storeNode.id);
            processedIds.add(insertNode.id);
            continue;
          }
        }

        // Nodo individual — configuración normal
        const previous = i > 0 ? skeleton.nodes[i - 1] : null;
        const result = await this.callGenerateNodeConfig(current, previous, skeleton, existingSchemas);

        if (!result.success) {
          reformulationReason = result.reformulationReason ?? 'Incongruencia estructural.';
          this.logger.warn(`[MapflowInference] Reformulando nodo (intento ${attempt + 1}): ${reformulationReason}`);
          break;
        }

        configuredNodes.push({
          id:     current.id,
          type:   current.type,
          label:  result.config!.label ?? current.purpose,
          config: result.config!,
        });
      }

      if (configuredNodes.length === skeleton.nodes.length) {
        return {
          nodes:           configuredNodes,
          edges:           skeleton.edges,
          inferredSchemas: skeleton.inferredSchemas,
        };
      }

      reformulationContext = reformulationReason;
      attempt++;
    }

    throw new InternalServerErrorException({
      message: 'No se pudo generar el MapFlow tras múltiples intentos.',
      details: reformulationContext,
    });
  }

  // ─── Llamada 0: Análisis ───────────────────────────────────────────────────

  private async callAnalyzeFlow(
    name: string,
    description: string,
    existingSchemas: ExistingSchemaContext[],
  ): Promise<FlowAnalysis> {
    const prompt = this.buildAnalysisPrompt(name, description, existingSchemas);

    const result = await this.groq.chatWithTools(
      [{ role: 'user', content: prompt }],
      [ANALYZE_FLOW_TOOL],
      { toolChoice: 'analyze_flow', temperature: 0.1, maxCompletionTokens: 1024 },
    );

    const toolCall = result.toolCalls[0];
    if (!toolCall) {
      throw new InternalServerErrorException({ message: 'Groq no llamó al tool analyze_flow.' });
    }

    try {
      return JSON.parse(toolCall.function.arguments) as FlowAnalysis;
    } catch {
      throw new InternalServerErrorException({
        message: 'analyze_flow devolvió JSON inválido.',
        details: toolCall.function.arguments,
      });
    }
  }

  // ─── Llamada 1: Skeleton ───────────────────────────────────────────────────

  private async callGenerateSkeleton(
    name: string,
    description: string,
    existingSchemas: ExistingSchemaContext[],
    analysis: FlowAnalysis,
    reformulationContext: string,
  ): Promise<FlowSkeleton> {
    const prompt = this.buildSkeletonPrompt(
      name,
      description,
      existingSchemas,
      analysis,
      reformulationContext,
    );

    const result = await this.groq.chatWithTools(
      [{ role: 'user', content: prompt }],
      [GENERATE_SKELETON_TOOL],
      { toolChoice: 'generate_skeleton', temperature: 0.2, maxCompletionTokens: 2048 },
    );

    const toolCall = result.toolCalls[0];
    if (!toolCall) {
      throw new InternalServerErrorException({ message: 'Groq no llamó al tool generate_skeleton.' });
    }

    try {
      return JSON.parse(toolCall.function.arguments) as FlowSkeleton;
    } catch {
      throw new InternalServerErrorException({
        message: 'generate_skeleton devolvió JSON inválido.',
        details: toolCall.function.arguments,
      });
    }
  }

  // ─── Llamada 2..N: Config por nodo ────────────────────────────────────────

  private async callGenerateNodeConfig(
    current: SkeletonNode,
    previous: SkeletonNode | null,
    skeleton: FlowSkeleton,
    existingSchemas: ExistingSchemaContext[],
  ): Promise<NodeConfigResult> {
    const prompt = this.buildNodeConfigPrompt(current, previous, skeleton, existingSchemas);

    const result = await this.groq.chatWithTools(
      [{ role: 'user', content: prompt }],
      [GENERATE_NODE_CONFIG_TOOL],
      { toolChoice: 'generate_node_config', temperature: 0.1, maxCompletionTokens: 1024 },
    );

    const toolCall = result.toolCalls[0];
    if (!toolCall) {
      throw new InternalServerErrorException({
        message: `Groq no llamó al tool generate_node_config para nodo "${current.id}".`,
      });
    }

    try {
      return JSON.parse(toolCall.function.arguments) as NodeConfigResult;
    } catch {
      throw new InternalServerErrorException({
        message: `generate_node_config devolvió JSON inválido para nodo "${current.id}".`,
        details: toolCall.function.arguments,
      });
    }
  }

  // ─── Prompts ───────────────────────────────────────────────────────────────


  // ─── Llamada de cadena: outputNode → storeNode → insertNode ──────────────

  private async callGenerateChainConfig(
    outputNode: SkeletonNode,
    storeNode: SkeletonNode,
    insertNode: SkeletonNode,
    skeleton: FlowSkeleton,
    existingSchemas: ExistingSchemaContext[],
  ): Promise<{ success: boolean; reformulationReason?: string; outputConfig?: Record<string,any>; storeConfig?: Record<string,any>; insertConfig?: Record<string,any> }> {
    const prompt = this.buildChainConfigPrompt(outputNode, storeNode, insertNode, skeleton, existingSchemas);

    const result = await this.groq.chatWithTools(
      [{ role: 'user', content: prompt }],
      [GENERATE_CHAIN_CONFIG_TOOL],
      { toolChoice: 'generate_chain_config', temperature: 0.1, maxCompletionTokens: 2048 },
    );

    const toolCall = result.toolCalls[0];
    if (!toolCall) {
      throw new InternalServerErrorException({
        message: `Groq no llamó al tool generate_chain_config para cadena "${outputNode.id}→${storeNode.id}→${insertNode.id}".`,
      });
    }

    try {
      return JSON.parse(toolCall.function.arguments);
    } catch {
      throw new InternalServerErrorException({
        message: `generate_chain_config devolvió JSON inválido.`,
        details: toolCall.function.arguments,
      });
    }
  }


  /**
   * Construye el ejemplo de outputTemplate Handlebars de forma segura.
   * Se hace con concatenación en lugar de template literal anidado para
   * evitar el conflicto de sintaxis entre ${...} (JS) y {{...}} (Handlebars).
   */
  private buildTemplateExample(schema: ExistingSchemaContext): string {
    const schemaName = schema.name;
    const f1 = schema.fields[1]?.name ?? 'nombre';
    const f2 = schema.fields[2]?.name;
    const f3 = schema.fields[3]?.name;

    let line = '- {{' + schemaName + '.' + f1 + '}}';
    if (f2) line += ' de {{' + schemaName + '.' + f2 + '}}';
    if (f3) line += ' a ${{' + schemaName + '.' + f3 + '}}';

    const lines = [
      'Ejemplo de outputTemplate para "' + schemaName + '":',
      '```',
      'Aquí tienes nuestros productos disponibles:',
      '{{#each}}',
      line,
      '{{/each}}',
      '```',
      '',
      'Reglas del template:',
      '- Usa {{#each}}...{{/each}} para listar múltiples objetos',
      '- Dentro del each: {{nombreSchema.campo}}',
      '- Texto estático fuera del each',
      '- Sin each si es un solo objeto: {{nombreSchema.campo}} directo',
    ];

    return lines.join('\n');
  }

  private buildChainConfigPrompt(
    outputNode: SkeletonNode,
    storeNode: SkeletonNode,
    insertNode: SkeletonNode,
    skeleton: FlowSkeleton,
    existingSchemas: ExistingSchemaContext[],
  ): string {
    // Schema de consulta (outputNode) — el que ya existe
    const querySchema = existingSchemas.find((s) =>
      skeleton.inferredSchemas.every((inf) => inf.name !== s.name),
    ) ?? existingSchemas[0];

    // Schema de inserción — puede ser inferido o existente
    const allSchemas = [
      ...existingSchemas.map((s) => ({ ...s, isNew: false })),
      ...skeleton.inferredSchemas.map((s) => ({ ...s, id: s.name, isNew: true })),
    ];
    const insertSchema = allSchemas.find((s) =>
      s.name !== querySchema?.name,
    );

    const querySchemaSection = querySchema
      ? `## Schema de CONSULTA (outputNode) — ya existe en DB
- Nombre: "${querySchema.name}"
- Campos disponibles: ${querySchema.fields.map((f) => `${f.name} (${f.type})`).join(', ')}
- Usa este schema en outputNode.schemes[].selectedSchema y selectedFields.`
      : '## Schema de consulta\nNo hay schema existente — usa el schema inferido.';

    const insertSchemaSection = insertSchema
      ? `## Schema de INSERCIÓN (insertNode) — ${insertSchema.isNew ? 'NUEVO, inferido' : 'ya existe en DB'}
- Nombre: "${insertSchema.name}"
- Campos: ${insertSchema.fields.map((f: any) => `${f.name} (${f.type})`).join(', ')}
- Usa este schema en insertNode.selectedSchemaId y fieldMappings.`
      : '';

    // Ejemplo de template Handlebars basado en el schema real
    const templateExample = querySchema
      ? this.buildTemplateExample(querySchema)
      : '';

    return `Eres un experto en configuración de flujos conversacionales.

Debes configurar una CADENA ATÓMICA de 3 nodos que son codependientes.
Es CRÍTICO que los campos sean coherentes entre los 3 nodos.

## Flujo completo (referencia)
${skeleton.nodes.map((n) => `${n.id} (${n.type})`).join(' → ')}

## Los 3 nodos a configurar juntos

1. **outputNode** "${outputNode.id}" — muestra datos al usuario
   - Propósito: ${outputNode.purpose}

2. **storeNode** "${storeNode.id}" — captura lo que el usuario selecciona
   - Propósito: ${storeNode.purpose}
   - extractFromNodeId DEBE ser: "${outputNode.id}"

3. **insertNode** "${insertNode.id}" — persiste los datos en MongoDB
   - Propósito: ${insertNode.purpose}

${querySchemaSection}

${insertSchemaSection}

## Reglas de coherencia entre los 3 nodos (OBLIGATORIAS)

1. Los campos en outputNode.schemes[].selectedFields (a menos que la logica de negocio lo necesite o el usaurio lo solicite, 
    no se debera mostrar el id en el outputTemplate a pesar de que exista en los selectedfields)
2. El storeNode captura exactamente esos objetos — objectVar es el nombre de la variable (ej: "carrito").
3. El insertNode mapea los campos usando "obj:objectVar.campo":
   - Si objectVar="carrito" y selectedFields=["nombre","precio"] →
     fieldMappings: [{ schemaField: "nombre", source: "obj:carrito.nombre" }, ...]
4. El schema del outputNode y el del insertNode son DIFERENTES:
   - outputNode.schemes[].selectedSchema = schema de CONSULTA ("${querySchema?.name ?? 'schema_consulta'}")
   - insertNode.selectedSchemaId = schema de INSERCIÓN ("${insertSchema?.name ?? 'schema_insercion'}")
5. schemes[].id es un identificador INTERNO del nodo ("scheme_1", "scheme_2") — NUNCA el ObjectId de MongoDB.

## Formato del outputTemplate (Handlebars)

${templateExample}

## Regla crítica de config
NUNCA incluyas el campo "type" con el nombre del tipo de nodo dentro de ningún config.

Llama al tool generate_chain_config con la configuración completa de los 3 nodos.`;
  }

  private buildAnalysisPrompt(
    name: string,
    description: string,
    existingSchemas: ExistingSchemaContext[],
  ): string {
    const schemaSection = existingSchemas.length
      ? `## Schemas existentes del cliente (YA EXISTEN en la base de datos)
${existingSchemas.map((s) =>
  `- Nombre: "${s.name}" | Categoría: ${s.category}${s.description ? ` | Descripción: ${s.description}` : ''}
  Campos: ${s.fields.map((f) => `${f.name} (${f.type}${f.required ? ', requerido' : ''})`).join(', ')}`
).join('\n')}`
      : '## Schemas existentes\nEl cliente no proporcionó schemas.';

    return `Eres un analista de flujos conversacionales para chatbots de negocio.

Tu tarea es entender qué schemas tiene el negocio, clasificar su rol, e identificar qué schemas adicionales necesita el flujo.

## Flujo a analizar
- Nombre: ${name}
- Descripción: ${description}

${schemaSection}

## Cómo clasificar cada schema existente

Para cada schema que el cliente proporcionó, determina:

**coversQuery = true** si el schema tiene datos que el flujo necesita MOSTRAR al usuario.
- Ej: schema "inventario_farmaceutico" con campos nombre/precio → un flujo de ventas lo usa para mostrar el catálogo → coversQuery: true

**coversInsertion = true** si el schema es el destino donde el flujo INSERTA nuevos registros.
- Ej: schema "pedidos" con campos fecha/total → el flujo inserta ahí los pedidos → coversInsertion: true
- REGLA CRÍTICA: un schema de inventario/productos/catálogo NUNCA cubre inserción de pedidos.
  Los pedidos son una entidad diferente. Un schema de "inventario_farmaceutico" tiene coversInsertion: false
  para un flujo de ventas — los pedidos deben ir en un schema separado.

## Cómo identificar schemas faltantes

Después de clasificar los existentes, determina qué schemas necesita el flujo y no están cubiertos:
- Si el flujo inserta pedidos y no hay schema con coversInsertion=true → missingSchemas: ["pedidos"]
- Si el flujo muestra un catálogo y hay un schema con coversQuery=true → NO hace falta uno nuevo
- Si el cliente no subió ningún schema y el flujo necesita datos → infiere todos los necesarios

## Ejemplos de razonamiento correcto

Caso 1: Cliente sube "inventario_farmaceutico", flujo de ventas con pedidos
→ existingSchemaRoles: [{ name: "inventario_farmaceutico", coversQuery: true, coversInsertion: false }]
→ missingSchemas: ["pedidos"]  ← porque el flujo inserta pedidos y no hay schema para eso

Caso 2: Cliente sube "inventario" y "pedidos", flujo de ventas
→ existingSchemaRoles: [
    { name: "inventario", coversQuery: true, coversInsertion: false },
    { name: "pedidos", coversQuery: false, coversInsertion: true }
  ]
→ missingSchemas: []  ← todo está cubierto

Caso 3: Cliente no sube ningún schema, flujo de agenda
→ existingSchemaRoles: []
→ missingSchemas: ["disponibilidad", "citas"]

Llama al tool analyze_flow con tu análisis.`;
  }

  private buildSkeletonPrompt(
    name: string,
    description: string,
    existingSchemas: ExistingSchemaContext[],
    analysis: FlowAnalysis,
    reformulationContext: string,
  ): string {
    const schemaSection = existingSchemas.length
      ? `## ⚠️ SCHEMAS EXISTENTES — DEBES USARLOS OBLIGATORIAMENTE
Estos schemas YA EXISTEN en la base de datos. No los reemplaces ni los dupliques con otros nombres.

${existingSchemas.map((s) =>
  `### "${s.name}" (ID: "${s.id}")
- Categoría: ${s.category}${s.description ? `\n- Descripción: ${s.description}` : ''}
- Campos: ${s.fields.map((f) => `${f.name} (${f.type}${f.required ? ', requerido' : ''})`).join(', ')}`
).join('\n\n')}

REGLAS ESTRICTAS:
→ Cualquier outputNode o insertNode que maneje estos datos DEBE referenciar el nombre exacto del schema.
→ inferredSchemas SOLO puede contener schemas para datos que NINGUNO de los schemas anteriores cubre.
→ NUNCA crees un schema con diferente nombre que cumpla la misma función de uno ya existente.
→ Roles confirmados por el análisis:
${analysis.existingSchemaRoles.map((r) =>
  `  • "${r.name}": consulta=${r.coversQuery ? 'SÍ' : 'NO'}, inserción=${r.coversInsertion ? 'SÍ' : 'NO'}`
).join('\n')}
${analysis.missingSchemas.length ? `→ Schemas adicionales a inferir: ${analysis.missingSchemas.join(', ')}` : '→ No se necesitan schemas adicionales'}.`
      : `## Schemas
El cliente no proporcionó schemas. Infiere los necesarios en inferredSchemas.
El análisis sugiere: ${analysis.missingSchemas.length ? analysis.missingSchemas.join(', ') : 'decide según la descripción'}.`;

    // Contexto del análisis previo
    const analysisSection = `## Análisis previo del flujo
${analysis.reasoning}

Conclusiones:
- ¿Necesita mostrar lista para selección? → ${analysis.requiresSelection ? 'SÍ (incluir outputNode + storeNode)' : 'NO'}
- ¿Necesita insertar datos? → ${analysis.requiresInsertion ? 'SÍ (incluir confirmationNode + insertNode)' : 'NO'}
- ¿Tiene bifurcaciones de intención? → ${analysis.requiresIntent ? 'SÍ (incluir intentNode)' : 'NO'}`;

    const reformulationSection = reformulationContext
      ? `## ⚠️ REFORMULACIÓN REQUERIDA\n${reformulationContext}\nCorrige este problema en el nuevo skeleton.`
      : '';

    return `Eres un experto en diseño de flujos conversacionales.

Diseña el ESQUELETO del flujo — solo estructura de nodos y conexiones, sin config detallada.

## MapFlow
- Nombre: ${name}
- Descripción: ${description}

${schemaSection}

${analysisSection}

${NODE_SEMANTIC_DESCRIPTIONS}

${reformulationSection}

## Instrucciones finales
1. Flujo mínimo que cumpla la descripción — sin nodos innecesarios.
2. IDs semánticos: "node_saludo", "node_mostrar_productos", "node_store_carrito".
3. storeNode: incluye "readsFrom" con el ID del outputNode del que leerá.
4. El orden OBLIGATORIO cuando hay selección e inserción: outputNode → storeNode → confirmationNode → insertNode.
5. confirmationNode genera EXACTAMENTE 2 edges: label "yes" → insertNode, label "no" → nodo anterior al confirmation.
6. En inferredSchemas usa nombres de schema (sin IDs — aún no existen).

Llama al tool generate_skeleton.`;
  }

  private buildNodeConfigPrompt(
    current: SkeletonNode,
    previous: SkeletonNode | null,
    skeleton: FlowSkeleton,
    existingSchemas: ExistingSchemaContext[],
  ): string {
    const usedTypes = [...new Set(skeleton.nodes.map((n) => n.type))];
    const interfacesSection = usedTypes
      .filter((t) => NODE_INTERFACES[t])
      .map((t) => NODE_INTERFACES[t])
      .join('\n\n');

    // Schemas disponibles para referenciar
    const schemasRef: string[] = [];
    existingSchemas.forEach((s) => {
      schemasRef.push(
        `- "${s.name}" (EXISTENTE en DB, ID: "${s.id}") — campos: ${s.fields.map((f) => f.name).join(', ')}`,
      );
    });
    skeleton.inferredSchemas.forEach((s) => {
      schemasRef.push(
        `- "${s.name}" (NUEVO — sin ID aún, referenciar por nombre) — campos: ${s.fields.map((f) => f.name).join(', ')}`,
      );
    });

    const schemasSection = schemasRef.length
      ? `## Schemas disponibles\n${schemasRef.join('\n')}`
      : '';

    const previousSection = previous
      ? `## Nodo anterior\n- ID: "${previous.id}" | Tipo: ${previous.type}\n- Propósito: "${previous.purpose}"${previous.readsFrom ? `\n- readsFrom: "${previous.readsFrom}"` : ''}`
      : '## Nodo anterior\nEste es el primer nodo del flujo.';

    const dependencySection = this.buildDependencyContext(current, skeleton);

    const outgoing = skeleton.edges.filter((e) => e.source === current.id);
    const edgesSection = outgoing.length
      ? `## Edges salientes\n${outgoing.map((e) => `- → "${e.target}"${e.label ? ` (branch: "${e.label}")` : ''}`).join('\n')}`
      : '## Edges\nNodo terminal.';

    return `Eres un experto en configuración de flujos conversacionales.

## Flujo completo
${skeleton.nodes.map((n) => `${n.id} (${n.type})`).join(' → ')}

${previousSection}

## Nodo actual: "${current.id}" (${current.type})
- Propósito: "${current.purpose}"
${current.readsFrom ? `- readsFrom: "${current.readsFrom}"` : ''}

${edgesSection}

${dependencySection}

${schemasSection}

## Interfaces TypeScript
${interfacesSection}

## Regla crítica de config
NUNCA incluyas el campo "type" con el nombre del tipo de nodo dentro de config.
El "type" del nodo va en el campo raíz — dentro de config solo van los campos de la interfaz.
Ejemplo INCORRECTO: config: { "type": "confirmationNode", "label": "..." }
Ejemplo CORRECTO:   config: { "label": "..." }

## Instrucciones
1. Genera la config completa del nodo "${current.id}" según su interfaz TypeScript.
2. Para schemas: usa el nombre exacto del schema (los IDs se asignan al confirmar).
3. Si detectas incongruencia estructural → success: false con reformulationReason claro.
4. Si todo es coherente → success: true con config completa.

Llama al tool generate_node_config.`;
  }

  // ─── Contexto de dependencias ─────────────────────────────────────────────

  private buildDependencyContext(current: SkeletonNode, skeleton: FlowSkeleton): string {
    const nodeIndex = skeleton.nodes.findIndex((n) => n.id === current.id);
    const priorNodes = skeleton.nodes.slice(0, nodeIndex);

    switch (current.type) {
      case 'storeNode': {
        if (!current.readsFrom) return '';
        const outputNode = skeleton.nodes.find((n) => n.id === current.readsFrom);
        return outputNode
          ? `## Dependencia\nEste storeNode lee del outputNode "${outputNode.id}".\n"extractFromNodeId" debe ser exactamente "${outputNode.id}".`
          : '';
      }
      case 'insertNode': {
        const inputs = priorNodes.filter((n) => n.type === 'inputNode');
        const stores = priorNodes.filter((n) => n.type === 'storeNode');
        const parts  = ['## Datos en formState disponibles'];
        if (inputs.length) parts.push(`Escalares:\n${inputs.map((n) => `- "${n.id}": ${n.purpose}`).join('\n')}`);
        if (stores.length) parts.push(`Objetos:\n${stores.map((n) => `- "${n.id}": ${n.purpose}`).join('\n')}`);
        return parts.join('\n');
      }
      case 'confirmationNode': {
        const inputs = priorNodes.filter((n) => n.type === 'inputNode');
        const stores = priorNodes.filter((n) => n.type === 'storeNode');
        if (!inputs.length && !stores.length) return '';
        const parts = ['## Campos disponibles para summaryFields'];
        inputs.forEach((n) => parts.push(`- inputNode "${n.id}": ${n.purpose}`));
        stores.forEach((n) => parts.push(`- storeNode "${n.id}" (objectVar se define en su config): ${n.purpose}`));
        return parts.join('\n');
      }
      case 'goToNode': {
        const targets = priorNodes.map(
          (n) => `- ID: "${n.id}" | Tipo: ${n.type} | Propósito: "${n.purpose}"`,
        );
        return targets.length ? `## Nodos disponibles como destino\n${targets.join('\n')}` : '';
      }
      default:
        return '';
    }
  }

  // ─── Validación determinista del skeleton ─────────────────────────────────

  private validateSkeleton(skeleton: FlowSkeleton): void {
    if (!skeleton.nodes.length) {
      throw new InternalServerErrorException({ message: 'El skeleton no contiene nodos.' });
    }

    if (skeleton.nodes[0].type !== 'conversationNode') {
      throw new InternalServerErrorException({
        message: `El primer nodo debe ser conversationNode, pero es "${skeleton.nodes[0].type}".`,
      });
    }

    const nodeIds = new Set(skeleton.nodes.map((n) => n.id));

    for (const edge of skeleton.edges) {
      if (!nodeIds.has(edge.source)) {
        throw new InternalServerErrorException({
          message: `Edge con source "${edge.source}" no existe.`,
        });
      }
      if (!nodeIds.has(edge.target)) {
        throw new InternalServerErrorException({
          message: `Edge con target "${edge.target}" no existe.`,
        });
      }
    }

    // Nodos lineales no deben tener edges con label
    const LINEAR_TYPES: NodeType[] = [
      'conversationNode', 'outputNode', 'storeNode',
      'insertNode', 'inputNode', 'goToNode',
    ];
    for (const edge of skeleton.edges) {
      if (edge.label) {
        const sourceNode = skeleton.nodes.find((n) => n.id === edge.source);
        if (sourceNode && LINEAR_TYPES.includes(sourceNode.type)) {
          throw new InternalServerErrorException({
            message:
              `El edge de "${edge.source}" (${sourceNode.type}) no debe tener label "${edge.label}". ` +
              `Solo intentNode y confirmationNode generan edges con label.`,
          });
        }
      }
    }

    for (const node of skeleton.nodes) {
      if (node.type === 'storeNode') {
        if (!node.readsFrom) {
          throw new InternalServerErrorException({
            message: `storeNode "${node.id}" no tiene "readsFrom".`,
          });
        }
        const target = skeleton.nodes.find((n) => n.id === node.readsFrom);
        if (!target || target.type !== 'outputNode') {
          throw new InternalServerErrorException({
            message: `storeNode "${node.id}" apunta a "${node.readsFrom}" que no es un outputNode válido.`,
          });
        }
      }

      // confirmationNode debe tener edge "yes" y edge "no"
      if (node.type === 'confirmationNode') {
        const outgoing = skeleton.edges.filter((e) => e.source === node.id);
        const hasYes = outgoing.some((e) => e.label === 'yes');
        const hasNo  = outgoing.some((e) => e.label === 'no');
        if (!hasYes || !hasNo) {
          throw new InternalServerErrorException({
            message: `confirmationNode "${node.id}" debe tener exactamente 2 edges: label "yes" y label "no". Encontrado: ${outgoing.map((e) => e.label).join(', ')}.`,
          });
        }
      }
    }
  }
}