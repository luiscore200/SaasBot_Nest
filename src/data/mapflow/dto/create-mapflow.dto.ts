import {
  IsString,
  IsArray,
  ValidateNested,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  NodeType,
  ConversationNodeData,
  InputNodeData,
  FallbackNodeData,
  OutputNodeData,
  FormField,
  SchemaInfo,
  SchemeObject,
  GlobalCriteria,
} from '../types';

// === COMMON DTOs ===
class FormFieldDto implements FormField {
  @IsString()
  name: string;

  @IsString()
  type: string;
}

class SchemaAttributeDto {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsString()
  type: string;
}

class SchemaInfoDTO implements SchemaInfo {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SchemaAttributeDto)
  attributes: SchemaAttributeDto[];
}

class SchemeObjectDto implements SchemeObject {
  @IsString()
  id: string;

  @IsString()
  selectedSchema: string;

  @IsArray()
  @IsString({ each: true })
  selectedFields: string[];
}

class GlobalCriteriaDto implements GlobalCriteria {
  @IsString()
  scheme: string;

  @IsString()
  column: string;

  @IsString()
  condition: string;

  @IsString()
  value: string;

  @IsEnum(['form', 'static'])
  valueSource: 'form' | 'static';
}

class PositionDto {
  @IsNumber()
  x: number;

  @IsNumber()
  y: number;
}

class MeasuredDto {
  @IsNumber()
  width: number;

  @IsNumber()
  height: number;
}

// === Node Data DTOs ===
class ConversationNodeDataDto implements ConversationNodeData {
  @IsString()
  label: string;

  @IsEnum(['start', 'message', 'question', 'condition', 'end'])
  type: 'start' | 'message' | 'question' | 'condition' | 'end';

  @IsOptional()
  @IsEnum(['template', 'ia'])
  mode?: 'template' | 'ia';

  @IsString()
  message: string;
}

class InputNodeDataDto implements InputNodeData {
  @IsString()
  label: string;

  @IsString()
  fieldName: string;

  @IsEnum(['text', 'number', 'date', 'select'])
  fieldType: 'text' | 'number' | 'date' | 'select';

  @IsString()
  description: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];
}

class FallbackNodeDataDto implements FallbackNodeData {
  @IsString()
  label: string;

  @IsString()
  message: string;
}

class OutputNodeDataDto implements OutputNodeData {
  @IsString()
  label: string;

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

  @IsEnum(['raw', 'template'])
  templateMode: 'raw' | 'template';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SchemaInfoDTO)
  availableSchemas: SchemaInfoDTO[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  availableFormFields: FormFieldDto[];
}

// === Union para data ===
type NodeDataDtoUnion =
  | InputNodeDataDto
  | ConversationNodeDataDto
  | OutputNodeDataDto
  | FallbackNodeDataDto;

class NodeDto {
  @IsString()
  id: string;

  @IsEnum(['conversationNode', 'outputNode', 'inputNode', 'fallbackNode'])
  type: NodeType;

  @ValidateNested()
  @Type(() => PositionDto)
  position: PositionDto;

  @ValidateNested()
  @Type((options) => {
    if (!options || !options.newObject) return ConversationNodeDataDto;

    const nodeType = (options.newObject as NodeDto).type;
    switch (nodeType) {
      case 'conversationNode':
        return ConversationNodeDataDto;
      case 'inputNode':
        return InputNodeDataDto;
      case 'outputNode':
        return OutputNodeDataDto;
      case 'fallbackNode':
        return FallbackNodeDataDto;
      default:
        return ConversationNodeDataDto;
    }
  })
  data: NodeDataDtoUnion;

  @ValidateNested()
  @Type(() => MeasuredDto)
  measured: MeasuredDto;

  @IsOptional()
  @IsBoolean()
  selected?: boolean;

  @IsOptional()
  @IsBoolean()
  dragging?: boolean;
}

class EdgeDto {
  @IsString()
  id: string;

  @IsString()
  source: string;

  @IsString()
  target: string;

  @IsEnum(['default', 'custom', 'fallback'])
  type: 'default' | 'custom' | 'fallback';

  @IsOptional()
  style?: Record<string, any>;
}

class MappedNode2Dto {
  @IsEnum(['conversationNode', 'outputNode', 'inputNode', 'fallbackNode'])
  type: NodeType;

  @ValidateNested()
  @Type((options) => {
    if (!options || !options.newObject) return ConversationNodeDataDto;

    const nodeType = (options.newObject as MappedNode2Dto).type;
    switch (nodeType) {
      case 'conversationNode':
        return ConversationNodeDataDto;
      case 'inputNode':
        return InputNodeDataDto;
      case 'outputNode':
        return OutputNodeDataDto;
      case 'fallbackNode':
        return FallbackNodeDataDto;
      default:
        return ConversationNodeDataDto;
    }
  })
  data: NodeDataDtoUnion;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MappedNode2Dto)
  next?: MappedNode2Dto[];
}

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
