import {
  IsString, IsArray, ValidateNested, IsOptional, IsEnum, IsNumber,
  IsBoolean, IsObject, IsNotEmpty, ArrayMinSize, ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  NodeType, ConversationNodeData, InputNodeData, FallbackNodeData,
  IntentNodeData, RouterNodeData, ConfirmationNodeData, GoToNodeData,
  FormField, RouterCondition, Intent, ApiNodeData, BodyField,
  InsertNodeData, FieldMapping, GlobalCriteria,
  StoreLinkedNode,
} from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Primitivos compartidos
// ─────────────────────────────────────────────────────────────────────────────

class FormFieldDto implements FormField {
  @IsString() name: string;
  @IsString() type: string;
}

class PositionDto {
  @IsNumber() x: number;
  @IsNumber() y: number;
}

class MeasuredDto {
  @IsNumber() width: number;
  @IsNumber() height: number;
}

class GlobalCriteriaDto implements GlobalCriteria {
  @IsString() scheme: string;
  @IsString() column: string;
  @IsString() condition: string;
  @IsString() value: string;

  @IsEnum(['form', 'static'])
  valueSource: 'form' | 'static';
}

export class StoreLifecycleHooksDto {
  @IsOptional() @IsArray() @IsString({ each: true }) initStores?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) finishStores?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Node Data DTOs
// ─────────────────────────────────────────────────────────────────────────────

class ConversationNodeDataDto extends StoreLifecycleHooksDto implements ConversationNodeData {
  @IsString() label: string;

  @IsEnum(['start', 'message', 'question', 'condition', 'end'])
  type: 'start' | 'message' | 'question' | 'condition' | 'end';

  @IsOptional() @IsEnum(['template', 'ia']) mode?: 'template' | 'ia';
  @IsString() message: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  @Transform(({ value }) => value ?? undefined)
  availableFormFields?: FormFieldDto[];
}

class InputNodeDataDto extends StoreLifecycleHooksDto implements InputNodeData {
  @IsString() label: string;
  @IsString() fieldName: string;

  @IsEnum(['text', 'number', 'date', 'select'])
  fieldType: 'text' | 'number' | 'date' | 'select';

  @IsString() description: string;

  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
  @IsOptional() @IsBoolean() implicit?: boolean;
}

class FallbackNodeDataDto extends StoreLifecycleHooksDto implements FallbackNodeData {
  @IsString() label: string;
  @IsString() message: string;
}

class IntentDto implements Intent {
  @IsString() id: string;
  @IsString() label: string;
  @IsString() description: string;
  @IsOptional() @IsString() examples?: string;
}

class IntentNodeDataDto extends StoreLifecycleHooksDto implements IntentNodeData {
  @IsString() label: string;
  @IsString() contextPrompt: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => IntentDto)
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

class RouterNodeDataDto extends StoreLifecycleHooksDto implements RouterNodeData {
  @IsString() label: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => RouterConditionDto)
  conditions: RouterConditionDto[];

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => FormFieldDto)
  availableFormFields: FormFieldDto[];
}

class SummaryFieldDto {
  @IsString() fieldName: string;
  @IsString() displayLabel: string;
}

class ConfirmationNodeDataDto extends StoreLifecycleHooksDto implements ConfirmationNodeData {
  @IsString() label: string;
  @IsString() confirmationMessage: string;
  @IsString() positiveLabel: string;
  @IsString() negativeLabel: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => SummaryFieldDto)
  summaryFields: SummaryFieldDto[];

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => FormFieldDto)
  availableFormFields: FormFieldDto[];
}

class GoToNodeDataDto implements GoToNodeData {
  @IsString() label: string;
  @IsString() targetNodeId: string;
  @IsString() targetNodeLabel: string;
  @IsString() reason: string;

  @IsOptional() @IsArray() @IsString({ each: true }) clearFields?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// StoreNode — absorbe lo que hacía OutputNode
// ─────────────────────────────────────────────────────────────────────────────


class StoreLinkedNodeDto implements StoreLinkedNode {
  @IsString() id: string;
  @IsString() label: string;
}

export class StorePermissionsDto {
  @IsBoolean() create: boolean;
  @IsBoolean() show: boolean;
  @IsBoolean() delete: boolean;
  @IsBoolean() update: boolean;
}

export class StoreSearchOutputDto {
  @IsBoolean() searchFeedback: boolean;
  @IsOptional() @IsString() templateList?: string;
  @IsOptional() @IsString() templateObj?: string;
  @IsOptional() @IsBoolean() emptyFallbackEnabled?: boolean;
  @IsOptional() @IsString() emptyFallbackMessage?: string;
  @IsOptional() @IsNumber() pageSize?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GlobalCriteriaDto)
  globalCriteria?: GlobalCriteriaDto[];
}

export class StoreNodeDataDto {
  @IsString() @IsNotEmpty() nodeId: string;
  @IsString() @IsNotEmpty() objectVar: string;

  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  schemas: string[];

  @IsBoolean() isArray: boolean;

  @ValidateNested() @Type(() => StorePermissionsDto)
  storePermissions: StorePermissionsDto;

  @IsBoolean() search: boolean;

  @IsOptional()
  @ValidateIf((o) => o.search === true)
  @ValidateNested()
  @Type(() => StoreSearchOutputDto)
  searchOutput?: StoreSearchOutputDto;

  @IsBoolean() feedbackVisible: boolean;
  @IsOptional() @IsString() feedbackMessage?: string;

