// ─── create-botconfig.dto.ts ──────────────────────────────────────────────────
 
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsArray,
  IsNumber,
  IsOptional,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { BOT_PLUGINS, BOT_TYPES, BotPlugin, BotType } from '../../../mongoose/chatbot.schema';
 // ─── create-botconfig.dto.ts ──────────────────────────────────────────────────
 

 
export class CreateBotConfigDto {
  @IsString()
  @IsNotEmpty()
  name: string;
 
  @IsString()
  @IsNotEmpty()
  description: string;
 
  @IsEnum(BOT_TYPES, {
    message: `type debe ser uno de: ${BOT_TYPES.join(', ')}`,
  })
  type: BotType;
 
  @IsEnum(BOT_PLUGINS, {
    message: `plugin debe ser uno de: ${BOT_PLUGINS.join(', ')}`,
  })
  plugin: BotPlugin;
 
  @IsString()
  @IsNotEmpty()
  mapflowId: string;
 
  @IsArray()
  @IsString({ each: true })
  selectedSchemas: string[];
 
  @IsString()
  @IsNotEmpty()
  instructions: string;
 
  @IsNumber()
  @Min(1)
  @Max(100)
  maxTurns: number;
}