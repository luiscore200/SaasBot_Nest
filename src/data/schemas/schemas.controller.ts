import { Controller, Get, Post, Body, Param, Query, Patch, Delete, UsePipes, ValidationPipe } from '@nestjs/common';
import { SchemasService } from './schemas.service';
import { CreateSchemaDto } from './dto/create-schema.dto';
import { UpdateSchemaDto } from './dto/update-schema.dto';

@Controller('schemas')
export class SchemasController {
  constructor(private readonly schemasService: SchemasService) {}

  @Post()
  create(@Body() createSchemaDto: CreateSchemaDto) {
    return this.schemasService.createSchema(createSchemaDto);
  }

  @Get()
  findAll(
    @Query('company_id') companyId: string,
    @Query('deleted') deleted?: string,
  ) {
    const deletedFilter = deleted !== undefined ? deleted === 'true' : undefined;
    return this.schemasService.getSchemasByCompany(companyId, deletedFilter);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Query('deleted') deleted?: string,
  ) {
    const deletedFilter = deleted !== undefined ? deleted === 'true' : undefined;
    return this.schemasService.getSchemaById(id, deletedFilter);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSchemaDto: UpdateSchemaDto) {
    console.log(updateSchemaDto);
    return this.schemasService.updateSchema(id, updateSchemaDto);
  }

  @Delete(':id')
  delete(
    @Param('id') id: string,
    @Query('hard') hard?: string,
  ) {
    console.log(id,hard);
    const hardDelete = hard !== undefined ? hard === 'true' : false; // Default to soft delete
    return this.schemasService.deleteSchema(id, hardDelete);
  }
}
