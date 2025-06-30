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
  findAll(@Query('company_id') companyId: string) {
    return this.schemasService.getSchemasByCompany(companyId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.schemasService.getSchemaById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSchemaDto: UpdateSchemaDto) {
    return this.schemasService.updateSchema(id, updateSchemaDto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.schemasService.deleteSchema(id);
  }
}
