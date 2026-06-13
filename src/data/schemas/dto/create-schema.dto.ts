import { IsString, IsNotEmpty, IsArray, ValidateNested, IsBoolean, IsEnum,IsOptional, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export enum FieldType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  JSON = 'json',
  DATE = 'date',
}

export enum AutoFieldType {
  UUID       = 'uuid',
  TIMESTAMP  = 'timestamp',
  BATCH_ID   = 'batch_id',
}


export enum SchemaCategory {
  INVENTORY = 'inventory',
  SCHEDULE = 'schedule',
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


  @IsOptional()
   @IsEnum(AutoFieldType, {
    message: 'auto debe ser "uuid", "timestamp" o "batch_id"',
  })
  auto?: AutoFieldType; // 'uuid' | 'timestamp' | 'batch_id' | undefined
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
  @ArrayMinSize(1)
  fields: CreateSchemaFieldDto[];
}
