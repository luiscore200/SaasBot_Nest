import { Module } from '@nestjs/common';
import { GroqService } from './groq.service';
import { ConfigModule } from '@nestjs/config';
import { GroqController } from './groq.controller';

@Module({
   imports: [ConfigModule],
  providers: [GroqService],
  exports: [GroqService],
  controllers: [GroqController],
})
export class GroqModule {}
