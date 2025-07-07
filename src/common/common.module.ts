import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module'; // Importar PrismaModule
import { PersistenceService } from './services/percistence/persistence.service';
import { MongooseModule } from '@nestjs/mongoose';
import { SchemaModelSchema } from 'src/mongoose/schemas.schema';

@Module({
  imports: [PrismaModule,
    MongooseModule.forFeature([
      { name: 'Schema', schema: SchemaModelSchema },
    ]),
  ], // Importar PrismaModule para que sus servicios estén disponibles
  providers: [PersistenceService], // Proveer PercistenceService
  exports: [PersistenceService], // Exportar PercistenceService para que otros módulos puedan usarlo
})
export class CommonModule {}
