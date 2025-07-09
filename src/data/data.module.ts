import { Module } from '@nestjs/common';
import { SchemasController } from './schemas/schemas.controller';
import { SchemasService } from './schemas/schemas.service';
import { MongooseModelsModule } from '../mongoose/mongoose.module';
import { DtoService } from './documents/dto/dto.service';
import { CommonModule } from 'src/common/common.module';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';

@Module({
  imports: [MongooseModelsModule,CommonModule],
  controllers: [SchemasController,DocumentsController],
  providers: [ SchemasService, DtoService,DocumentsService],
})
export class DataModule {}
