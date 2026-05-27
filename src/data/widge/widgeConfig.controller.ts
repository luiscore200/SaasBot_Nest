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
import { WidgetConfigService } from './widgeConfig.service';
import { CreateWidgetConfigDto } from './dto/create.dto';
import { UpdateWidgetConfigDto } from './dto/update.dto';

@Controller('widget-configs')
export class WidgetConfigController {
  constructor(private readonly widgetConfigService: WidgetConfigService) {}

  // POST /widget-configs/:companyId
  @Post(':companyId')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateWidgetConfigDto,
  ) {
    return this.widgetConfigService.create(companyId, dto);
  }

  // GET /widget-configs/:companyId
  @Get(':companyId')
  findAll(
    @Param('companyId') companyId: string,
    @Query('deleted') deleted?: string,
  ) {
    return this.widgetConfigService.findAll(companyId, deleted === 'true');
  }

  // GET /widget-configs/:companyId/:id
  @Get(':companyId/:id')
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Query('deleted') deleted?: string,
  ) {
    return this.widgetConfigService.findById(companyId, id, deleted === 'true');
  }

  // PUT /widget-configs/:companyId/:id
  @Put(':companyId/:id')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWidgetConfigDto,
  ) {
    return this.widgetConfigService.update(companyId, id, dto);
  }

  // PATCH /widget-configs/:companyId/:id/active?value=true|false
  @Patch(':companyId/:id/active')
  toggleActive(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Query('value') value: string,
  ) {
    return this.widgetConfigService.toggleActive(companyId, id, value === 'true');
  }

  // DELETE /widget-configs/:companyId/:id?hard=true
  @Delete(':companyId/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Query('hard') hard?: string,
  ) {
    return this.widgetConfigService.delete(companyId, id, hard === 'true');
  }

  /**
   * Endpoint público consumido por el script JS del widget al cargarse.
   * No requiere autenticación de empresa — solo widgetId + companyId.
   * GET /widget-configs/:companyId/:id/resolve
   */
  @Get(':companyId/:id/resolve')
  resolveForWidget(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.widgetConfigService.resolveForWidget(id, companyId);
  }
}