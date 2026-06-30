
// ─────────────────────────────────────────────────────────────────────────────
// mapflow-ai.module.ts
// ─────────────────────────────────────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { MapflowAiController } from './mapInference.controller';
import { MapflowAiService } from './mapInference.service';
import { MapflowAiQueueService } from './qeue.service';
import { MapflowAiSseService } from './sse.service';
import { MapflowInferenceService } from './infercence.service';
import { GroqModule } from '../groq/groq.module';
import { MongooseModelsModule } from 'src/mongoose/mongoose.module';
import { DataModule } from 'src/data/data.module';


@Module({
  imports: [GroqModule, MongooseModelsModule,DataModule], 
  controllers: [MapflowAiController],
  providers: [
    MapflowAiService,
    MapflowAiQueueService,
    MapflowAiSseService,
    MapflowInferenceService,
  ],

  
})
export class MapInferenceModule {}