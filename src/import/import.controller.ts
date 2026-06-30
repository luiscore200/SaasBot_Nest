import {
  Controller, Post, Get, Delete, Param, Body,
  UploadedFile, UseInterceptors, BadRequestException,
  InternalServerErrorException, Logger, NotFoundException, Sse,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Observable, map } from 'rxjs';
import { ImportService } from './import.service';
import { ImportSseService } from './sse.service';
import { MulterService } from 'src/multer/multer.service';
import { IMPORT_MULTER_CONFIG } from 'src/multer/config/multer.config';
import {
  StartImportResponse,
  GetActiveJobResponse,
  GetActiveJobWithDataResponse,
  DiscardJobResponse,
  ConfirmSchemaOnlyResponse,
  ConfirmSchemaAndDataResponse,
} from './response.types';
import type { ImportSseEvent } from './sse.service';

interface UploadedMulterFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
}

@Controller('import')
export class ImportController {
  private readonly logger = new Logger(ImportController.name);

  constructor(
    private readonly importService: ImportService,
    private readonly importSse: ImportSseService,
    private readonly multerService: MulterService,
  ) {}

  // ─── POST /:companyId — subir archivo e iniciar Fase A ───────────────────

  @Post(':companyId')
  @UseInterceptors(FileInterceptor('file', IMPORT_MULTER_CONFIG))
  async import(
    @Param('companyId') companyId: string,
    @Body('name') name: string,
    @Body('description') description: string | undefined,
    @UploadedFile() file: UploadedMulterFile,
  ): Promise<StartImportResponse> {
    if (!file) {
      throw new BadRequestException({ message: 'Debes adjuntar un archivo .csv o .json.' });
    }
    if (!name?.trim()) {
      throw new BadRequestException({ message: 'El campo "name" es obligatorio.' });
    }

    this.logger.log(`📥 ${file.originalname} → temp (${file.size} bytes)`);

    try {
      const finalPath = await this.multerService.moveFromTemp(companyId, file.filename);
      this.logger.log(`✅ Archivo en ruta final: ${finalPath.relativePath}`);

      return this.importService.importFile(
        companyId,
        name.trim(),
        description,
        { ...file, path: finalPath.relativePath },
      );

    } catch (error: any) {
      this.logger.warn(`⚠️  Fallo — limpiando temp: ${file.filename}`);
      await this.multerService.deleteTempFile(companyId, file.filename);
      if (error?.status) throw error;
      throw new InternalServerErrorException(
        `Error procesando el archivo: ${error.message ?? 'Error desconocido'}`,
      );
    }
  }

  // ─── GET /:companyId/progress — SSE Fase A ───────────────────────────────

  @Sse(':companyId/progress')
  progress(
    @Param('companyId') companyId: string,
  ): Observable<MessageEvent> {
    const stream$ = this.importSse.getOrCreate(companyId);
    return stream$.pipe(
      map((event: ImportSseEvent) => ({ data: event } as MessageEvent)),
    );
  }

  // ─── GET /:companyId/job — consultar job activo ──────────────────────────

  @Get(':companyId/job')
  getActiveJob(
    @Param('companyId') companyId: string,
  ): GetActiveJobResponse | GetActiveJobWithDataResponse {
    return this.importService.getActiveJob(companyId);
  }

  // ─── DELETE /:companyId/job — descartar job ──────────────────────────────

  @Delete(':companyId/job')
  async discardJob(
    @Param('companyId') companyId: string,
  ): Promise<DiscardJobResponse> {
    const result = this.importService.getActiveJob(companyId);

    if (!result.active) {
      throw new NotFoundException({ message: 'No hay ningún análisis activo para descartar.' });
    }

    try {
      await this.multerService.deleteImportFile(result.job.filePath);
      this.logger.log(`🗑️  Archivo borrado: ${result.job.filePath}`);
    } catch {
      this.logger.warn(`⚠️  No se pudo borrar el archivo: ${result.job.filePath}`);
    }

    return this.importService.discardJob(companyId);
  }

  // ─── POST /:companyId/confirm — Fase 5 ───────────────────────────────────

  @Post(':companyId/confirm')
  async confirm(
    @Param('companyId') companyId: string,
    @Body('action') action: 'schema_only' | 'schema_and_data',
  ): Promise<ConfirmSchemaOnlyResponse | ConfirmSchemaAndDataResponse> {
    if (!action || !['schema_only', 'schema_and_data'].includes(action)) {
      throw new BadRequestException({
        message: 'El campo "action" debe ser "schema_only" o "schema_and_data".',
      });
    }

    if (action === 'schema_only') {
      return this.importService.confirmSchemaOnly(companyId);
    }

    return this.importService.confirmSchemaAndData(companyId);
  }

  
  // ─── GET /:companyId/jobs/progress — SSE Fase B ──────────────────────────

  @Sse(':companyId/jobs/progress')
  jobProgress(
    @Param('companyId') companyId: string,
  ): Observable<MessageEvent> {
    // Reutiliza el mismo ReplaySubject — el front abre este stream al confirmar schema_and_data
    const stream$ = this.importSse.getOrCreate(companyId);
    return stream$.pipe(
      map((event: ImportSseEvent) => ({ data: event } as MessageEvent)),
    );
  }

  // ─── POST /:companyId/jobs/decision — Fase 7 ─────────────────────────────

  @Post(':companyId/jobs/decision')
  async decision(
    @Param('companyId') companyId: string,
    @Body('action') action: 'accept' | 'reject',
  ): Promise<{ accepted: boolean }> {
    if (!action || !['accept', 'reject'].includes(action)) {
      throw new BadRequestException({
        message: 'El campo "action" debe ser "accept" o "reject".',
      });
    }
    return this.importService.handleDecision(companyId, action);
  }
}