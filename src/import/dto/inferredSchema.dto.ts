// src/data/import/dto/inferred-schema.dto.ts
import { Type } from 'class-transformer';
import {
  IsArray, ArrayMinSize, IsBoolean, IsEnum, IsOptional, IsString,
  IsNotEmpty, ValidateNested,
} from 'class-validator';
import { FieldType, SchemaCategory } from '../../data/schemas/dto/create-schema.dto';

export class InferredFieldDto {
  @IsString() @IsNotEmpty()
  name: string;


  @IsOptional() @IsString()
  description?: string;
}

