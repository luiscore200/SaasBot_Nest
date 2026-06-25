import { Injectable, Logger } from '@nestjs/common';
import { parse as csvParse } from 'csv-parse/sync';
import * as fs from 'fs/promises';
import * as path from 'path';
import { FieldType } from 'src/data/schemas/dto/create-schema.dto';

// ─── Constantes ──────────────────────────────────────────────────────────────

const SAMPLE_SIZE = 20;
const HEADER_CONFIDENCE_THRESHOLD = 0.75;

// ─── Tipos internos ──────────────────────────────────────────────────────────

export interface ColumnProfile {
  index: number;
  sampleValues: string[];      // valores crudos de la muestra (string)
  distinctCount: number;
  nullCount: number;
  avgLength: number;
  minLength: number;
  maxLength: number;
  numericRatio: number;
  dateRatio: number;
  booleanRatio: number;
  hasLeadingZeros: boolean;
}

export interface HeaderDetectionResult {
  hasHeader: boolean;
  confidence: number;           // 0–1
  ambiguous: boolean;           // true si confidence < threshold → LLM resuelve
}

export interface Phase1Result {
  rawRows: string[][];          // todas las filas como arrays de strings (sin header si existe)
  sample: string[][];           // primeras SAMPLE_SIZE filas de rawRows
  headerRow: string[] | null;   // fila 0 si hasHeader, null si no
  headerDetection: HeaderDetectionResult;
  profiling: ColumnProfile[];
  inferredTypes: Record<number, FieldType>;
}

// ─── Helpers de detección de tipos ───────────────────────────────────────────

const BOOLEAN_VALUES = new Set([
  'true', 'false',
  'yes', 'no',
  'si', 'sí',
  'y', 'n',
  '1', '0',
  'activo', 'inactivo',
  'active', 'inactive',
  'on', 'off',
]);

export function normalizeNumeric(val: string): string {
  const trimmed = val.trim();
  // Detectar formato europeo: 1.234,56 → convertir a 1234.56
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(trimmed)) {
    return trimmed.replace(/\./g, '').replace(',', '.');
  }
  // Formato anglosajón con comas: 1,234.56 → 1234.56
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed)) {
    return trimmed.replace(/,/g, '');
  }
  // Número simple con coma decimal: 1,5 → 1.5
  if (/^\d+,\d+$/.test(trimmed)) {
    return trimmed.replace(',', '.');
  }
  return trimmed;
}

function isNumeric(val: string): boolean {
  if (!val || val.trim() === '') return false;
  const normalized = normalizeNumeric(val);
  const n = Number(normalized);
  return !isNaN(n) && normalized !== '';
}

function isDate(val: string): boolean {
  if (!val || val.trim() === '') return false;
  const trimmed = val.trim();

  // Rechazar strings claramente no-fecha (texto libre)
  if (/[a-zA-Z]/.test(trimmed)) return false;

  // ISO 8601: YYYY-MM-DD o YYYY-MM-DDTHH:mm...
  const iso = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]*)?$/;
  // Slash/guión: DD/MM/YYYY, MM/DD/YYYY, D/M/YY etc.
  const slash = /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/;

  if (!iso.test(trimmed) && !slash.test(trimmed)) return false;

  // Verificar que sea una fecha real (no 99/99/9999)
  const d = new Date(trimmed);
  return !isNaN(d.getTime());
}

function isBoolean(val: string): boolean {
  return BOOLEAN_VALUES.has(val.trim().toLowerCase());
}

function hasLeadingZero(val: string): boolean {
  // String que empieza con 0 pero no es "0" ni decimal "0.xx"
  return /^0\d+/.test(val.trim());
}

// ─── Servicio ─────────────────────────────────────────────────────────────────

@Injectable()
export class FileParserService {
  private readonly logger = new Logger(FileParserService.name);

