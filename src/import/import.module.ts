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

@Module({
  imports: [DataModule, GroqModule, MulterModule],
  controllers: [ImportController],
  providers: [ImportService, ImportQueueService, FileParserService, SchemaInferenceService, SchemaValidatorService,ImportSseService],
})
export class ImportModule {}