  // generados por StoreEnrichmentService — round-trip, no editable a mano
  @IsOptional() @IsString() llmDescription?: string;
  @IsOptional() @IsString() configHash?: string;

  @IsOptional() @IsString() operatorNotes?: string;
   // ── antes: string[] con @IsString({each:true}) — no coincidía con lo
  // que manda el front (objetos {id,label} para pintar los chips en UI).
  // El runtime nunca lee esto (solo lee initStores/finishStores en los
  // nodos referenciados), así que basta con validar la forma, sin
  // convertir nada.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoreLinkedNodeDto)
  initNodes?: StoreLinkedNodeDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoreLinkedNodeDto)
  finishNodes?: StoreLinkedNodeDto[];

  @IsOptional() @IsString() label?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Union para data
// ─────────────────────────────────────────────────────────────────────────────

type NodeDataDtoUnion =
  | ConversationNodeDataDto
  | InputNodeDataDto
  | FallbackNodeDataDto
  | IntentNodeDataDto
  | RouterNodeDataDto
  | ConfirmationNodeDataDto
  | GoToNodeDataDto
  | InsertNodeDataDto
  | ApiNodeDataDto
  | StoreNodeDataDto;

function resolveDataDto(nodeType: NodeType) {
  switch (nodeType) {
    case 'conversationNode':  return ConversationNodeDataDto;
    case 'inputNode':         return InputNodeDataDto;
    case 'fallbackNode':      return FallbackNodeDataDto;
    case 'intentNode':        return IntentNodeDataDto;
    case 'routerNode':        return RouterNodeDataDto;
    case 'confirmationNode':  return ConfirmationNodeDataDto;
    case 'goToNode':          return GoToNodeDataDto;
    case 'insertNode':        return InsertNodeDataDto;
    case 'apiNode':           return ApiNodeDataDto;
    case 'storeNode':         return StoreNodeDataDto;
    default:                  return ConversationNodeDataDto;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NodeDto (UI persistence)
// ─────────────────────────────────────────────────────────────────────────────

const NODE_TYPES: NodeType[] = [
  'conversationNode', 'intentNode', 'inputNode',
  'fallbackNode', 'routerNode', 'confirmationNode', 'goToNode',
  'insertNode', 'apiNode', 'storeNode',
];

class NodeDto {
  @IsString() id: string;

  @IsEnum(NODE_TYPES)
  type: NodeType;

  @ValidateNested() @Type(() => PositionDto)
  position: PositionDto;

  @ValidateNested()
  @Type((options) => resolveDataDto((options?.newObject as NodeDto)?.type))
  data: NodeDataDtoUnion;

  @IsOptional() @ValidateNested() @Type(() => MeasuredDto)
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

  @IsOptional() @IsString() sourceHandle?: string;

  @IsEnum(['default', 'fallback', 'jump'])
  type: 'default' | 'fallback' | 'jump';

  @IsOptional() @IsObject() data?: Record<string, any>;
  @IsOptional() @IsObject() style?: Record<string, any>;
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

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => MappedNode2Dto)
  next?: MappedNode2Dto[];

  @IsOptional() @IsObject()
  branches?: Record<string, MappedNode2Dto>;

  @IsOptional() @ValidateNested() @Type(() => MappedNode2Dto)
  fallback?: MappedNode2Dto;
}

// ─────────────────────────────────────────────────────────────────────────────
// CreateMapflowDto
// ─────────────────────────────────────────────────────────────────────────────

export class CreateMapflowDto {
  @IsString() name: string;

  @IsArray() @IsString({ each: true })
  selectedSchemas: string[];

  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() md?: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => FormFieldDto)
  formFields: FormFieldDto[];

  @IsArray() @ValidateNested({ each: true }) @Type(() => NodeDto)
  nodes: NodeDto[];

  @IsArray() @ValidateNested({ each: true }) @Type(() => EdgeDto)
  edges: EdgeDto[];

  @IsArray() @ValidateNested({ each: true }) @Type(() => MappedNode2Dto)
  map: MappedNode2Dto[];
}

// ── InsertNode / ApiNode ─────────────────────────────────────────────────

class FieldMappingDto implements FieldMapping {
  @IsString() schemaField: string;
  @IsNotEmpty() @IsString() source: string;
}

class InsertNodeDataDto extends StoreLifecycleHooksDto implements InsertNodeData {
  @IsString() label: string;
  @IsString() selectedSchemaId: string;
  @IsString() schemaName: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => FieldMappingDto)
  fieldMappings: FieldMappingDto[];

  @IsOptional() @IsBoolean() outputEnabled?: boolean;
  @IsOptional() @IsString() outputTemplate?: string;

  @IsOptional() @IsArray() availableSchemas?: any[];
  @IsOptional() @IsArray() availableFormFields?: any[];
  @IsOptional() @IsArray() availableFormObjects?: any[];
}

class BodyFieldDto implements BodyField {
  @IsString() id: string;
  @IsString() fieldName: string;

  @IsEnum(['string', 'number', 'boolean', 'date'])
  fieldType: 'string' | 'number' | 'boolean' | 'date';

  @IsString() source: string;
}

class ApiNodeDataDto extends StoreLifecycleHooksDto implements ApiNodeData {
  @IsString() label: string;
  @IsString() url: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => BodyFieldDto)
  bodyFields: BodyFieldDto[];

  @IsOptional() @IsString() responseVar?: string;
}