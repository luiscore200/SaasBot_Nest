import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Delete,
  Query,
  Put,
  Patch,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { MapflowService } from './mapflow.service';
import { CreateMapflowDto } from './dto/create-mapflow.dto';
import { UpdateMapflowDto } from './dto/update-mapflow.dto';

@Controller('mapflows')
export class MapflowController {
  constructor(private readonly mapflowService: MapflowService) {}

  @Post(':companyId')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateMapflowDto,
  ) {
    return this.mapflowService.createMapflow(companyId, dto);
  }

  @Get(':companyId')
  findAll(
    @Param('companyId') companyId: string,
    @Query('deleted') deleted?: string,
  ) {
    const includeDeleted = deleted === 'true';
    return this.mapflowService.getMapflowsByCompany(companyId, includeDeleted);
  }

  @Get(':companyId/:id')
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Query('deleted') deleted?: string,
  ) {
    const includeDeleted = deleted === 'true';
    return this.mapflowService.getMapflowById(companyId, id, includeDeleted);
  }

  @Put(':companyId/:id')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMapflowDto,
  ) {
    return this.mapflowService.updateMapflow(companyId, id, dto);
  }

  // PATCH separado para toggle active — semánticamente distinto a un update completo
  @Patch(':companyId/:id/active')
  toggleActive(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Query('value') value: string,
  ) {
    return this.mapflowService.toggleActive(companyId, id, value === 'true');
  }

  @Delete(':companyId/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Query('hard') hard?: string,
  ) {
    return this.mapflowService.deleteMapflow(companyId, id, hard === 'true');
  }

  // Endpoint exclusivo para el engine — separado del CRUD de UI
  @Get(':companyId/:id/runtime')
  getActiveRuntime(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.mapflowService.getActiveRuntime(companyId, id);
  }

  @Get(':companyId/:id/runtime/history')
  getRuntimeHistory(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.mapflowService.getRuntimesByFlow(companyId, id);
  }
}