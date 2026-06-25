// ==================== src/multer/utils/filename.util.ts ====================
import * as path from 'path';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet(
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',
  10,
);

export function sanitizeFilename(filename: string): string {
  return filename
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .toLowerCase()
    .substring(0, 100);
}

export function generateSecureFilename(originalname: string): string {
  const ext = path.extname(originalname);
  const timestamp = Date.now();
  const randomId = nanoid();
  return `${randomId}_${timestamp}${ext}`;
}