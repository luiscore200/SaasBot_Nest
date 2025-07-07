import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsArray, IsBoolean, ValidateNested } from 'class-validator';

export class SingleDocumentDto {
  @IsString()
  @IsNotEmpty()
  company_id: string;

  @IsString()
  @IsNotEmpty()
  schema_id: string;

  @IsString()
  @IsOptional()
  category?: string;  // Opcional si la categoría se resuelve por schema

  @IsOptional()
  data: Record<string, any>; // Campos flexibles, validados dinámicamente

  @IsArray()
  @IsOptional()
  tags?: string[];

  @IsBoolean()
  @IsOptional()
  generated?: boolean;

  @IsString()
  @IsOptional()
  vector_id?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}


export class CreateDocumentDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SingleDocumentDto)
    documents: SingleDocumentDto[];
  }