  /**
   * Punto de entrada principal.
   * Lee el archivo desde absolutePath, parsea y produce Phase1Result.
   */
  async parse(absolutePath: string): Promise<Phase1Result> {
    const ext = path.extname(absolutePath).toLowerCase();

    let allRows: string[][];

    if (ext === '.csv') {
      allRows = await this.parseCsv(absolutePath);
    } else if (ext === '.json') {
      allRows = await this.parseJson(absolutePath);
    } else {
      throw new Error(`Extensión no soportada: ${ext}. Solo .csv y .json.`);
    }

    if (allRows.length === 0) {
      throw new Error('El archivo está vacío.');
    }

    // ── Detección de header ─────────────────────────────────────────────────
    const headerDetection = this.detectHeader(allRows);

    const headerRow = headerDetection.hasHeader ? allRows[0] : null;
    const dataRows = headerDetection.hasHeader ? allRows.slice(1) : allRows;

    if (dataRows.length === 0) {
      throw new Error('El archivo no contiene filas de datos (solo encabezado).');
    }

    const sample = dataRows.slice(0, SAMPLE_SIZE);

    // ── Perfilado estadístico ───────────────────────────────────────────────
    const profiling = this.profileColumns(sample);

    // ── Inferencia de tipos ─────────────────────────────────────────────────
    const inferredTypes = this.inferTypes(profiling);

    this.logger.log(
      `✅ Fase 1 completa — ${dataRows.length} filas, ${profiling.length} columnas, ` +
      `header=${headerDetection.hasHeader} (conf=${headerDetection.confidence.toFixed(2)})`,
    );

    return {
      rawRows: dataRows,
      sample,
      headerRow,
      headerDetection,
      profiling,
      inferredTypes,
    };
  }

  // ─── Parseo CSV ────────────────────────────────────────────────────────────

  private async parseCsv(absolutePath: string): Promise<string[][]> {
    const content = await fs.readFile(absolutePath, 'utf-8');

    const records: string[][] = csvParse(content, {
      skip_empty_lines: true,
      relax_column_count: true,   // tolera filas con columnas irregulares
      trim: true,
    });

    return records;
  }

  // ─── Parseo JSON ───────────────────────────────────────────────────────────

  private async parseJson(absolutePath: string): Promise<string[][]> {
    const content = await fs.readFile(absolutePath, 'utf-8');
    const parsed = JSON.parse(content);

    const items: Record<string, any>[] = Array.isArray(parsed) ? parsed : [parsed];

    if (items.length === 0) return [];

    // Extraer headers de las keys del primer objeto
    const headers = Object.keys(items[0]);
    const rows: string[][] = [headers];

    for (const item of items) {
      const row = headers.map((h) => {
        const val = item[h];
        if (val === null || val === undefined) return '';
        return String(val);
      });
      rows.push(row);
    }

    return rows;
  }

  // ─── Detección de header ───────────────────────────────────────────────────

