 
// ─── update-botconfig.dto.ts ──────────────────────────────────────────────────
 
import { PartialType } from '@nestjs/mapped-types';
import { CreateBotConfigDto } from './create.dto';
import { IsBoolean, IsOptional } from 'class-validator';
 
export class UpdateBotConfigDto extends PartialType(CreateBotConfigDto) {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}