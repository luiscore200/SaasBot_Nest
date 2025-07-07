import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  Query,
} from '@nestjs/common';
import { SchemasService } from './schemas.service';
import { CreateSchemaDto } from './dto/create-schema.dto';
import { UpdateSchemaDto } from './dto/update-schema.dto';

@Controller('schemas')
export class SchemasController {
  constructor(private readonly schemasService: SchemasService) {}

  @Post(':company_id')
  create(
    @Param('company_id') companyId: string,
    @Body() createSchemaDto: CreateSchemaDto,
  ) {
    
    return this.schemasService.createSchema(companyId, createSchemaDto);
  }

  @Get(':company_id')
  findAll(
    @Param('company_id') companyId: string,
    @Query('deleted') deleted?: string,
  ) {
    const deletedFilter = deleted !== undefined ? deleted === 'true' : undefined;
    return this.schemasService.getSchemasByCompany(companyId, deletedFilter);
  }

  @Get(':company_id/:id')
  findOne(
    @Param('company_id') companyId: string,
    @Param('id') id: string,
    @Query('deleted') deleted?: string,
  ) {
    const deletedFilter = deleted !== undefined ? deleted === 'true' : undefined;
    return this.schemasService.getSchemaById(companyId, id, deletedFilter);
  }

  @Patch(':company_id/:id')
  update(
    @Param('company_id') companyId: string,
    @Param('id') id: string,
    @Body() updateSchemaDto: UpdateSchemaDto,
  ) {
    return this.schemasService.updateSchema(companyId, id, updateSchemaDto);
  }

  @Delete(':company_id/:id')
  delete(
    @Param('company_id') companyId: string,
    @Param('id') id: string,
    @Query('hard') hard?: string,
  ) {
    const hardDelete = hard !== undefined ? hard === 'true' : false;
    return this.schemasService.deleteSchema(companyId, id, hardDelete);
  }
}
