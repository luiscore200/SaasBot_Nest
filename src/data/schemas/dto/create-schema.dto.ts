import { IsString, IsNotEmpty, IsArray, ValidateNested, IsBoolean, IsEnum,IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export enum FieldType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  JSON = 'json',
  DATE = 'date',
}
export enum SchemaCategory {
  CONSULTANT = 'consultant',
  SCHEDULER = 'scheduler',
}

export class CreateSchemaFieldDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(FieldType)
  type: FieldType;

  @IsBoolean()
  required: boolean;

  @IsOptional()
  @IsBoolean()
  unique?: boolean;
}

export class CreateSchemaDto {
  @IsString()
  @IsNotEmpty()
  company_id: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;


  @IsEnum(SchemaCategory, { message: 'Invalid category. Must be consultant or scheduler' })
  category: SchemaCategory;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSchemaFieldDto)
  fields: CreateSchemaFieldDto[];
}
