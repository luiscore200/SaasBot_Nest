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
  CatalogPatternMatch,
} from './types';
import { NodeType } from 'src/data/mapflow/types';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos internos — Fase 0
// ─────────────────────────────────────────────────────────────────────────────

interface FlowAnalysis {
  existingSchemaRoles: Array<{
    name: string;
    coversQuery: boolean;
    coversInsertion: boolean;
  }>;
  missingSchemas: string[];
  requiresInsertion: boolean;
  requiresSelection: boolean;
  requiresIntent: boolean;
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
              name: { type: 'string', description: 'Nombre exacto del schema existente.' },
              coversQuery: {
                type: 'boolean',
                description: 'true si este schema sirve para CONSULTAR y mostrar datos al usuario (storeNode en modo búsqueda). Ej: un schema de inventario/productos cubre consultas.',
              },
              coversInsertion: {
                type: 'boolean',
                description: 'true si este schema es el destino donde el flujo INSERTA nuevos registros (insertNode). IMPORTANTE: un schema de inventario/productos NO cubre inserción de pedidos — los pedidos son una entidad diferente.',
              },
            },
          },
        },
        missingSchemas: {
          type: 'array',
          items: { type: 'string' },
          description: 'Nombres de schemas que el flujo necesita pero no existen en los schemas proporcionados. Vacío [] si los schemas existentes cubren todo.',
        },
        requiresInsertion: { type: 'boolean', description: 'true si el flujo necesita guardar/insertar datos en MongoDB.' },
        requiresSelection: { type: 'boolean', description: 'true si el flujo muestra opciones para que el usuario seleccione (necesita storeNode con search=true).' },
        requiresIntent:    { type: 'boolean', description: 'true si el flujo tiene bifurcaciones donde el usuario elige entre opciones (necesita intentNode).' },
        reasoning: {
          type: 'string',
          description: 'Razonamiento: qué tiene el negocio, para qué sirve cada schema, qué schemas faltan y por qué. Si se te proporcionó un patrón de catálogo, incluye aquí si es compatible o no, y por qué.',
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
              id:      { type: 'string' },
              type: {
                type: 'string',
                enum: [
                  'conversationNode', 'intentNode', 'inputNode',
                  'storeNode', 'insertNode',
                  'confirmationNode', 'goToNode',
                ],
              },
              purpose: { type: 'string' },
              storeMode: {
                type: 'string',
                enum: ['inline', 'floating'],
                description: 'Solo para storeNode. "inline" si va en la cadena principal (next/branches). "floating" si es un store global sin edges propios, activado por initStores/finishStores de otros nodos. Si se omite, se asume "inline".',
              },
              initStores: {
                type: 'array',
                items: { type: 'string' },
                description: 'IDs de storeNode (modo floating) que se ACTIVAN al llegar a este nodo. Solo aplica a nodos que no sean storeNode ni goToNode.',
              },
              finishStores: {
                type: 'array',
                items: { type: 'string' },
                description: 'IDs de storeNode (modo floating) que se DESACTIVAN al llegar a este nodo. Solo aplica a nodos que no sean storeNode ni goToNode.',
              },
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
    description: 'Configura la cadena storeNode → insertNode como una unidad atómica, garantizando coherencia de campos entre ambos.',
    parameters: {
      type: 'object',
      required: ['success', 'storeConfig', 'insertConfig'],
      properties: {
        success: { type: 'boolean' },
        reformulationReason: { type: 'string' },
        storeConfig: {
          type: 'object',
          description: 'Config del storeNode (búsqueda + captura). Reemplaza lo que antes eran outputNode + storeNode.',
          required: ['label', 'nodeId', 'objectVar', 'schemas', 'isArray', 'storePermissions', 'search', 'feedbackVisible'],
          properties: {
            label:     { type: 'string' },
            nodeId:    { type: 'string', description: 'Mismo ID que el nodo en el skeleton.' },
            objectVar: { type: 'string', description: 'Nombre de la variable en formState. Ej: "carrito", "cita_seleccionada".' },
            schemas: {
              type: 'array',
              items: { type: 'string' },
              description: 'Nombre(s) exacto(s) del/los schema(s) que este store consulta/captura.',
            },
            isArray: { type: 'boolean', description: 'true si acumula múltiples documentos (carrito), false si es uno solo.' },
            storePermissions: {
              type: 'object',
              required: ['create', 'show', 'delete', 'update'],
              properties: {
                create: { type: 'boolean' },
                show:   { type: 'boolean' },
                delete: { type: 'boolean' },
                update: { type: 'boolean' },
              },
            },
            search: { type: 'boolean', description: 'true si este store puede buscar/consultar documentos.' },
            searchOutput: {
              type: 'object',
              description: 'OBLIGATORIO si search=true.',
              required: ['searchFeedback'],
              properties: {
                searchFeedback:       { type: 'boolean' },
                templateList:         { type: 'string', description: 'Template Handlebars para VARIOS documentos.' },
                templateObj:          { type: 'string', description: 'Template Handlebars para UN solo documento.' },
                emptyFallbackEnabled: { type: 'boolean' },
                emptyFallbackMessage: { type: 'string' },
                pageSize:             { type: 'number' },
                globalCriteria: {
                  type: 'array',
                  items: { type: 'object' },
                  description: 'Filtros globales. [] si no hay filtros.',
                },
              },
            },
            feedbackVisible: { type: 'boolean' },
            feedbackMessage: { type: 'string' },
            llmDescription: {
              type: 'string',
              description: 'CRÍTICO en modo floating: el motor usa este texto para decidir si un mensaje del usuario aplica a este store. Sé específico sobre qué contiene y para qué sirve.',
            },
          },
        },
        insertConfig: {
          type: 'object',
          description: 'Config del insertNode. fieldMappings deben referenciar obj:objectVar.campo usando el objectVar del storeNode.',
          required: ['label', 'selectedSchemaId', 'schemaName', 'fieldMappings'],
          properties: {
            label:            { type: 'string' },
            selectedSchemaId: { type: 'string', description: 'Nombre del schema de inserción (puede ser el mismo del storeNode u otro distinto).' },
            schemaName:       { type: 'string' },
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
            outputEnabled:  { type: 'boolean' },
            outputTemplate: { type: 'string' },
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

- **inputNode**: Captura un valor escalar: texto, número, fecha, selección. Para campos simples como nombre, teléfono, cantidad. Para documentos completos de un schema usa storeNode.

- **intentNode**: Clasifica el mensaje en ramas predefinidas. Cuando el flujo se bifurca: comprar vs consultar, continuar vs cancelar.

- **storeNode**: Consulta Y captura documentos de uno o más schemas — reemplaza lo que antes eran DOS nodos separados (outputNode + storeNode). Tiene DOS modos:

  1. **INLINE** (vive en la cadena principal, con next/branches):
     Se ejecuta una sola vez al llegar. Busca contra el mensaje del usuario en ese turno
     — el motor decide automáticamente si es una búsqueda puntual o "mostrar todo", NO
     necesitas configurar esa heurística — y avanza por dos branches OBLIGATORIOS:
     "success" (encontró algo, lo guarda en objectVar) y "empty" (no encontró nada).
     Úsalo para: "el usuario elige un producto de una lista", "selecciona un horario disponible".

  2. **FLOATING** (global, SIN next/branches):
     No vive en la cadena principal. Se activa cuando el flujo llega a otro nodo que lo
     declara en "initStores", y se desactiva cuando llega a un nodo que lo declara en
     "finishStores". Mientras está activo, CUALQUIER mensaje del usuario se evalúa contra
     este store: puede buscar, agregar, editar, eliminar o listar ítems, según sus
     storePermissions. Úsalo para: carritos de compra, listas que el usuario arma
     libremente durante varios turnos ("agrega X", "quita Y", "muéstrame lo que llevo").

  En ambos modos, storeNode NUNCA persiste en MongoDB por sí mismo — solo mantiene el
  objeto/lista en memoria (formState). Para persistir usa insertNode después.

- **insertNode**: Persiste datos en MongoDB. Siempre después de storeNode o inputNode (directa o indirectamente, vía confirmationNode).

- **confirmationNode**: Muestra resumen y pide confirmación. Genera 2 edges: "yes" y "no". Úsalo antes de insertNode cuando la acción de insertar es significativa (compra, cita, pedido) y conviene que el usuario confirme antes de guardar.

- **goToNode**: Redirige a otro nodo. Para loops o menús.

## Reglas estructurales OBLIGATORIAS

1. SIEMPRE empieza con conversationNode type "start".
2. storeNode INLINE: SIEMPRE genera exactamente 2 edges desde sí mismo — label "success" y label "empty".
3. storeNode FLOATING: NUNCA tiene edges propios (ni entrantes ni salientes). Se activa/desactiva SOLO mediante "initStores"/"finishStores" declarados en OTROS nodos del skeleton — nunca lo dejes flotando sin que ningún nodo lo active.
4. insertNode SIEMPRE después de storeNode o inputNode en el flujo lógico.
5. Cuando hay confirmationNode, el orden es: store/input → confirmationNode → insertNode. confirmationNode genera exactamente 2 edges: label "yes" → insertNode, label "no" → nodo anterior.
6. goToNode solo para loops.
7. Edges de nodos lineales (conversationNode, insertNode, inputNode, goToNode) NUNCA llevan label.
   label SOLO en: intentNode (id de la intención), confirmationNode ("yes"/"no"), storeNode inline ("success"/"empty").
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
  initStores?: string[];   // IDs de storeNode floating a activar — se inyectan automáticamente, no los declares tú
  finishStores?: string[]; // IDs de storeNode floating a desactivar — se inyectan automáticamente
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
  initStores?: string[];
  finishStores?: string[];
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
  initStores?: string[];
  finishStores?: string[];
}`,

  storeNode: `
interface StorePermissions {
  create: boolean;
  show: boolean;
  delete: boolean;
  update: boolean;
}
interface GlobalCriteria {
  scheme: string;
  column: string;
  condition: string;
  value: string;
  valueSource: "form" | "static";
}
interface StoreSearchOutput {
  searchFeedback: boolean;
  templateList?: string;   // Handlebars — para cuando hay VARIOS documentos
  templateObj?: string;    // Handlebars — para cuando hay UN solo documento
  emptyFallbackEnabled?: boolean;
  emptyFallbackMessage?: string;
  pageSize?: number;
  globalCriteria?: GlobalCriteria[];
}
interface StoreNodeData {
  nodeId: string;
  objectVar: string;   // nombre de la variable en formState. Ej: "carrito", "cita_seleccionada".
  schemas: string[];   // nombre(s) exacto(s) del/los schema(s) que este store consulta/captura.
  isArray: boolean;    // true si acumula múltiples documentos (carrito), false si es uno solo.
  storePermissions: StorePermissions;
  search: boolean;     // true si este store puede buscar/consultar documentos.
  searchOutput?: StoreSearchOutput; // OBLIGATORIO si search=true.
  feedbackVisible: boolean;
  feedbackMessage?: string;
  llmDescription?: string; // CRÍTICO en modo floating: el motor decide con este texto si un mensaje aplica a este store.
  label?: string;
}
// storeNode reemplaza lo que antes eran DOS nodos (outputNode + storeNode).
// NUNCA persiste en MongoDB por sí mismo — solo mantiene el objeto/lista en formState.
// IMPORTANTE: NO incluyas "type" dentro de config. NO tiene initStores/finishStores propios
// (esos van en los nodos que lo activan/desactivan, no en el storeNode mismo).`,

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
  initStores?: string[];
  finishStores?: string[];
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
  initStores?: string[];
  finishStores?: string[];
}
// Genera exactamente 2 edges: label "yes" → insertNode, label "no" → nodo anterior.
// IMPORTANTE: NO incluyas "type" dentro de config.`,

  goToNode: `
interface GoToNodeData {
  label: string;
  targetNodeId: string;
  targetNodeLabel: string;
  reason: string;
  clearFields?: string[];
}`,
};

// ─────────────────────────────────────────────────────────────────────────────
// MapflowInferenceService
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class MapflowInferenceService {
  private readonly logger = new Logger(MapflowInferenceService.name);
  private readonly MAX_REFORMULATIONS = 2;

  /** Tipos de nodo cuya interfaz admite initStores/finishStores (ver StoreLifecycleHooks). */
  private readonly LIFECYCLE_HOOK_TYPES: NodeType[] = [
    'conversationNode', 'inputNode', 'intentNode', 'confirmationNode', 'insertNode',
  ];

  constructor(private readonly groq: GroqService) {}

  // ─── Entry point ───────────────────────────────────────────────────────────

  async inferMapflow(
    name: string,
    description: string,
    existingSchemas: ExistingSchemaContext[] = [],
    catalogMatch: CatalogPatternMatch | null = null,
  ): Promise<MapflowAiOutput> {
    const analysis = await this.callAnalyzeFlow(name, description, existingSchemas, catalogMatch);

    this.logger.log(
      `[MapflowInference] Análisis completado — ` +
      `roles=${JSON.stringify(analysis.existingSchemaRoles)} ` +
      `requiresInsertion=${analysis.requiresInsertion} ` +
      `missingSchemas=${analysis.missingSchemas.join(',')} ` +
      `reasoning: ${analysis.reasoning}`,
    );

    let reformulationContext = '';
    let attempt = 0;

    while (attempt <= this.MAX_REFORMULATIONS) {
      const skeleton = await this.callGenerateSkeleton(
        name, description, existingSchemas, analysis, reformulationContext, catalogMatch,
      );

      this.validateSkeleton(skeleton);

      const configuredNodes: LlmNode[] = [];
      let reformulationReason = '';
      const processedIds = new Set<string>();

      for (let i = 0; i < skeleton.nodes.length; i++) {
        const current = skeleton.nodes[i];
        if (processedIds.has(current.id)) continue;

        // Detectar cadena: storeNode con un insertNode más adelante en el skeleton
        if (current.type === 'storeNode') {
          const insertNode = skeleton.nodes.find((n, idx) => {
            if (n.type !== 'insertNode' || processedIds.has(n.id)) return false;
            return idx > i;
          });

          if (insertNode) {
            const chainResult = await this.callGenerateChainConfig(current, insertNode, skeleton, existingSchemas);

            if (!chainResult.success) {
              reformulationReason = chainResult.reformulationReason ?? 'Incongruencia en la cadena store→insert.';
              this.logger.warn(`[MapflowInference] Reformulando cadena (intento ${attempt + 1}): ${reformulationReason}`);
              break;
            }

            configuredNodes.push(this.finalizeNodeConfig(current, chainResult.storeConfig!, skeleton));
            configuredNodes.push(this.finalizeNodeConfig(insertNode, chainResult.insertConfig!, skeleton));

            processedIds.add(current.id);
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

        configuredNodes.push(this.finalizeNodeConfig(current, result.config!, skeleton));
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

  /**
   * Ensambla el LlmNode final e inyecta initStores/finishStores de forma
   * DETERMINISTA a partir del skeleton — nunca se le pide al LLM que los
   * reproduzca, para evitar errores de transcripción de IDs.
   */
  private finalizeNodeConfig(
    skeletonNode: SkeletonNode,
    config: Record<string, any>,
    skeleton: FlowSkeleton,
  ): LlmNode {
    const finalConfig = { ...config };

    if (this.LIFECYCLE_HOOK_TYPES.includes(skeletonNode.type)) {
      if (skeletonNode.initStores?.length)   finalConfig.initStores   = skeletonNode.initStores;
      if (skeletonNode.finishStores?.length) finalConfig.finishStores = skeletonNode.finishStores;
    }

    return {
      id:     skeletonNode.id,
      type:   skeletonNode.type,
      label:  finalConfig.label ?? skeletonNode.purpose,
      config: finalConfig,
    };
  }

  // ─── Llamada 0: Análisis ───────────────────────────────────────────────────

  private async callAnalyzeFlow(
    name: string,
    description: string,
    existingSchemas: ExistingSchemaContext[],
    catalogMatch: CatalogPatternMatch | null,
  ): Promise<FlowAnalysis> {
    const prompt = this.buildAnalysisPrompt(name, description, existingSchemas, catalogMatch);

    const result = await this.groq.chatWithTools(
      [{ role: 'user', content: prompt }],
      [ANALYZE_FLOW_TOOL],
      { toolChoice: 'analyze_flow', temperature: 0.1, maxCompletionTokens: 1024 },
    );

    const toolCall = result.toolCalls[0];
    if (!toolCall) throw new InternalServerErrorException({ message: 'Groq no llamó al tool analyze_flow.' });

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
    catalogMatch: CatalogPatternMatch | null,
  ): Promise<FlowSkeleton> {
    const prompt = this.buildSkeletonPrompt(name, description, existingSchemas, analysis, reformulationContext, catalogMatch);

    const result = await this.groq.chatWithTools(
      [{ role: 'user', content: prompt }],
      [GENERATE_SKELETON_TOOL],
      { toolChoice: 'generate_skeleton', temperature: 0.2, maxCompletionTokens: 2048 },
    );

    const toolCall = result.toolCalls[0];
    if (!toolCall) throw new InternalServerErrorException({ message: 'Groq no llamó al tool generate_skeleton.' });

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

  // ─── Llamada de cadena: storeNode → insertNode ────────────────────────────

  private async callGenerateChainConfig(
    storeNode: SkeletonNode,
    insertNode: SkeletonNode,
    skeleton: FlowSkeleton,
    existingSchemas: ExistingSchemaContext[],
  ): Promise<{ success: boolean; reformulationReason?: string; storeConfig?: Record<string, any>; insertConfig?: Record<string, any> }> {
    const prompt = this.buildChainConfigPrompt(storeNode, insertNode, skeleton, existingSchemas);

    const result = await this.groq.chatWithTools(
      [{ role: 'user', content: prompt }],
      [GENERATE_CHAIN_CONFIG_TOOL],
      { toolChoice: 'generate_chain_config', temperature: 0.1, maxCompletionTokens: 2048 },
    );

    const toolCall = result.toolCalls[0];
    if (!toolCall) {
      throw new InternalServerErrorException({
        message: `Groq no llamó al tool generate_chain_config para cadena "${storeNode.id}→${insertNode.id}".`,
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

  // ─── Templates de ejemplo ──────────────────────────────────────────────────

  /**
   * Ejemplo de templateList/templateObj Handlebars, con concatenación en
   * lugar de template literal anidado para evitar conflicto de sintaxis
   * entre ${...} (JS) y {{...}} (Handlebars).
   */
  private buildStoreTemplateExample(schema: { name: string; fields: Array<{ name: string }> }): string {
    const schemaName = schema.name;
    const f1 = schema.fields[1]?.name ?? schema.fields[0]?.name ?? 'nombre';
    const f2 = schema.fields[2]?.name;
    const f3 = schema.fields[3]?.name;

    let listLine = '- {{' + schemaName + '.' + f1 + '}}';
    if (f2) listLine += ' de {{' + schemaName + '.' + f2 + '}}';
    if (f3) listLine += ' a ${{' + schemaName + '.' + f3 + '}}';

    const objLine = '{{' + schemaName + '.' + f1 + '}}' + (f2 ? ' — {{' + schemaName + '.' + f2 + '}}' : '');

    const lines = [
      'Ejemplo de templates para "' + schemaName + '":',
      '',
      'templateList (varios documentos):',
      '```',
      'Aquí tienes las opciones disponibles:',
      '{{#each}}',
      listLine,
      '{{/each}}',
      '```',
      '',
      'templateObj (un solo documento):',
      '```',
      'Encontré: ' + objLine,
      '```',
      '',
      'Reglas:',
      '- Dentro de {{#each}}...{{/each}}: {{nombreSchema.campo}}',
      '- templateObj NO usa {{#each}} — {{nombreSchema.campo}} directo.',
      '- Texto estático fuera de las llaves.',
    ];

    return lines.join('\n');
  }

  // ─── Catálogo ──────────────────────────────────────────────────────────────

  /**
   * Resume el runtime del catálogo en texto plano para el prompt.
   * Omite valores de schema (schemas/selectedSchemaId/schemaName) porque
   * son referencias del tenant admin que originó el patrón — solo interesa
   * la ESTRUCTURA y el ROL de cada nodo. "llmDescription" SÍ se conserva:
   * es texto de propósito de negocio, útil como referencia, no un ID.
   */
  private summarizeCatalogRuntime(runtime: any): string {
    const nodes: Record<string, any> = runtime?.nodes ?? {};
    const OMIT_KEYS = new Set(['schemas', 'selectedSchemaId', 'schemaName', 'configHash']);

    const lines = Object.values(nodes).map((n: any) => {
      const next     = n.next?.length ? ` → [${n.next.join(', ')}]` : '';
      const branches = n.branches ? ` branches=${JSON.stringify(n.branches)}` : '';
      const fallback = n.fallback ? ` fallback="${n.fallback}"` : '';

      const cleanedData = Object.fromEntries(
        Object.entries(n.data ?? {}).filter(([k]) => !OMIT_KEYS.has(k)),
      );

      return `- "${n.id}" (${n.type})${next}${branches}${fallback}\n  data: ${JSON.stringify(cleanedData)}`;
    });

    return `startNode: "${runtime?.startNode}"\n${lines.join('\n')}`;
  }

  private buildCatalogSection(catalogMatch: CatalogPatternMatch | null): string {
    if (!catalogMatch) return '';

    const businessContextSection =
      catalogMatch.mapflowDescription || catalogMatch.mapflowMd
        ? `### Por qué y para qué sirve este patrón (contexto de negocio original)
${catalogMatch.mapflowDescription ? `**Descripción:** ${catalogMatch.mapflowDescription}\n` : ''}${
            catalogMatch.mapflowMd ? `**Racional / notas:**\n${catalogMatch.mapflowMd}\n` : ''
          }`
        : '';

    const schemasSection = catalogMatch.catalogSchemas.length
      ? `### Forma de los schemas que usaba el patrón original (solo referencia — NO existen para este cliente)
${catalogMatch.catalogSchemas
  .map(
    (s) =>
      `- "${s.name}" (${s.category})${s.description ? ` — ${s.description}` : ''}\n  Campos: ${s.fields
        .map((f) => `${f.name} (${f.type}${f.required ? ', requerido' : ''})`)
        .join(', ')}`,
  )
  .join('\n')}

Úsalos como GUÍA de qué campos suele necesitar este tipo de negocio — especialmente
útil si el cliente actual NO subió schemas propios. Si el cliente SÍ subió schemas,
prioriza siempre los suyos.`
      : '';

    return `## 📦 PATRÓN DE CATÁLOGO ENCONTRADO (referencia — similitud=${catalogMatch.score.toFixed(2)})

${businessContextSection}
Se encontró un runtime ya construido y validado para un modelo de negocio similar.
Tu tarea NO es copiarlo literalmente, sino:

1. Evaluar si su estructura y su racional de negocio son compatibles con la
   descripción y los schemas de ESTE cliente.
2. Si es compatible: úsalo como base, adaptando nombres de schema a los
   schemas reales de este cliente (existentes o inferidos) — NUNCA reutilices
   literalmente valores de "schemas"/"selectedSchemaId" de este patrón,
   pertenecen a otro cliente y no existen aquí.
3. Si el patrón cubre más o menos de lo que el cliente pidió, ajusta.
4. Si NO es compatible, ignóralo por completo y diseña desde cero.

${schemasSection}

Runtime de referencia (estructura de nodos):
${this.summarizeCatalogRuntime(catalogMatch.runtime)}
`;
  }

  // ─── Prompts ───────────────────────────────────────────────────────────────

  private buildChainConfigPrompt(
    storeNode: SkeletonNode,
    insertNode: SkeletonNode,
    skeleton: FlowSkeleton,
    existingSchemas: ExistingSchemaContext[],
  ): string {
    const allSchemas: Array<{ name: string; fields: Array<{ name: string; type: string }>; isNew: boolean }> = [
      ...existingSchemas.map((s) => ({ name: s.name, fields: s.fields, isNew: false })),
      ...skeleton.inferredSchemas.map((s) => ({ name: s.name, fields: s.fields, isNew: true })),
    ];

    const storeSchema  = allSchemas[0];
    const insertSchema = allSchemas.find((s) => s.name !== storeSchema?.name) ?? storeSchema;

    const storeSchemaSection = storeSchema
      ? `## Schema que el storeNode CONSULTA/CAPTURA
- Nombre: "${storeSchema.name}"
- Campos disponibles: ${storeSchema.fields.map((f) => `${f.name} (${f.type})`).join(', ')}
- Usa este nombre en storeConfig.schemas (array — normalmente un solo elemento).`
      : '## Schema del storeNode\nUsa el schema inferido disponible.';

    const insertSchemaSection = insertSchema
      ? `## Schema de INSERCIÓN (insertNode) — ${insertSchema.isNew ? 'NUEVO, inferido' : 'ya existe en DB'}
- Nombre: "${insertSchema.name}"
- Campos: ${insertSchema.fields.map((f) => `${f.name} (${f.type})`).join(', ')}
- Usa este schema en insertNode.selectedSchemaId y fieldMappings.`
      : '';

    const templateExample = storeSchema ? this.buildStoreTemplateExample(storeSchema) : '';
    const mode = storeNode.storeMode ?? 'inline';

    return `Eres un experto en configuración de flujos conversacionales.

Debes configurar una CADENA ATÓMICA de 2 nodos codependientes.
Es CRÍTICO que los campos sean coherentes entre ambos.

## Flujo completo (referencia)
${skeleton.nodes.map((n) => `${n.id} (${n.type})`).join(' → ')}

## Los 2 nodos a configurar juntos

1. **storeNode** "${storeNode.id}" — busca y captura el/los documento(s) que el usuario selecciona
   - Propósito: ${storeNode.purpose}
   - Modo: ${mode}
   ${mode === 'floating'
     ? '- FLOTANTE: NO lleva next/branches propios. "llmDescription" es CRÍTICO — el motor lo usa para decidir en runtime si un mensaje del usuario aplica a este store.'
     : '- INLINE: ya tiene 2 edges definidos en el skeleton (label "success" y label "empty") — no los repitas aquí, solo configura la data del nodo.'}

2. **insertNode** "${insertNode.id}" — persiste los datos en MongoDB
   - Propósito: ${insertNode.purpose}

${storeSchemaSection}

${insertSchemaSection}

## Reglas de coherencia (OBLIGATORIAS)

1. storeConfig.objectVar es el nombre de la variable en formState (ej: "carrito", "cita_seleccionada").
2. insertConfig.fieldMappings usa "obj:objectVar.campo":
   - Si objectVar="carrito" y el schema capturado tiene campos "nombre","precio" →
     fieldMappings: [{ schemaField: "nombre", source: "obj:carrito.nombre" }, ...]
3. storeConfig.schemas = schema(s) que el store CONSULTA/CAPTURA ("${storeSchema?.name ?? 'schema_consulta'}").
   insertConfig.selectedSchemaId = schema donde se INSERTA ("${insertSchema?.name ?? 'schema_insercion'}").
   Pueden ser el mismo schema (ej. editar directo) o diferentes (ej. producto → pedido).
4. Si search=true, searchOutput es OBLIGATORIO — incluye templateList Y templateObj.

## Formato de los templates (Handlebars)

${templateExample}

## Regla crítica de config
NUNCA incluyas el campo "type" con el nombre del tipo de nodo dentro de ningún config.

Llama al tool generate_chain_config con la configuración completa de los 2 nodos.`;
  }

  private buildAnalysisPrompt(
    name: string,
    description: string,
    existingSchemas: ExistingSchemaContext[],
    catalogMatch: CatalogPatternMatch | null,
  ): string {
    const schemaSection = existingSchemas.length
      ? `## Schemas existentes del cliente (YA EXISTEN en la base de datos)
${existingSchemas.map((s) =>
  `- Nombre: "${s.name}" | Categoría: ${s.category}${s.description ? ` | Descripción: ${s.description}` : ''}
  Campos: ${s.fields.map((f) => `${f.name} (${f.type}${f.required ? ', requerido' : ''})`).join(', ')}`
).join('\n')}`
      : '## Schemas existentes\nEl cliente no proporcionó schemas.';

    const catalogSection = this.buildCatalogSection(catalogMatch);

    return `Eres un analista de flujos conversacionales para chatbots de negocio.

Tu tarea es entender qué schemas tiene el negocio, clasificar su rol, e identificar qué schemas adicionales necesita el flujo.

## Flujo a analizar
- Nombre: ${name}
- Descripción: ${description}

${schemaSection}

${catalogSection}

## Cómo clasificar cada schema existente

**coversQuery = true** si el schema tiene datos que el flujo necesita MOSTRAR/CAPTURAR (storeNode).
**coversInsertion = true** si el schema es el destino donde el flujo INSERTA nuevos registros (insertNode).
- REGLA CRÍTICA: un schema de inventario/productos/catálogo NUNCA cubre inserción de pedidos.

## Cómo identificar schemas faltantes

- Si el flujo inserta pedidos y no hay schema con coversInsertion=true → missingSchemas: ["pedidos"]
- Si el flujo muestra un catálogo y hay un schema con coversQuery=true → NO hace falta uno nuevo
- Si el cliente no subió ningún schema y el flujo necesita datos → infiere todos los necesarios

## Ejemplos de razonamiento correcto

Caso 1: Cliente sube "inventario_farmaceutico", flujo de ventas con pedidos
→ existingSchemaRoles: [{ name: "inventario_farmaceutico", coversQuery: true, coversInsertion: false }]
→ missingSchemas: ["pedidos"]

Caso 2: Cliente sube "inventario" y "pedidos", flujo de ventas
→ existingSchemaRoles: [
    { name: "inventario", coversQuery: true, coversInsertion: false },
    { name: "pedidos", coversQuery: false, coversInsertion: true }
  ]
→ missingSchemas: []

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
    catalogMatch: CatalogPatternMatch | null,
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
→ Cualquier storeNode o insertNode que maneje estos datos DEBE referenciar el nombre exacto del schema.
→ inferredSchemas SOLO puede contener schemas para datos que NINGUNO de los schemas anteriores cubre.
→ Roles confirmados por el análisis:
${analysis.existingSchemaRoles.map((r) =>
  `  • "${r.name}": consulta=${r.coversQuery ? 'SÍ' : 'NO'}, inserción=${r.coversInsertion ? 'SÍ' : 'NO'}`
).join('\n')}
${analysis.missingSchemas.length ? `→ Schemas adicionales a inferir: ${analysis.missingSchemas.join(', ')}` : '→ No se necesitan schemas adicionales'}.`
      : `## Schemas
El cliente no proporcionó schemas. Infiere los necesarios en inferredSchemas.
El análisis sugiere: ${analysis.missingSchemas.length ? analysis.missingSchemas.join(', ') : 'decide según la descripción'}.`;

    const analysisSection = `## Análisis previo del flujo
${analysis.reasoning}

Conclusiones:
- ¿Necesita mostrar/capturar opciones? → ${analysis.requiresSelection ? 'SÍ (incluir storeNode con search=true)' : 'NO'}
- ¿Necesita insertar datos? → ${analysis.requiresInsertion ? 'SÍ (incluir insertNode, y confirmationNode si la acción amerita confirmar)' : 'NO'}
- ¿Tiene bifurcaciones de intención? → ${analysis.requiresIntent ? 'SÍ (incluir intentNode)' : 'NO'}`;

    const catalogSection = this.buildCatalogSection(catalogMatch);

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

${catalogSection}

${NODE_SEMANTIC_DESCRIPTIONS}

${reformulationSection}

## Instrucciones finales
1. Flujo mínimo que cumpla la descripción — sin nodos innecesarios, salvo que el
   patrón de catálogo (si aplica y es compatible) justifique nodos adicionales.
2. IDs semánticos: "node_saludo", "node_mostrar_productos", "node_store_carrito".
3. Para cada storeNode define "storeMode" explícitamente ("inline" o "floating").
4. Si un storeNode es "floating", DEBES declarar en algún otro nodo "initStores": ["<id_del_store>"]
   para activarlo, y opcionalmente "finishStores" en el nodo donde deba desactivarse.
5. El orden cuando hay selección e inserción: storeNode(inline) → [confirmationNode] → insertNode.
6. confirmationNode, cuando exista, genera EXACTAMENTE 2 edges: label "yes" → insertNode, label "no" → nodo anterior.
7. En inferredSchemas usa nombres de schema (sin IDs — aún no existen).

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

    const schemasRef: string[] = [];
    existingSchemas.forEach((s) => {
      schemasRef.push(`- "${s.name}" (EXISTENTE en DB, ID: "${s.id}") — campos: ${s.fields.map((f) => f.name).join(', ')}`);
    });
    skeleton.inferredSchemas.forEach((s) => {
      schemasRef.push(`- "${s.name}" (NUEVO — sin ID aún, referenciar por nombre) — campos: ${s.fields.map((f) => f.name).join(', ')}`);
    });

    const schemasSection = schemasRef.length ? `## Schemas disponibles\n${schemasRef.join('\n')}` : '';

    const previousSection = previous
      ? `## Nodo anterior\n- ID: "${previous.id}" | Tipo: ${previous.type}\n- Propósito: "${previous.purpose}"`
      : '## Nodo anterior\nEste es el primer nodo del flujo.';

    const dependencySection = this.buildDependencyContext(current, skeleton);
    const lifecycleSection  = this.buildLifecycleSection(current, skeleton);

    const outgoing = skeleton.edges.filter((e) => e.source === current.id);
    const edgesSection = outgoing.length
      ? `## Edges salientes\n${outgoing.map((e) => `- → "${e.target}"${e.label ? ` (branch: "${e.label}")` : ''}`).join('\n')}`
      : '## Edges\nNodo terminal.';

    const templateGuidance = current.type === 'storeNode' && !this.hasChainPartner(current, skeleton)
      ? `\n## Formato de templates (Handlebars)\n${this.buildStoreTemplateExampleFromSkeleton(current, skeleton, existingSchemas)}\n`
      : '';

    return `Eres un experto en configuración de flujos conversacionales.

## Flujo completo
${skeleton.nodes.map((n) => `${n.id} (${n.type})`).join(' → ')}

${previousSection}

## Nodo actual: "${current.id}" (${current.type})
- Propósito: "${current.purpose}"
${current.storeMode ? `- storeMode: "${current.storeMode}"` : ''}

${edgesSection}

${dependencySection}

${lifecycleSection}

${schemasSection}
${templateGuidance}
## Interfaces TypeScript
${interfacesSection}

## Regla crítica de config
NUNCA incluyas el campo "type" con el nombre del tipo de nodo dentro de config.
NUNCA incluyas "initStores"/"finishStores" en tu respuesta — se inyectan automáticamente después. Concéntrate solo en el resto de la data.
Ejemplo INCORRECTO: config: { "type": "confirmationNode", "label": "..." }
Ejemplo CORRECTO:   config: { "label": "..." }

## Instrucciones
1. Genera la config completa del nodo "${current.id}" según su interfaz TypeScript.
2. Para schemas: usa el nombre exacto del schema (los IDs se asignan al confirmar).
3. Si detectas incongruencia estructural → success: false con reformulationReason claro.
4. Si todo es coherente → success: true con config completa.

Llama al tool generate_node_config.`;
  }

  /** true si este storeNode va a ser (o ya fue) configurado como parte de una cadena store→insert. */
  private hasChainPartner(current: SkeletonNode, skeleton: FlowSkeleton): boolean {
    const idx = skeleton.nodes.findIndex((n) => n.id === current.id);
    return skeleton.nodes.some((n, i) => n.type === 'insertNode' && i > idx);
  }

  private buildStoreTemplateExampleFromSkeleton(
    current: SkeletonNode,
    skeleton: FlowSkeleton,
    existingSchemas: ExistingSchemaContext[],
  ): string {
    const allSchemas = [...existingSchemas, ...skeleton.inferredSchemas];
    const schema = allSchemas[0];
    if (!schema) return '';
    return this.buildStoreTemplateExample(schema);
  }

  private buildLifecycleSection(current: SkeletonNode, skeleton: FlowSkeleton): string {
    const parts: string[] = [];

    if (current.initStores?.length) {
      const stores = current.initStores.map((id) => skeleton.nodes.find((n) => n.id === id)).filter(Boolean) as SkeletonNode[];
      if (stores.length) {
        parts.push(
          `Este nodo ACTIVA los siguientes stores globales al ejecutarse (se inyecta automáticamente ` +
          `en "initStores" — NO lo repitas en tu config, pero ten en cuenta su propósito al redactar mensajes):\n` +
          stores.map((s) => `- "${s.id}": ${s.purpose}`).join('\n'),
        );
      }
    }

    if (current.finishStores?.length) {
      const stores = current.finishStores.map((id) => skeleton.nodes.find((n) => n.id === id)).filter(Boolean) as SkeletonNode[];
      if (stores.length) {
        parts.push(
          `Este nodo DESACTIVA los siguientes stores globales al ejecutarse (se inyecta automáticamente en "finishStores"):\n` +
          stores.map((s) => `- "${s.id}": ${s.purpose}`).join('\n'),
        );
      }
    }

    return parts.length ? `## Ciclo de vida de stores globales\n${parts.join('\n\n')}` : '';
  }

  // ─── Contexto de dependencias ─────────────────────────────────────────────

  private buildDependencyContext(current: SkeletonNode, skeleton: FlowSkeleton): string {
    const nodeIndex = skeleton.nodes.findIndex((n) => n.id === current.id);
    const priorNodes = skeleton.nodes.slice(0, nodeIndex);

    switch (current.type) {
      case 'storeNode': {
        const mode = current.storeMode ?? 'inline';
        return mode === 'floating'
          ? '## Modo\nEste storeNode es FLOTANTE — NO debe llevar next ni branches propios. Se activa/desactiva desde "initStores"/"finishStores" de otros nodos.'
          : '## Modo\nEste storeNode es INLINE — ya tiene definidos en el skeleton exactamente 2 edges salientes: label "success" y label "empty".';
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
        const targets = priorNodes.map((n) => `- ID: "${n.id}" | Tipo: ${n.type} | Propósito: "${n.purpose}"`);
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
        throw new InternalServerErrorException({ message: `Edge con source "${edge.source}" no existe.` });
      }
      if (!nodeIds.has(edge.target)) {
        throw new InternalServerErrorException({ message: `Edge con target "${edge.target}" no existe.` });
      }
    }

    const LINEAR_TYPES: NodeType[] = ['conversationNode', 'insertNode', 'inputNode', 'goToNode'];
    for (const edge of skeleton.edges) {
      if (edge.label) {
        const sourceNode = skeleton.nodes.find((n) => n.id === edge.source);
        if (sourceNode && LINEAR_TYPES.includes(sourceNode.type)) {
          throw new InternalServerErrorException({
            message:
              `El edge de "${edge.source}" (${sourceNode.type}) no debe tener label "${edge.label}". ` +
              `Solo intentNode, confirmationNode y storeNode (inline) generan edges con label.`,
          });
        }
      }
    }

    for (const node of skeleton.nodes) {
      if (node.type === 'storeNode') {
        const mode = node.storeMode ?? 'inline';
        const outgoing = skeleton.edges.filter((e) => e.source === node.id);
        const incoming = skeleton.edges.filter((e) => e.target === node.id);

        if (mode === 'floating') {
          if (outgoing.length || incoming.length) {
            throw new InternalServerErrorException({
              message: `storeNode "${node.id}" es floating y no debe tener edges (encontrados: ${outgoing.length + incoming.length}).`,
            });
          }
        } else {
          const hasSuccess = outgoing.some((e) => e.label === 'success');
          const hasEmpty   = outgoing.some((e) => e.label === 'empty');
          if (!hasSuccess || !hasEmpty) {
            throw new InternalServerErrorException({
              message: `storeNode "${node.id}" (inline) debe tener exactamente 2 edges: label "success" y label "empty". Encontrado: ${outgoing.map((e) => e.label).join(', ')}.`,
            });
          }
        }
      }

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

    // initStores/finishStores deben apuntar a storeNode floating existentes
    for (const node of skeleton.nodes) {
      for (const storeId of [...(node.initStores ?? []), ...(node.finishStores ?? [])]) {
        const target = skeleton.nodes.find((n) => n.id === storeId);
        if (!target || target.type !== 'storeNode' || (target.storeMode ?? 'inline') !== 'floating') {
          throw new InternalServerErrorException({
            message: `Nodo "${node.id}" referencia storeNodeId="${storeId}" en initStores/finishStores pero no es un storeNode floating válido.`,
          });
        }
      }
    }
  }
}