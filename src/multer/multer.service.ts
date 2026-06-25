import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import {
  buildImportFilePath,
  buildImportTempFilePath,
  resolveImportAbsolutePath,
  getImportDir,
  ImportFilePath,
} from './utils/importPath.util';

@Injectable()
export class MulterService {
  private readonly logger = new Logger(MulterService.name);

  /** Path relativo + absoluto de la ubicación FINAL del archivo */
  buildImportFilePath(companyId: string, filename: string): ImportFilePath {
    return buildImportFilePath(companyId, filename);
  }

  /** Path relativo + absoluto de la ubicación TEMPORAL del archivo */
  buildImportTempFilePath(companyId: string, filename: string): ImportFilePath {
    return buildImportTempFilePath(companyId, filename);
  }

  resolveAbsolutePath(relativePath: string): string {
    return resolveImportAbsolutePath(relativePath);
  }

  /**
   * Mueve el archivo de /imports/temp/{file} → /imports/{file}
   * Retorna el ImportFilePath de la ubicación final.
   */
  async moveFromTemp(companyId: string, filename: string): Promise<ImportFilePath> {
    const tempPath = buildImportTempFilePath(companyId, filename);
    const finalPath = buildImportFilePath(companyId, filename);

    await fs.mkdir(getImportDir(companyId), { recursive: true });
    await fs.rename(tempPath.absolutePath, finalPath.absolutePath);
    this.logger.log(`📦 Archivo movido: temp → final | ${finalPath.relativePath}`);

    return finalPath;
  }

  /**
   * Elimina el archivo de /imports/temp/{file}
   * Se llama cuando el procesamiento falla.
   */
  async deleteTempFile(companyId: string, filename: string): Promise<void> {
    const tempPath = buildImportTempFilePath(companyId, filename);
    await this._deleteFile(tempPath.absolutePath, tempPath.relativePath);
  }

  /**
   * Elimina el archivo de /imports/{file} (ruta final)
   * Se llama si se descarta un draft ya confirmado.
   */
  async deleteImportFile(relativePath: string): Promise<void> {
    const fullPath = this.resolveAbsolutePath(relativePath);
    await this._deleteFile(fullPath, relativePath);
  }

  private async _deleteFile(absolutePath: string, label: string): Promise<void> {
    try {
      if (existsSync(absolutePath)) {
        await fs.unlink(absolutePath);
        this.logger.log(`🗑️  Archivo eliminado: ${label}`);
      } else {
        this.logger.warn(`⚠️  Archivo no encontrado para eliminar: ${label}`);
      }
    } catch (error: any) {
      this.logger.error(`❌ Error eliminando archivo ${label}: ${error.message}`);
    }
  }
}