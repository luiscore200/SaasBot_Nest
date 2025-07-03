import { Module } from '@nestjs/common';
import { SchemasController } from './schemas/schemas.controller';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
import { SchemasService } from './schemas/schemas.service';
import { MongooseModelsModule } from '../mongoose/mongoose.module';

@Module({
  imports: [MongooseModelsModule],
  controllers: [SchemasController],
  providers: [ SchemasService],
})
export class DataModule {}
