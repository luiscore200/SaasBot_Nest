import { Module } from '@nestjs/common';
import { SchemasController } from './schemas/schemas.controller';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
import { SchemasService } from './schemas/schemas.service';

@Module({
  controllers: [SchemasController, DocumentsController],
  providers: [DocumentsService, SchemasService],
})
export class DataModule {}