  private detectHeader(rows: string[][]): HeaderDetectionResult {
    if (rows.length < 2) {
      // Con solo una fila no podemos comparar — asumir que es header
      return { hasHeader: true, confidence: 0.5, ambiguous: true };
    }

    const firstRow = rows[0];
    const dataRows = rows.slice(1, Math.min(6, rows.length)); // hasta 5 filas para comparar

    let headerScore = 0;
    const checks = firstRow.length;

    for (let i = 0; i < firstRow.length; i++) {
      const headerCell = firstRow[i].trim();
      const dataCells = dataRows.map((r) => (r[i] ?? '').trim()).filter((v) => v !== '');

      // Señal 1: el header no parsea como número pero los datos sí
      const headerIsNotNumeric = !isNumeric(headerCell);
      const dataIsNumeric = dataCells.length > 0 && dataCells.every(isNumeric);
      if (headerIsNotNumeric && dataIsNumeric) { headerScore += 1; continue; }

      // Señal 2: el header no parsea como fecha pero los datos sí
      const headerIsNotDate = !isDate(headerCell);
      const dataIsDate = dataCells.length > 0 && dataCells.every(isDate);
      if (headerIsNotDate && dataIsDate) { headerScore += 1; continue; }

      // Señal 3: el header no parsea como boolean pero los datos sí
      const headerIsNotBool = !isBoolean(headerCell);
      const dataIsBool = dataCells.length > 0 && dataCells.every(isBoolean);
      if (headerIsNotBool && dataIsBool) { headerScore += 1; continue; }

      // Señal 4: el header parece un identificador (sin espacios, snake_case, camelCase)
      const looksLikeIdentifier = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(headerCell);
      if (looksLikeIdentifier) { headerScore += 0.7; continue; }

      // Señal 5: el header tiene longitud muy diferente a los datos (nombre de campo vs valor)
      const avgDataLen = dataCells.reduce((s, v) => s + v.length, 0) / (dataCells.length || 1);
      if (Math.abs(headerCell.length - avgDataLen) > 5) { headerScore += 0.3; }
    }

    const confidence = checks > 0 ? headerScore / checks : 0;
    const hasHeader = confidence >= HEADER_CONFIDENCE_THRESHOLD;
    const ambiguous = confidence < HEADER_CONFIDENCE_THRESHOLD;

    return { hasHeader, confidence: Math.min(confidence, 1), ambiguous };
  }

  // ─── Perfilado estadístico ─────────────────────────────────────────────────

  private profileColumns(sample: string[][]): ColumnProfile[] {
    if (sample.length === 0) return [];

    const numCols = Math.max(...sample.map((r) => r.length));
    const profiles: ColumnProfile[] = [];

    for (let col = 0; col < numCols; col++) {
      const values = sample.map((row) => row[col] ?? '');
      const nonEmpty = values.filter((v) => v.trim() !== '');

      const lengths = nonEmpty.map((v) => v.length);
      const distinctSet = new Set(nonEmpty);

      const numericCount = nonEmpty.filter(isNumeric).length;
      const dateCount = nonEmpty.filter(isDate).length;
      const boolCount = nonEmpty.filter(isBoolean).length;
      const leadingZeroCount = nonEmpty.filter(hasLeadingZero).length;

      profiles.push({
        index: col,
        sampleValues: values,
        distinctCount: distinctSet.size,
        nullCount: values.length - nonEmpty.length,
        avgLength: lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0,
        minLength: lengths.length > 0 ? Math.min(...lengths) : 0,
        maxLength: lengths.length > 0 ? Math.max(...lengths) : 0,
        numericRatio: nonEmpty.length > 0 ? numericCount / nonEmpty.length : 0,
        dateRatio: nonEmpty.length > 0 ? dateCount / nonEmpty.length : 0,
        booleanRatio: nonEmpty.length > 0 ? boolCount / nonEmpty.length : 0,
        hasLeadingZeros: leadingZeroCount > 0,
      });
    }

    return profiles;
  }

  // ─── Inferencia de tipos ───────────────────────────────────────────────────

  private inferTypes(profiling: ColumnProfile[]): Record<number, FieldType> {
    const result: Record<number, FieldType> = {};

    for (const col of profiling) {
      result[col.index] = this.inferColumnType(col);
    }

    return result;
  }

  private inferColumnType(col: ColumnProfile): FieldType {
    // Regla 1: leading zeros → siempre string (SKU-001, códigos postales, etc.)
    if (col.hasLeadingZeros) return FieldType.STRING;

    // Regla 2: mayoría numérica
    if (col.numericRatio > 0.95) return FieldType.NUMBER;

    // Regla 3: mayoría fechas (verificar antes que string — fechas no son numéricas)
    if (col.dateRatio > 0.9) return FieldType.DATE;

    // Regla 4: mayoría booleanos
    if (col.booleanRatio > 0.9) return FieldType.BOOLEAN;

    // Default
    return FieldType.STRING;
  }
}