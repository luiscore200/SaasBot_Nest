
import { Module, Global } from '@nestjs/common';
import { ConfigService, ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { SchemaModel, SchemaModelSchema } from './schemas.schema';
import { DocumentModel, DocumentModelSchema } from './documents.schema';
import { MongoOrmService } from './mongoose.service';
import { FlowRuntimeSchema } from './runtimes.schema';
import { MapflowModelSchema } from './mapflows.schema';
import { ChatbotSchema } from './chatbot.schema';
import { WidgetConfigSchema } from './widgetConfig.schema';
@Global()
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: 'Schema', schema: SchemaModelSchema },
      { name: 'Document', schema: DocumentModelSchema },
      { name:'Runtime',schema:FlowRuntimeSchema},
      { name:'Mapflow',schema:MapflowModelSchema},
       { name:'Chatbot',schema:ChatbotSchema},
        { name:'Widget',schema:WidgetConfigSchema}
    ]),
  ],
  providers: [ConfigService], // ✅ Solo ConfigService
  exports: [
    ConfigService,
    MongooseModule, // ✅ MUY importante
  ],
})
export class MongooseModelsModule {}
