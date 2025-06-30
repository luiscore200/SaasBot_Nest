import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module'; // Importar PrismaModule
import { PercistenceService } from './services/percistence/percistence.service'; // Importar PercistenceService

@Module({
  imports: [PrismaModule], // Importar PrismaModule para que sus servicios estén disponibles
  providers: [PercistenceService], // Proveer PercistenceService
  exports: [PercistenceService], // Exportar PercistenceService para que otros módulos puedan usarlo
})
export class CommonModule {}
