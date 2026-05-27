import { Module } from '@nestjs/common';

import { QueueService } from './queue/queue.service';
import { ProcessorService } from './processor/processor.service';
import { EnrichmentService } from './enrichment/enrichment.service';
import { GroqModule } from 'src/groq/groq.module';
import { CommonModule } from 'src/common/common.module';

@Module({
  imports:[GroqModule,CommonModule],
  providers: [ QueueService, ProcessorService, EnrichmentService],
  exports:[EnrichmentService]
})
export class EmbeddingModule {}
