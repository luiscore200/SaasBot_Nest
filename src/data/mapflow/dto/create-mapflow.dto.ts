import {
  IsString,
  IsArray,
  ValidateNested,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsObject,
  IsNotEmpty,
  ArrayMinSize,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  NodeType,
  ConversationNodeData,
  InputNodeData,
  FallbackNodeData,
  OutputNodeData,
  IntentNodeData,
  RouterNodeData,
  ConfirmationNodeData,
  GoToNodeData,
  FormField,
  SchemaInfo,
  SchemeObject,
  GlobalCriteria,
  RouterCondition,
  Intent,
  ApiNodeData,
  BodyField,
  InsertNodeData,
  FieldMapping,
} from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Primitivos compartidos
// ─────────────────────────────────────────────────────────────────────────────

class FormFieldDto implements FormField {
  @IsString() name: string;
  @IsString() type: string;
}

class SchemaAttributeDto {
  @IsString() id: string;
  @IsString() name: string;
  @IsString() type: string;
}

class SchemaInfoDto implements SchemaInfo {
  @IsString() id: string;
  @IsString() name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SchemaAttributeDto)
  attributes: SchemaAttributeDto[];
}

class SchemeObjectDto implements SchemeObject {
  @IsString() id: string;
  @IsString() selectedSchema: string;

  @IsArray()
  @IsString({ each: true })
  selectedFields: string[];

  @IsString()
  schemaName: string;
}

class GlobalCriteriaDto implements GlobalCriteria {
  @IsString() scheme: string;
  @IsString() column: string;
  @IsString() condition: string;
  @IsString() value: string;

  @IsEnum(['form', 'static'])
  valueSource: 'form' | 'static';
}

class PositionDto {
  @IsNumber() x: number;
  @IsNumber() y: number;
}

class MeasuredDto {
  @IsNumber() width: number;
  @IsNumber() height: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Node Data DTOs
// ─────────────────────────────────────────────────────────────────────────────

class ConversationNodeDataDto implements ConversationNodeData {
  @IsString() label: string;

  @IsEnum(['start', 'message', 'question', 'condition', 'end'])
  type: 'start' | 'message' | 'question' | 'condition' | 'end';

  @IsOptional()
  @IsEnum(['template', 'ia'])
  mode?: 'template' | 'ia';

  @IsString() message: string;

 @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  @Transform(({ value }) => value ?? undefined)  // null → undefined → @IsOptional lo ignora
  availableFormFields?: FormFieldDto[];
}

class InputNodeDataDto implements InputNodeData {
  @IsString() label: string;
  @IsString() fieldName: string;
 
  @IsEnum(['text', 'number', 'date', 'select'])
  fieldType: 'text' | 'number' | 'date' | 'select';
 
  @IsString() description: string;
 
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];
 
  @IsOptional() @IsBoolean() implicit?: boolean;
}
 

class FallbackNodeDataDto implements FallbackNodeData {
  @IsString() label: string;
  @IsString() message: string;
}

class OutputNodeDataDto implements OutputNodeData {
  @IsString() label: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SchemeObjectDto)
  schemes: SchemeObjectDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GlobalCriteriaDto)
  globalCriteria: GlobalCriteriaDto[];

  @IsOptional()
  @IsString()
  outputTemplate?: string;

    @IsOptional()
  @IsBoolean()
   outputVisible?: boolean;

  @IsEnum(['message', 'list', 'raw'])
  templateMode: 'message' | 'list' | 'raw';

  @IsOptional()
  @IsBoolean()
  emptyFallbackEnabled?: boolean;

  @IsOptional()
  @IsString()
  emptyFallbackMessage?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SchemaInfoDto)
  availableSchemas?: SchemaInfoDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  availableFormFields?: FormFieldDto[];
}

class IntentDto implements Intent {
  @IsString() id: string;
  @IsString() label: string;
  @IsString() description: string;

  @IsOptional()
  @IsString()
  examples?: string;
}

class IntentNodeDataDto implements IntentNodeData {
  @IsString() label: string;
  @IsString() contextPrompt: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IntentDto)
  intents: IntentDto[];

  @IsEnum(['fallback_node', 'retry', 'goto_start'])
  fallbackBehavior: 'fallback_node' | 'retry' | 'goto_start';

  @IsNumber() maxRetries: number;
}

class RouterConditionDto implements RouterCondition {
  @IsString() field: string;
  @IsString() operator: string;
  @IsString() value: string;
}

class RouterNodeDataDto implements RouterNodeData {
  @IsString() label: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RouterConditionDto)
  conditions: RouterConditionDto[];

    @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  availableFormFields: FormFieldDto[];
}

class SummaryFieldDto {
  @IsString() fieldName: string;
  @IsString() displayLabel: string;
}

class ConfirmationNodeDataDto implements ConfirmationNodeData {
  @IsString() label: string;
  @IsString() confirmationMessage: string;
  @IsString() positiveLabel: string;
  @IsString() negativeLabel: string;


  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SummaryFieldDto)
  summaryFields: SummaryFieldDto[];

    @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  availableFormFields: FormFieldDto[];
}

class GoToNodeDataDto implements GoToNodeData {
  @IsString() label: string;
  @IsString() targetNodeId: string;
  @IsString() targetNodeLabel: string;
  @IsString() reason: string;
}


export enum StorePermission {
  INSERT = 'insert',
  EDIT   = 'edit',
  DELETE = 'delete',
  SHOW   = 'show',
}

export class StoreNodeDto {
  @IsString()
  @IsNotEmpty()
  nodeId: string;
 
  @IsString()
  @IsNotEmpty()
  objectVar: string;
 

  @IsString()
  @IsNotEmpty()
  extractFromNodeId: string;
 

