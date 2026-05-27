// ─── create-widgetconfig.dto.ts ───────────────────────────────────────────────
 
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsBoolean,
  Matches,
} from 'class-validator';
import { WIDGET_POSITIONS, WidgetPosition } from '../../../mongoose/widgetConfig.schema';
 
const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
 
export class CreateWidgetConfigDto {
  @IsString()
  @IsNotEmpty()
  botConfigId: string;
 
  @IsString()
  @IsNotEmpty()
  displayName: string;
 
  @IsOptional()
  @IsString()
  logoUrl?: string;
 
  @IsString()
  @Matches(HEX_COLOR_REGEX, { message: 'primaryColor debe ser un color hex válido. Ej: #3B82F6' })
  primaryColor: string;
 
  @IsString()
  @Matches(HEX_COLOR_REGEX, { message: 'secondaryColor debe ser un color hex válido. Ej: #F3F4F6' })
  secondaryColor: string;
 
  @IsEnum(WIDGET_POSITIONS, {
    message: `position debe ser uno de: ${WIDGET_POSITIONS.join(', ')}`,
  })
  position: WidgetPosition;
}
 