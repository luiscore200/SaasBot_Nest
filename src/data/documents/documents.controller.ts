import {
  Controller,
  Post,
  Put,
  Delete,
  Get,
  Param,
  Query,
  Body,
  DefaultValuePipe,
  ParseBoolPipe,
  ParseArrayPipe,
} from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto, SingleDocumentDto } from './dto/create-document.dto';

@Controller('companies/:companyId/documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  async createMany(
    @Param('companyId') companyId: string,
    @Body() dto: CreateDocumentDto,
  ) {
    return this.documentsService.createDocuments(companyId, dto);
  }

  @Put()
  async updateMany(
    @Param('companyId') companyId: string,
    @Body() dto: SingleDocumentDto[],
  ) {
    return this.documentsService.updateDocuments(companyId, dto);
  }

  @Delete()
  async deleteMany(
    @Param('companyId') companyId: string,
    @Query('ids', new ParseArrayPipe({ items: String, separator: ',' }))
    ids: string[],
    @Query('hard', new DefaultValuePipe(false), ParseBoolPipe)
    hard: boolean,
  ) {
    return this.documentsService.deleteDocuments(companyId, ids, hard);
  }

  @Get()
  async findAll(
    @Param('companyId') companyId: string,
    @Query() filter: any,
  ) {
    return this.documentsService.findAll(companyId, filter);
  }

  @Get(':id')
  async findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.documentsService.findOne(companyId, id);
  }
}
