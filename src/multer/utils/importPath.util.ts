// ==================== src/multer/utils/import-path.util.ts ====================
import * as path from 'path';
import { getUploadsRoot } from './uploadPath.util';

export interface ImportFilePath {
  filename: string;
  relativePath: string;
  absolutePath: string;
}

/**
 * Única fuente de verdad de la convención de carpetas para archivos de
 * importación. La usan tanto el `destination` de Multer (escritura) como
 * MulterService (lectura/limpieza) — así no se desincronizan nunca.
 */
export function getImportDir(companyId: string): string {
  return path.join(getUploadsRoot(), 'companies', String(companyId), 'imports');
}

export function buildImportFilePath(companyId: string, filename: string): ImportFilePath {
  const relativePath = path.join('companies', String(companyId), 'imports', filename);
  return {
    filename,
    relativePath,
    absolutePath: path.join(getUploadsRoot(), relativePath),
  };
}

export function resolveImportAbsolutePath(relativePath: string): string {
  return path.join(getUploadsRoot(), relativePath);
}

// ── Rutas temporales ─────────────────────────────────────────────────────────

export function getImportTempDir(companyId: string): string {
  return path.join(getUploadsRoot(), 'companies', String(companyId), 'imports', 'temp');
}

export function buildImportTempFilePath(companyId: string, filename: string): ImportFilePath {
  const relativePath = path.join('companies', String(companyId), 'imports', 'temp', filename);
  return {
    filename,
    relativePath,
    absolutePath: path.join(getUploadsRoot(), relativePath),
  };
}