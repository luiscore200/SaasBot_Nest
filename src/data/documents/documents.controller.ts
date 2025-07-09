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
import { UpdateDocumentDto } from './dto/update-document.dto'; // Assuming an update DTO for single
import { ResponseManager } from 'src/common/utils/response.manager';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  // --- Many Operations ---

  @Post(':companyId/:schemaId/create-many') 
  async createMany(
    @Param('companyId') companyId: string,
    @Param('schemaId') schemaId: string, 
    @Body() dto:any,
  ) {
    const cleanSchemaId = schemaId.trim(); 

    return this.documentsService.createDocuments(companyId, cleanSchemaId, dto);
  }


  @Post(':companyId/:schemaId/delete-many')
  async deleteMany(
    @Param('companyId') companyId: string,
    @Param('schemaId') schemaId: string, 
    @Body('ids') ids: string[],
    
   
   
  ) {
    console.log(ids);
    const res = await this.documentsService.deleteDocuments(companyId, schemaId, ids);
    return ResponseManager.success(res,"Resource deleted successfully", 200);
  }

  @Get(':companyId/:schemaId')
  async findAll(
    @Param('companyId') companyId: string,
    @Param('schemaId') schemaId: string, 
    @Query() filter: any,
  ) {
    const cleanSchemaId = schemaId.trim(); 
    return this.documentsService.findAll(companyId, cleanSchemaId,filter);
  }

  @Get(':companyId/:schemaId/:id')
  async findOne(
    @Param('companyId') companyId: string,
    @Param('schemaId') schemaId: string, 
    @Param('id') id: string,
  ) {
    // Add schemaId to findOne logic in service
    const cleanSchemaId = schemaId.trim(); 
    const cleanId = id.trim(); 
    return this.documentsService.findOne(companyId,cleanSchemaId, cleanId);
  }

  // --- Singular Operations (New) ---

  @Post(':companyId/:schemaId')
  async create(
    @Param('companyId') companyId: string,
    @Param('schemaId') schemaId: string,
    @Body() dto: any, 
  ) {
    const cleanSchemaId = schemaId.trim(); 
    return this.documentsService.createDocument(companyId, cleanSchemaId, dto);
  }

  @Put(':companyId/:schemaId/:id') 
  async update(
    @Param('companyId') companyId: string,
    @Param('schemaId') schemaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto, 
  ) {
    const cleanSchemaId = schemaId.trim(); 
    const cleanId = id.trim(); 
    return this.documentsService.updateDocument(companyId, cleanSchemaId, cleanId, dto);
  }

  @Delete(':companyId/:schemaId/:id') 
  async delete(
    @Param('companyId') companyId: string,
    @Param('schemaId') schemaId: string,
    @Param('id') id: string,
    @Query('hard', new DefaultValuePipe(false), ParseBoolPipe)
    hard: boolean,
  ) {
    const cleanSchemaId = schemaId.trim(); 
    const cleanId = id.trim(); 
    return this.documentsService.deleteDocument(companyId, cleanSchemaId, cleanId);
  }
}
