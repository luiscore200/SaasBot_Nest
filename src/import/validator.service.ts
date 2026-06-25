import { Injectable, Logger } from '@nestjs/common';
import { FieldDefinition } from './import.types';
import { CoercedRow, CoercionSummary, coerceSample } from './typeCoercion.util';
import { SchemaInferenceService } from './inference.service';

const ERROR_THRESHOLD = 0.15;
const MAX_ATTEMPTS    = 2;

// ─── Tipos ───────────────────────────────────────────────────────────────────


export interface Phase3Result {
  schema: FieldDefinition[];
  validatedSample: CoercedRow[];
  totalRows: number;
  errorRatio: number;
  records: CoercedRow[];          // filas con al menos 1 error
  warnings: string[];
  reformulationAttempts: number;  // 0, 1 o 2
}

// ─── Servicio ─────────────────────────────────────────────────────────────────

@Injectable()
export class SchemaValidatorService {
  private readonly logger = new Logger(SchemaValidatorService.name);

  constructor(private readonly schemaInference: SchemaInferenceService) {}

  async validate(
    sample: string[][],
    initialFields: FieldDefinition[],
    form: { name: string; description?: string },
  ): Promise<Phase3Result> {
    let fields = initialFields;
    let summary: CoercionSummary;
    let attempts = 0;
    const warnings: string[] = [];

    // ── Intento inicial ───────────────────────────────────────────────────
    summary = coerceSample(sample, fields);

    this.logger.log(
      `🔎 Fase 3 — intento ${attempts} — errorRatio=${(summary.errorRatio * 100).toFixed(1)}% ` +
      `(${summary.totalFieldErrors} errores de campo en ${summary.totalRows} filas)`,
    );

    // ── Ciclo de reformulación ────────────────────────────────────────────
    while (summary.errorRatio > ERROR_THRESHOLD && attempts < MAX_ATTEMPTS) {
      attempts++;

      this.logger.warn(
        `⚠️  errorRatio ${(summary.errorRatio * 100).toFixed(1)}% > 15% — reformulando (intento ${attempts}/${MAX_ATTEMPTS})`,
      );

      // Construir contexto de errores para el LLM
      const errorContext = this.buildErrorContext(summary.records, fields);

      // Pedir al LLM un schema corregido
      fields = await this.schemaInference.reformulate(fields, errorContext, form);

      // Recoercionar con el schema nuevo
      summary = coerceSample(sample, fields);

      this.logger.log(
        `🔄 Tras reformulación ${attempts} — errorRatio=${(summary.errorRatio * 100).toFixed(1)}%`,
      );
    }

    // ── Warnings finales ──────────────────────────────────────────────────
    if (attempts > 0) {
      warnings.push(
        `El schema fue reformulado ${attempts} vez${attempts > 1 ? 'es' : ''} automáticamente.`,
      );
    }

    if (summary.errorRatio > ERROR_THRESHOLD) {
      warnings.push(
        `Aún hay un ${(summary.errorRatio * 100).toFixed(1)}% de errores tras ${attempts} intento${attempts > 1 ? 's' : ''} de corrección. ` +
        `Revisa los registros con problemas antes de confirmar.`,
      );
    }

    if (summary.records.length > 0) {
      warnings.push(
        `${summary.records.length} de ${summary.totalRows} filas tienen al menos un campo con problema.`,
      );
    }

    this.logger.log(
      `✅ Fase 3 completa — errorRatio=${(summary.errorRatio * 100).toFixed(1)}% ` +
      `records=${summary.records.length}/${summary.totalRows} reformulaciones=${attempts}`,
    );

    return {
      schema: fields,
      validatedSample: summary.validatedSample,
      totalRows: summary.totalRows,
      errorRatio: summary.errorRatio,
      records: summary.records,
      warnings,
      reformulationAttempts: attempts,
    };
  }

  // ─── Helper: construir resumen de errores para el LLM ────────────────────

  private buildErrorContext(
    records: CoercedRow[],
    fields: FieldDefinition[],
  ): string {
    // Agrupar errores por campo
    const byField = new Map<string, { expectedType: string; examples: string[] }>();

    for (const row of records) {
      for (const err of row.errors) {
        if (!byField.has(err.field)) {
          byField.set(err.field, { expectedType: err.expectedType, examples: [] });
        }
        const entry = byField.get(err.field)!;
        if (entry.examples.length < 3) {
          entry.examples.push(err.value);
        }
      }
    }

    const lines: string[] = [
      `Schema actual: ${JSON.stringify(fields.map((f) => ({ name: f.name, type: f.type })))}`,
      ``,
      `Errores encontrados al coercionar la muestra:`,
    ];

    for (const [fieldName, info] of byField.entries()) {
      lines.push(
        `- Campo "${fieldName}" (tipo actual: ${info.expectedType}): ` +
        `valores que fallaron → ${info.examples.map((v) => `"${v}"`).join(', ')}`,
      );
    }

    return lines.join('\n');
  }
}