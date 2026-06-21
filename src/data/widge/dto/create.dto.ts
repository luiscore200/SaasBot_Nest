import {
  IsString, IsOptional, IsHexColor, IsEnum, IsArray, IsUrl, ArrayUnique,
} from 'class-validator';
import { WIDGET_POSITIONS, WidgetPosition } from '../../../mongoose/widgetConfig.schema';

export class CreateWidgetConfigDto {
  @IsString()
  botConfigId!: string;

  @IsString()
  displayName!: string;

  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @IsOptional()
  @IsHexColor()
  secondaryColor?: string;

  @IsOptional()
  @IsEnum(WIDGET_POSITIONS)
  position?: WidgetPosition;

  /**
   * Dominios autorizados para usar este widget.
   * Acepta URLs con o sin path, localhost incluido.
   * Ejemplos: ['https://mitienda.com', 'http://localhost:5500']
   */
  @IsOptional()
  @IsArray()
  @IsUrl(
    {
      require_tld: false,      // permite localhost (sin TLD)
      require_protocol: true,  // obliga https:// o http://
    },
    { each: true },
  )
  @ArrayUnique()
  allowedOrigins?: string[];
}