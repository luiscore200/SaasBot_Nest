export interface CreateMapflowPayload {
  name: string;
  selectedSchemas: string[];
  formFields: Array<{ name: string; type: string }>;
  nodes:node[];
  edges:Edge[];
  map:MappedNode2[];
}



export  type NodeData =
    | InputNodeData
    | ConversationNodeData
    | OutputNodeData
    | FallbackNodeData;

export  type MappedNode2 = any & {
        data: NodeData;
        next?: MappedNode2[];
      };



// ===== COMMON INTERFACES =====

export interface FormField {
  name: string;
  type: string;
}

export interface SchemaInfo {
  id: string;
  name: string;
  attributes: Array<{ 
    id: string; 
    name: string; 
    type: string 
  }>;
}

// ===== CONVERSATION NODE =====

export interface ConversationNodeData {
  label: string;
  type: "start" | "message" | "question" | "condition" | "end";
  mode?: "template" | "ia";
  message: string;
  onConfigChange?: (config: any) => void;
  onRemove?: (nodeId: string) => void;
}


// ===== INPUT NODE =====

export interface InputNodeData {
  label: string;
  fieldName: string;
  fieldType: "text" | "number" | "date" | "select";
  description: string;
  options?: string[];
  onConfigChange: (config: any) => void;
  onRemove: (nodeId: string) => void;
}


// ===== FALLBACK NODE =====

export interface FallbackNodeData {
  label: string;
  message: string;
  onConfigChange: (config: any) => void;
  onRemove: (nodeId: string) => void;
}



// ===== OUTPUT NODE =====

export interface SchemeObject {
  id: string;
  selectedSchema: string;
  selectedFields: string[];
}

export interface GlobalCriteria {
  scheme: string;
  column: string;
  condition: string;
  value: string;
  valueSource: 'form' | 'static';
}

export interface OutputNodeData {
  label: string;
  schemes: SchemeObject[];
  globalCriteria: GlobalCriteria[];
  outputTemplate?: string;
  templateMode: 'raw' | 'template';
  availableSchemas: SchemaInfo[];
  availableFormFields: FormField[];
  onConfigChange: (config: any) => void;
  onRemove: (nodeId: string) => void;
}


interface Position {
  x: number;
  y: number;
}

// Medidas de un nodo
interface Measured {
  width: number;
  height: number;
}

// Nodo genérico
interface node {
  id: string;
  type: NodeType;
  position: Position;
  data: NodeData;
  measured: Measured;
  selected?: boolean;
}

type NodeType = "conversationNode" | "outputNode"| "inputNode" | "fallbackNode";

// Edge (conexión entre nodos)
interface Edge {
  id: string;
  source: string; // id del nodo origen
  target: string; // id del nodo destino
  type: "default" | "custom";
  style?: Record<string, any>;
}