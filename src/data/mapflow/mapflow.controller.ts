import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Delete,
  Query,
  Put,
} from '@nestjs/common';
import { MapflowService } from './mapflow.service';
import { CreateMapflowDto } from './dto/create-mapflow.dto';
import { UpdateMapflowDto } from './dto/update-mapflow.dto';


@Controller('mapflows')
export class MapflowController {
  constructor(private readonly mapflowService: MapflowService) {}

  @Post(':companyId')
  async create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateMapflowDto,
  ) {
    return this.mapflowService.createMapflow(companyId, dto);
  }

  @Get(':companyId')
  async findAll(
    @Param('companyId') companyId: string,
    @Query('deleted') deleted?: string,
  ) {
    const deletedFilter =
      deleted !== undefined ? deleted === 'true' : undefined;
    return this.mapflowService.getMapflowsByCompany(companyId, deletedFilter);
  }

  @Get(':companyId/:id')
  async findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Query('deleted') deleted?: string,
  ) {
    const deletedFilter =
      deleted !== undefined ? deleted === 'true' : undefined;
    return this.mapflowService.getMapflowById(companyId, id, deletedFilter);
  }

  @Put(':companyId/:id')
  async update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMapflowDto,
  ) {
    return this.mapflowService.updateMapflow(companyId, id, dto);
  }

  @Delete(':companyId/:id')
  async delete(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Query('hard') hard?: string,
  ) {
    const hardDelete = hard !== undefined ? hard === 'true' : false;
    return this.mapflowService.deleteMapflow(companyId, id, hardDelete);
  }
}
