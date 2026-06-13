// ─────────────────────────────────────────────────────────────────────────────
// chat-engine.module.ts
// ─────────────────────────────────────────────────────────────────────────────
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

// Schemas Mongo
import { ChatbotModel, ChatbotSchema } from '../mongoose/chatbot.schema';
import { MapflowModel, MapflowModelSchema } from '../mongoose/mapflows.schema';
import { FlowRuntime, FlowRuntimeSchema } from '../mongoose/runtimes.schema';
import { WidgetConfigModel, WidgetConfigSchema } from '../mongoose/widgetConfig.schema';

// Módulo del GroqService base (ya existente en tu proyecto)
import { GroqModule } from '../groq/groq.module';

// Engine internals
import { EngineService } from './engine.service';
import { NodeService } from './node/node.service';
import { ContextService } from './context/context.service';
import { SessionService } from './session/session.service';
import { ChatGroqService} from './groq/chatGroq.service';

// Controller
import { EngineController } from './engine.controller';
import { PersistenceService } from 'src/common/services/percistence/persistence.service';
import { CommonModule } from 'src/common/common.module';
import { QdrantModule } from 'src/qdrant/qdrant.module';
import { DataResolverService } from './node/output/dataResolver.service';
import { OllamaModule } from 'src/ollama/ollama.module';
import { GeminiModule } from 'src/gemini/gemini.module';
import { DataModule } from 'src/data/data.module';

@Module({
  imports: [
    // Schemas que el engine necesita leer
    MongooseModule.forFeature([
      { name: ChatbotModel.name, schema: ChatbotSchema },
      { name: MapflowModel.name, schema: MapflowModelSchema },
      { name: FlowRuntime.name, schema: FlowRuntimeSchema },
      { name: WidgetConfigModel.name, schema: WidgetConfigSchema },
    ]),

    // GroqService base — agnóstico, ya registrado en tu app
    GroqModule,
    CommonModule,
    QdrantModule,
    GeminiModule,
    OllamaModule,
    DataModule
  ],
  providers: [
    // Core engine
    EngineService,
    NodeService,
    ContextService,

    // Sesión en memoria — singleton por módulo
    SessionService,

    // Wrapper delgado de Groq para el engine
    ChatGroqService,

    DataResolverService

  
  ],
  controllers: [EngineController],

  // Exportar ChatEngine por si otros módulos necesitan procesarlo
  // (ej: WhatsAppModule cuando lo implementes)
  exports: [EngineService, SessionService],
})
export class EngineModule {}
