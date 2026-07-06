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
import { WidgetCorsService } from './widge/widgetCors.service';
import { AuthModule } from 'src/auth/auth.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MapflowPatternService } from './mapflow/mapflowPattern.service';
import { OllamaModule } from 'src/ollama/ollama.module';
import { StoreEnrichmentService } from './mapflow/storeEnrichment.service';
import { GroqModule } from 'src/groq/groq.module';




@Module({
  imports: [
    MongooseModelsModule,
    CommonModule,
    EmbeddingModule,
    IndexingModule,
    OllamaModule,
    AuthModule,
    PrismaModule,
    GroqModule,
    ConfigModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  exports:[DocumentsService,SchemasService],
  controllers: [SchemasController,DocumentsController, MapflowController, ChatbotController, WidgetConfigController],
  providers: [ SchemasService, DtoService,DocumentsService, MapflowService, ChatbotService   , 
    MapflowPatternService, WidgetConfigService, CascadeService, WidgetCorsService,StoreEnrichmentService],

})
export class DataModule {}