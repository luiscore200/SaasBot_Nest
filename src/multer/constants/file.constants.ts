// ==================== src/multer/constants/import-file.constants.ts ====================
export const ALLOWED_IMPORT_EXTENSIONS = ['.csv', '.json'];

// El mimetype de CSV es inconsistente entre navegadores/SO — se usa solo
// como señal laxa (warning). La extensión es la que decide si se acepta.
export const KNOWN_IMPORT_MIMES = [
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'application/json',
  'text/json',
  'text/plain',
  'application/octet-stream',
];

export const DEFAULT_IMPORT_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB