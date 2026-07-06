// ─────────────────────────────────────────────────────────────────────────────
// mapflow-ai.module.ts
// ─────────────────────────────────────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { MapflowAiController } from './mapInference.controller';
import { MapflowAiService } from './mapInference.service';
import { MapflowAiQueueService } from './qeue.service';
import { MapflowAiSseService } from './sse.service';
import { MapflowInferenceService } from './infercence.service';
import { CatalogLookupService } from './catalog.service';
import { GroqModule } from '../groq/groq.module';
import { MongooseModelsModule } from 'src/mongoose/mongoose.module';
import { DataModule } from 'src/data/data.module';
import { QdrantModule } from 'src/qdrant/qdrant.module';
import { OllamaModule } from 'src/ollama/ollama.module';
import { CommonModule } from 'src/common/common.module';

@Module({
  imports: [
    GroqModule,
    MongooseModelsModule,
    DataModule,          // se mantiene: lo usa SchemasService
    QdrantModule,        // nuevo: para CatalogLookupService
    OllamaModule,        // nuevo: para CatalogLookupService
    CommonModule,        // nuevo: para CatalogLookupService
  ],
  controllers: [MapflowAiController],
  providers: [
    MapflowAiService,
    MapflowAiQueueService,
    MapflowAiSseService,
    MapflowInferenceService,
    CatalogLookupService, // nuevo — propio del módulo de inferencia
  ],
})
export class MapInferenceModule {}