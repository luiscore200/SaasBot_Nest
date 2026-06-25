import { FieldType } from 'src/data/schemas/dto/create-schema.dto';
import { FieldDefinition } from './import.types';
import { normalizeNumeric } from './parser.service';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface FieldError {
  field: string;
  value: string;
  expectedType: FieldType;
  reason: string;
}

export interface CoercedRow {
  rowIndex: number;
  data: Record<string, any>;  // valores coercionados exitosos (campos con error quedan como null)
  errors: FieldError[];
}

// ─── Booleanos aceptados ──────────────────────────────────────────────────────

const BOOLEAN_TRUE  = new Set(['true', 'yes', 'si', 'sí', 'y', 'activo', 'active', 'on', '1']);
const BOOLEAN_FALSE = new Set(['false', 'no', 'n', 'inactivo', 'inactive', 'off', '0']);

// ─── Coerción de un valor individual ─────────────────────────────────────────

export function coerceValue(
  raw: string,
  type: FieldType,
): { value: any; error: string | null } {
  const trimmed = raw?.trim() ?? '';

  // Vacío — se acepta como null (required se valida en otro punto)
  if (trimmed === '') return { value: null, error: null };

  switch (type) {
    case FieldType.STRING:
      return { value: trimmed, error: null };

    case FieldType.NUMBER: {
      const normalized = normalizeNumeric(trimmed);
      const n = Number(normalized);
      if (isNaN(n)) {
        return { value: null, error: `"${trimmed}" no es un número válido` };
      }
      return { value: n, error: null };
    }

    case FieldType.BOOLEAN: {
      const lower = trimmed.toLowerCase();
      if (BOOLEAN_TRUE.has(lower))  return { value: true,  error: null };
      if (BOOLEAN_FALSE.has(lower)) return { value: false, error: null };
      return { value: null, error: `"${trimmed}" no es un booleano reconocido` };
    }

    case FieldType.DATE: {
      // Rechazar strings con letras (texto libre)
      if (/[a-zA-Z]/.test(trimmed)) {
        return { value: null, error: `"${trimmed}" no es una fecha válida` };
      }
      const d = new Date(trimmed);
      if (isNaN(d.getTime())) {
        return { value: null, error: `"${trimmed}" no se puede parsear como fecha` };
      }
      return { value: d.toISOString(), error: null };
    }

    case FieldType.JSON: {
      try {
        const parsed = JSON.parse(trimmed);
        return { value: parsed, error: null };
      } catch {
        return { value: null, error: `"${trimmed}" no es un JSON válido` };
      }
    }

    default:
      return { value: trimmed, error: null };
  }
}

// ─── Coerción de una fila completa ────────────────────────────────────────────

export function coerceRow(
  rawRow: string[],
  fields: FieldDefinition[],
  rowIndex: number,
): CoercedRow {
  const data: Record<string, any> = {};
  const errors: FieldError[] = [];

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const raw = rawRow[i] ?? '';
    const { value, error } = coerceValue(raw, field.type);

    if (error) {
      errors.push({
        field: field.name,
        value: raw,
        expectedType: field.type,
        reason: error,
      });
      data[field.name] = null;
    } else {
      data[field.name] = value;
    }
  }

  return { rowIndex, data, errors };
}

// ─── Coerción de la muestra completa ─────────────────────────────────────────

export interface CoercionSummary {
  validatedSample: CoercedRow[];
  totalRows: number;
  totalFieldErrors: number;   // errores de campo individuales (para el umbral interno)
  errorRatio: number;         // totalFieldErrors / (totalRows * nCampos)
  records: CoercedRow[];      // solo filas con al menos 1 error (para el preview)
}

export function coerceSample(
  sample: string[][],
  fields: FieldDefinition[],
): CoercionSummary {
  const validatedSample: CoercedRow[] = sample.map((row, i) =>
    coerceRow(row, fields, i),
  );

  const totalRows = validatedSample.length;
  const nCampos = fields.length;
  const totalFieldErrors = validatedSample.reduce((sum, row) => sum + row.errors.length, 0);
  const errorRatio = nCampos > 0 && totalRows > 0
    ? totalFieldErrors / (totalRows * nCampos)
    : 0;

  const records = validatedSample.filter((row) => row.errors.length > 0);

  return { validatedSample, totalRows, totalFieldErrors, errorRatio, records };
}