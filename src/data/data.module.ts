import { Module } from '@nestjs/common';
import { SchemasController } from './schemas/schemas.controller';
import { SchemasService } from './schemas/schemas.service';
import { MongooseModelsModule } from '../mongoose/mongoose.module';
import { DtoService } from './documents/dto/dto.service';
import { CommonModule } from 'src/common/common.module';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
import { MapflowController } from './mapflow/mapflow.controller';
import { MapflowService } from './mapflow/mapflow.service';
import { ChatbotService } from './chatbots/chatbot.service';
import { ChatbotController } from './chatbots/chatbot.controller';
import { WidgetConfigService } from './widge/widgeConfig.service';
import { WidgetConfigController } from './widge/widgeConfig.controller';
import { EmbeddingModule } from 'src/embedding/embedding.module';
import { IndexingModule } from 'src/indexing/indexing.module';
import { CascadeService } from './cascade.service';


@Module({
  imports: [MongooseModelsModule,CommonModule,EmbeddingModule,IndexingModule],
  controllers: [SchemasController,DocumentsController, MapflowController, ChatbotController, WidgetConfigController],
  providers: [ SchemasService, DtoService,DocumentsService, MapflowService, ChatbotService, WidgetConfigService, CascadeService],
})
export class DataModule {}