  @IsBoolean()
  isArray: boolean;
 
  @IsBoolean()
  isGlobal: boolean;
 
  @IsOptional()
  @IsString()
  closeNodeId?: string;
 

  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(StorePermission, { each: true })
  permissions: StorePermission[];
 

  @IsBoolean()
  feedbackVisible: boolean;
 
  
  @IsOptional()
  @IsString()
  feedbackMessage?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Union para data
// ─────────────────────────────────────────────────────────────────────────────

type NodeDataDtoUnion =
  | ConversationNodeDataDto
  | InputNodeDataDto
  | OutputNodeDataDto
  | FallbackNodeDataDto
  | IntentNodeDataDto
  | RouterNodeDataDto
  | ConfirmationNodeDataDto
  | GoToNodeDataDto;

function resolveDataDto(nodeType: NodeType) {
  switch (nodeType) {
    case 'conversationNode':  return ConversationNodeDataDto;
    case 'inputNode':         return InputNodeDataDto;
    case 'outputNode':        return OutputNodeDataDto;
    case 'fallbackNode':      return FallbackNodeDataDto;
    case 'intentNode':        return IntentNodeDataDto;
    case 'routerNode':        return RouterNodeDataDto;
    case 'confirmationNode':  return ConfirmationNodeDataDto;
    case 'goToNode':          return GoToNodeDataDto;
    case 'insertNode':        return InsertNodeDataDto;  // ← nuevo
    case 'apiNode':           return ApiNodeDataDto;     // ← nuevo
    default:                  return ConversationNodeDataDto;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NodeDto (UI persistence)
// ─────────────────────────────────────────────────────────────────────────────

const NODE_TYPES: NodeType[] = [
  'conversationNode', 'intentNode', 'inputNode', 'outputNode',
  'fallbackNode', 'routerNode', 'confirmationNode', 'goToNode',
  'insertNode', 'apiNode',   // ← nuevo
];
class NodeDto {
  @IsString() id: string;

  @IsEnum(NODE_TYPES)
  type: NodeType;

  @ValidateNested()
  @Type(() => PositionDto)
  position: PositionDto;

  @ValidateNested()
  @Type((options) => resolveDataDto((options?.newObject as NodeDto)?.type))
  data: NodeDataDtoUnion;

  @IsOptional()
  @ValidateNested()
  @Type(() => MeasuredDto)
  measured?: MeasuredDto;

  @IsOptional() @IsBoolean() selected?: boolean;
  @IsOptional() @IsBoolean() dragging?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// EdgeDto
// ─────────────────────────────────────────────────────────────────────────────

class EdgeDto {
  @IsString() id: string;
  @IsString() source: string;
  @IsString() target: string;

  @IsOptional()
  @IsString()
  sourceHandle?: string;

  @IsEnum(['default', 'fallback', 'jump'])
  type: 'default' | 'fallback' | 'jump';

  @IsOptional()
  @IsObject()
  data?: Record<string, any>;

  @IsOptional()
  @IsObject()
  style?: Record<string, any>;
}

// ─────────────────────────────────────────────────────────────────────────────
// MappedNode2Dto — árbol recursivo
// ─────────────────────────────────────────────────────────────────────────────

class MappedNode2Dto {
  @IsString() id: string;

  @IsEnum(NODE_TYPES)
  type: NodeType;

  @ValidateNested()
  @Type((options) => resolveDataDto((options?.newObject as MappedNode2Dto)?.type))
  data: NodeDataDtoUnion;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MappedNode2Dto)
  next?: MappedNode2Dto[];

  // class-validator no soporta ValidateNested en Records dinámicos;
  // la validación profunda de branches se delega a buildFlowRuntime.
  @IsOptional()
  @IsObject()
  branches?: Record<string, MappedNode2Dto>;

  @IsOptional()
  @ValidateNested()
  @Type(() => MappedNode2Dto)
  fallback?: MappedNode2Dto;
}

// ─────────────────────────────────────────────────────────────────────────────
// CreateMapflowDto
// ─────────────────────────────────────────────────────────────────────────────

export class CreateMapflowDto {
  @IsString()
  name: string;

  @IsArray()
  @IsString({ each: true })
  selectedSchemas: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  formFields: FormFieldDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NodeDto)
  nodes: NodeDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EdgeDto)
  edges: EdgeDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MappedNode2Dto)
  map: MappedNode2Dto[];
}


// ── Nuevos DTOs de datos ──────────────────────────────────────────────────

class FieldMappingDto implements FieldMapping {
  @IsString() schemaField: string;

  @IsNotEmpty()
  @IsString() source: string;
}

class InsertNodeDataDto implements InsertNodeData {
  @IsString() label: string;
  @IsString() selectedSchemaId: string;
  @IsString() schemaName: string;   

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldMappingDto)
  fieldMappings: FieldMappingDto[];

  @IsOptional() @IsBoolean() outputEnabled?: boolean;  // ← nuevo
  @IsOptional() @IsString()  outputTemplate?: string;  // ← nuevo

    // ← campos UI que el frontend manda pero el engine no usa
  @IsOptional() @IsArray() availableSchemas?: any[];
  @IsOptional() @IsArray() availableFormFields?: any[];
  @IsOptional() @IsArray() availableFormObjects?: any[];
}

class BodyFieldDto implements BodyField {
  @IsString() id: string;
  @IsString() fieldName: string;

  @IsEnum(["string", "number", "boolean", "date"])
  fieldType: "string" | "number" | "boolean" | "date";

  @IsString() source: string;
}

class ApiNodeDataDto implements ApiNodeData {
  @IsString() label: string;
  @IsString() url: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BodyFieldDto)
  bodyFields: BodyFieldDto[];

  @IsOptional()
  @IsString()
  responseVar?: string;
}