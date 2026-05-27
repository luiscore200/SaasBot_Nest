import { Module } from '@nestjs/common';
import { IndexingService } from './indexing/indexing.service';
import { ProcessorService } from './processor/processor.service';
import { QueueService } from './queue/queue.service';
import { GroqModule } from 'src/groq/groq.module';
import { QdrantModule } from 'src/qdrant/qdrant.module';
import { CommonModule } from 'src/common/common.module';
import { OllamaModule } from 'src/ollama/ollama.module';

@Module({
  imports: [
    
    QdrantModule,
    CommonModule, // ← verifica que también esté
    OllamaModule
  ],
  providers: [
    QueueService,
    ProcessorService,
    IndexingService,
  
  ],
  exports: [
    IndexingService,
    QdrantModule,
  ],
})
export class IndexingModule {}
