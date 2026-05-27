// dto/update-mapflow.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateMapflowDto } from './create-mapflow.dto';

// PartialType hace todos los campos opcionales — correcto para updates parciales
export class UpdateMapflowDto extends PartialType(CreateMapflowDto) {}