import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { ImportQueueService } from './queue.service';
import { FileParserService } from './parser.service';
import { SchemaInferenceService } from './inference.service';

import { DataModule } from 'src/data/data.module';
import { GroqModule } from 'src/groq/groq.module';
import { MulterModule } from 'src/multer/multer.module';
import { SchemaValidatorService } from './validator.service';
import { ImportSseService } from './sse.service';
import { InsertionWorkerService } from './insertionWorker.servise';
import { CommonModule } from 'src/common/common.module';

@Module({
  imports: [DataModule, GroqModule, MulterModule,CommonModule],
  controllers: [ImportController],
  providers: [ImportService, ImportQueueService, FileParserService, SchemaInferenceService, SchemaValidatorService,ImportSseService,InsertionWorkerService],
})
export class ImportModule {}