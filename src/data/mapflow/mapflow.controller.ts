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
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { MapflowService, RequestUser } from './mapflow.service';
import { CreateMapflowDto } from './dto/create-mapflow.dto';
import { UpdateMapflowDto } from './dto/update-mapflow.dto';
import { JwtGuard } from 'src/auth/jwt/jwt.guard'; // ajusta el path si difiere en tu proyecto

@UseGuards(JwtGuard)
@Controller('mapflows')
export class MapflowController {
  constructor(private readonly mapflowService: MapflowService) {}

  @Post(':companyId')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateMapflowDto,
    @Req() req: Request,
  ) {
    const user = req['user'] as RequestUser;
    return this.mapflowService.createMapflow(companyId, dto, user);
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
    @Req() req: Request,
  ) {
    const user = req['user'] as RequestUser;
    return this.mapflowService.updateMapflow(companyId, id, dto, user);
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
    @Query('hard') hard: string,
    @Req() req: Request,
  ) {
    const user = req['user'] as RequestUser;
    return this.mapflowService.deleteMapflow(companyId, id, user, hard === 'true');
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