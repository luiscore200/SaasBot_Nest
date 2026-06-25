// ==================== src/multer/multer.module.ts ====================
import { Module } from '@nestjs/common';
import { MulterModule as NestMulterModule } from '@nestjs/platform-express';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { buildImportMulterOptions } from './config/multer.config';
import { MulterService } from './multer.service';

/**
 * Módulo independiente de Multer. No vive en `common` porque no es un
 * utilitario genérico — es comportamiento de upload específico que
 * cualquier feature que reciba archivos de importación reutiliza
 * importando este módulo:
 *
 *   - ImportModule              → POST /import/:companyId
 *   - DocumentsModule (futuro)  → POST /schemas/:companyId/:schemaId/documents/import
 */
@Module({
  imports: [
    NestMulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: buildImportMulterOptions,
    }),
  ],
  exports: [NestMulterModule,MulterService],
  providers: [MulterService],
})
export class MulterModule {}