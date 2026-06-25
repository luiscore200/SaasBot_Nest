import { MulterModuleOptions } from '@nestjs/platform-express';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { ConfigService } from '@nestjs/config';
import { diskStorage } from 'multer';
import { Request } from 'express';
import { BadRequestException } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { getImportTempDir } from '../utils/importPath.util';
import { sanitizeFilename, generateSecureFilename } from '../utils/filename.util';
import {
  ALLOWED_IMPORT_EXTENSIONS,
  KNOWN_IMPORT_MIMES,
  DEFAULT_IMPORT_MAX_FILE_SIZE,
} from '../constants/file.constants';

// ── Storage compartido (apunta a /temp) ─────────────────────────────────────

const importDiskStorage = diskStorage({
  destination: (req: Request, file, cb) => {
    const companyIdParam = req.params?.companyId;
    const companyId = Array.isArray(companyIdParam) ? companyIdParam[0] : companyIdParam;

    if (!companyId) return cb(new Error('companyId no encontrado en la ruta.'), '');

    const dir = getImportTempDir(companyId);  // ← /imports/temp
    fs.mkdir(dir, { recursive: true }, (err) => {
      if (err) return cb(err, dir);
      cb(null, dir);
    });
  },
  filename: (req, file, cb) => {
    cb(null, generateSecureFilename(sanitizeFilename(file.originalname)));
  },
});

const importFileFilter = (req: any, file: Express.Multer.File, cb: any) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_IMPORT_EXTENSIONS.includes(ext)) {
    return cb(
      new BadRequestException(`Solo se aceptan: ${ALLOWED_IMPORT_EXTENSIONS.join(', ')}`),
      false,
    );
  }
  if (!KNOWN_IMPORT_MIMES.includes(file.mimetype)) {
    console.warn(`⚠️  Mimetype inusual: ${file.mimetype} (aceptado por extensión)`);
  }
  cb(null, true);
};

// ── Para FileInterceptor (controller) ───────────────────────────────────────

export const IMPORT_MULTER_CONFIG: MulterOptions = {
  storage: importDiskStorage,
  fileFilter: importFileFilter,
  limits: { fileSize: DEFAULT_IMPORT_MAX_FILE_SIZE, files: 1 },
};

// ── Para NestMulterModule.registerAsync (si se usa en otro módulo) ───────────

export function buildImportMulterOptions(config: ConfigService): MulterModuleOptions {
  const maxFileSize = config.get<number>('IMPORT_MAX_FILE_SIZE', DEFAULT_IMPORT_MAX_FILE_SIZE);
  return {
    storage: importDiskStorage,
    fileFilter: importFileFilter,
    limits: { fileSize: maxFileSize, files: 1 },
  };
}