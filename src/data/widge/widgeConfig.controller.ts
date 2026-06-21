import {
  Controller, Get, Post, Put, Delete, Patch,
  Param, Body, Query, HttpCode, HttpStatus, Res,
} from '@nestjs/common';
import { Response } from 'express';
import { WidgetConfigService } from './widgeConfig.service';
import { CreateWidgetConfigDto } from './dto/create.dto';
import { UpdateWidgetConfigDto } from './dto/update.dto';
import { WIDGET_LOADER_SCRIPT } from './loader';

@Controller()
export class WidgetConfigController {
  constructor(private readonly widgetConfigService: WidgetConfigService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // RUTAS PÚBLICAS OPACAS
  // Superficie visible: solo el token JWT. Sin companyId, widgetId ni paths internos.
  // La validación de origin ya ocurrió en CORS antes de llegar aquí.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /widget/v?t=TOKEN
   * Sirve el loader.js. Valida el token antes de servir
   * para evitar que URLs manipuladas reciban el script.
   */
  @Get('widget/v')
  serveLoader(
    @Query('t') token: string,
    @Res() res: Response,
  ) {
    this.widgetConfigService.verifyWidgetToken(token);

    res.setHeader('Content-Type',  'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(WIDGET_LOADER_SCRIPT);
  }

  /**
   * GET /widget/r?t=TOKEN
   * Devuelve config de UI al loader.js.
   * Origin ya validado por CORS — aquí solo se verifica el token y se resuelve la config.
   */
  @Get('widget/r')
  resolveWidget(@Query('t') token: string) {
    return this.widgetConfigService.resolveForWidget(token);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RUTAS CRUD — protegidas por tus guards de autenticación
  // ═══════════════════════════════════════════════════════════════════════════

  @Post('widget-configs/:companyId')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateWidgetConfigDto,
  ) {
    return this.widgetConfigService.create(companyId, dto);
  }

  @Get('widget-configs/:companyId')
  findAll(
    @Param('companyId') companyId: string,
    @Query('deleted') deleted?: string,
  ) {
    return this.widgetConfigService.findAll(companyId, deleted === 'true');
  }

  @Get('widget-configs/:companyId/:id')
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Query('deleted') deleted?: string,
  ) {
    return this.widgetConfigService.findById(companyId, id, deleted === 'true');
  }

  @Put('widget-configs/:companyId/:id')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWidgetConfigDto,
  ) {
    return this.widgetConfigService.update(companyId, id, dto);
  }

  @Patch('widget-configs/:companyId/:id/active')
  toggleActive(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Query('value') value: string,
  ) {
    return this.widgetConfigService.toggleActive(companyId, id, value === 'true');
  }

  @Delete('widget-configs/:companyId/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Query('hard') hard?: string,
  ) {
    return this.widgetConfigService.delete(companyId, id, hard === 'true');
  }
}