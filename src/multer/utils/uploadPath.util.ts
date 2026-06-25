// ==================== src/multer/utils/uploads-path.util.ts ====================
import * as path from 'path';

/**
 * Raíz de uploads para todo lo que gestione este módulo.
 * Vive acá (no en `common`) porque es un detalle de implementación
 * exclusivo de cómo este módulo escribe a disco.
 */
export function getUploadsRoot(): string {
  return path.join(process.cwd(), process.env.UPLOADS_PATH || 'public/uploads');
}