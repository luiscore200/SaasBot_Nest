import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsArray, IsBoolean, ValidateNested, IsObject } from 'class-validator';

export class SingleDocumentDto {
  @IsString()
  @IsNotEmpty()
  company_id: string;

  @IsString()
  @IsNotEmpty()
  schema_id: string;

  @IsString()
  
  category: string;  // Opcional si la categoría se resuelve por schema

  @IsObject()
  data: Record<string, any>; // Campos flexibles, validados dinámicamente

  @IsArray()

  tags: string[];

  @IsBoolean()
 
  generated?: boolean;

  @IsString()
  @IsOptional()
  vector_i?: string;

  @IsBoolean()
 
  active: boolean;
}


export class CreateDocumentDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SingleDocumentDto)
    documents: SingleDocumentDto[];
  }