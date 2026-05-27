// ─── update-widgetconfig.dto.ts ───────────────────────────────────────────────
 
import { PartialType } from '@nestjs/mapped-types';
import { CreateWidgetConfigDto } from './create.dto';
import { IsBoolean, IsOptional } from 'class-validator';
 
export class UpdateWidgetConfigDto extends PartialType(CreateWidgetConfigDto) {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
 