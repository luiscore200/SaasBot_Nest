
import { Module, Global } from '@nestjs/common';
import { ConfigService, ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { SchemaModel, SchemaModelSchema } from './schemas.schema';
import { DocumentModel, DocumentModelSchema } from './documents.schema';
import { MongoOrmService } from './mongoose.service';
@Global()
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: 'Schema', schema: SchemaModelSchema },
      { name: 'Document', schema: DocumentModelSchema },
    ]),
  ],
  providers: [ConfigService], // ✅ Solo ConfigService
  exports: [
    ConfigService,
    MongooseModule, // ✅ MUY importante
  ],
})
export class MongooseModelsModule {}
