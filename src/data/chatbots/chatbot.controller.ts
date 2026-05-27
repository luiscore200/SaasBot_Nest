import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';



import { ChatbotService } from './chatbot.service';
import {  BotPlugin } from '../../mongoose/chatbot.schema';
import { CreateBotConfigDto } from './dto/create.dto';
import { UpdateBotConfigDto } from './dto/update.dto';

@Controller('bot-configs')
export class ChatbotController {
  constructor(private readonly botConfigService: ChatbotService) {}

  // POST /bot-configs/:companyId
  @Post(':companyId')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateBotConfigDto,
  ) {
    return this.botConfigService.create(companyId, dto);
  }

  // GET /bot-configs/:companyId?deleted=true&plugin=whatsapp
  @Get(':companyId')
  findAll(
    @Param('companyId') companyId: string,
    @Query('deleted') deleted?: string,
    @Query('plugin') plugin?: BotPlugin,
  ) {
    return this.botConfigService.findAll(companyId, deleted === 'true', plugin);
  }

  // GET /bot-configs/:companyId/:id
  @Get(':companyId/:id')
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Query('deleted') deleted?: string,
  ) {
    return this.botConfigService.findById(companyId, id, deleted === 'true');
  }

  // PUT /bot-configs/:companyId/:id
  @Put(':companyId/:id')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBotConfigDto,
  ) {
    return this.botConfigService.update(companyId, id, dto);
  }

  // PATCH /bot-configs/:companyId/:id/active?value=true|false
  @Patch(':companyId/:id/active')
  toggleActive(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Query('value') value: string,
  ) {
    return this.botConfigService.toggleActive(companyId, id, value === 'true');
  }

  // DELETE /bot-configs/:companyId/:id?hard=true
  @Delete(':companyId/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Query('hard') hard?: string,
  ) {
    return this.botConfigService.delete(companyId, id, hard === 'true');
  }

  /**
   * Endpoint exclusivo para el engine — devuelve la config resuelta
   * lista para iniciar una sesión de conversación.
   * GET /bot-configs/:companyId/:id/resolve
   */
  @Get(':companyId/:id/resolve')
  resolveForEngine(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.botConfigService.resolveForEngine(companyId, id);
  }
}