import { Module } from '@nestjs/common';
import { SchemasController } from './schemas/schemas.controller';
import { SchemasService } from './schemas/schemas.service';
import { MongooseModelsModule } from '../mongoose/mongoose.module';
import { DtoService } from './documents/dto/dto.service';
import { CommonModule } from 'src/common/common.module';

@Module({
  imports: [MongooseModelsModule,CommonModule],
  controllers: [SchemasController],
  providers: [ SchemasService, DtoService],
})
export class DataModule {}
