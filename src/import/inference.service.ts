import { Injectable, Logger } from '@nestjs/common';
import { GroqService } from 'src/groq/groq.service';
import { GroqTool, GroqMessage } from 'src/groq/groq.types';
import { Phase1Result } from './parser.service';
import { FieldDefinition } from './import.types';
import { FieldType, SchemaCategory } from 'src/data/schemas/dto/create-schema.dto';

// ─── Tipos de salida ──────────────────────────────────────────────────────────

export interface Phase2Result {
  category: SchemaCategory;
  fields: FieldDefinition[];
  resolvedHeader: boolean;
}

// ─── Tool 1: inferencia inicial (category + nombres) ─────────────────────────

const INFER_SCHEMA_TOOL: GroqTool = {
  type: 'function',
  function: {
    name: 'infer_schema',
    description:
      'Infiere la categoría del dataset y asigna nombres semánticos a cada columna.',
    parameters: {
      type: 'object',
      required: ['category', 'columns'],
      properties: {
        category: {
          type: 'string',
          enum: ['inventory', 'schedule'],
          description:
            '"inventory" para productos/stock/artículos. "schedule" para citas/eventos/agenda.',
        },
        columns: {
          type: 'array',
          description: 'Un objeto por columna, en el mismo orden del archivo.',
          items: {
            type: 'object',
            required: ['index', 'name'],
            properties: {
              index: { type: 'number', description: 'Índice 0-based de la columna.' },
              name: {
                type: 'string',
                description: 'Nombre semántico en snake_case. Ej: codigo_producto, fecha_ingreso.',
              },
            },
          },
        },
      },
    },
  },
};

// ─── Tool 2: reformulación (solo corrige tipos) ───────────────────────────────

const REFORMULATE_SCHEMA_TOOL: GroqTool = {
  type: 'function',
  function: {
    name: 'reformulate_schema',
    description:
      'Corrige los tipos de los campos que están fallando en la coerción. Solo cambia tipos, no nombres.',
    parameters: {
      type: 'object',
      required: ['fields'],
      properties: {
        fields: {
          type: 'array',
          description: 'Lista completa de campos con sus tipos corregidos.',
          items: {
            type: 'object',
            required: ['name', 'type'],
            properties: {
              name: { type: 'string', description: 'Nombre exacto del campo (no cambiar).' },
              type: {
                type: 'string',
                enum: ['string', 'number', 'boolean', 'date', 'json'],
                description: 'Tipo corregido del campo.',
              },
            },
          },
        },
      },
    },
  },
};

// ─── Servicio ─────────────────────────────────────────────────────────────────

@Injectable()
export class SchemaInferenceService {
  private readonly logger = new Logger(SchemaInferenceService.name);

  constructor(private readonly groq: GroqService) {}

  // ─── Fase 2: inferencia inicial ───────────────────────────────────────────

  async infer(
    phase1: Phase1Result,
    form: { name: string; description?: string },
  ): Promise<Phase2Result> {
    const { headerDetection, headerRow, profiling, inferredTypes, sample } = phase1;

    const columnsContext = profiling.map((col) => ({
      index: col.index,
      headerHint: headerRow ? (headerRow[col.index] ?? null) : null,
      inferredType: inferredTypes[col.index],
      exampleValues: col.sampleValues.filter((v) => v.trim() !== '').slice(0, 5),
      stats: {
        nullCount: col.nullCount,
        distinctCount: col.distinctCount,
        hasLeadingZeros: col.hasLeadingZeros,
      },
    }));

    const messages: GroqMessage[] = [
      {
        role: 'system',
        content: [
          'Eres un experto en análisis de datos tabulares.',
          'Asigna nombres semánticos claros a cada columna e infiere la categoría del dataset.',
          'Reglas:',
          '- Nombres en snake_case, en español preferiblemente.',
          '- No inventes campos que no existan en los datos.',
          '- No propongas campos "id", "uuid", "timestamp" ni "batch_id".',
          '- Usa el headerHint como pista si existe, mejóralo si es genérico.',
          '- Si no hay headerHint, infiere el nombre desde los valores de ejemplo.',
          '- Debes llamar OBLIGATORIAMENTE a la función infer_schema.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify({
          tableName: form.name,
          tableDescription: form.description ?? null,
          hasHeader: headerDetection.hasHeader,
          headerAmbiguous: headerDetection.ambiguous,
          totalColumns: profiling.length,
          columns: columnsContext,
          sampleRows: sample.slice(0, 5),
        }),
      },
    ];

    this.logger.log(
      `🤖 Fase 2 — llamando a Groq (${profiling.length} columnas, header=${headerDetection.hasHeader})`,
    );

    const result = await this.groq.chatWithTools(messages, [INFER_SCHEMA_TOOL], {
      toolChoice: 'infer_schema',
      temperature: 0.1,
      maxCompletionTokens: 1024,
    });

    if (!result.toolCalls?.length) {
      throw new Error('Groq no devolvió ninguna tool call en inferencia inicial.');
    }

    let parsed: { category: string; columns: { index: number; name: string }[] };
    try {
      parsed = JSON.parse(result.toolCalls[0].function.arguments);
    } catch {
      throw new Error(`Groq devolvió argumentos inválidos: ${result.toolCalls[0].function.arguments}`);
    }

    const validCategories = Object.values(SchemaCategory) as string[];
    if (!validCategories.includes(parsed.category)) {
      throw new Error(`Categoría inválida recibida del LLM: "${parsed.category}"`);
    }

    const columnNameMap = new Map<number, string>(
      parsed.columns.map((c) => [c.index, c.name]),
    );

    const fields: FieldDefinition[] = profiling.map((col) => ({
      name: columnNameMap.get(col.index) ?? `columna_${col.index}`,
      type: inferredTypes[col.index] ?? FieldType.STRING,
      required: false,
      unique: false,
    }));

    this.logger.log(
      `✅ Fase 2 completa — category="${parsed.category}" fields=[${fields.map((f) => `${f.name}:${f.type}`).join(', ')}]`,
    );

    return {
      category: parsed.category as SchemaCategory,
      fields,
      resolvedHeader: headerDetection.ambiguous,
    };
  }

  // ─── Fase 3: reformulación de tipos ──────────────────────────────────────

  async reformulate(
    currentFields: FieldDefinition[],
    errorContext: string,
    form: { name: string; description?: string },
  ): Promise<FieldDefinition[]> {
    const messages: GroqMessage[] = [
      {
        role: 'system',
        content: [
          'Eres un experto en análisis de datos tabulares.',
          'Se te da un schema con errores de coerción encontrados al validar los datos reales.',
          'Tu tarea es corregir ÚNICAMENTE los tipos de los campos problemáticos.',
          'Reglas estrictas:',
          '- Devuelve TODOS los campos, no solo los que cambian.',
          '- No cambies los nombres de los campos.',
          '- No elimines ni añadas campos.',
          '- Si un campo numérico tiene texto mezclado, cámbialo a "string".',
          '- Si una fecha tiene formatos irreconocibles, cámbiala a "string".',
          '- Debes llamar OBLIGATORIAMENTE a la función reformulate_schema.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify({
          tableName: form.name,
          tableDescription: form.description ?? null,
          errorReport: errorContext,
        }),
      },
    ];

    this.logger.log(`🔄 Reformulando schema con Groq...`);

    const result = await this.groq.chatWithTools(messages, [REFORMULATE_SCHEMA_TOOL], {
      toolChoice: 'reformulate_schema',
      temperature: 0.1,
      maxCompletionTokens: 1024,
    });

    if (!result.toolCalls?.length) {
      throw new Error('Groq no devolvió tool call en reformulación.');
    }

    let parsed: { fields: { name: string; type: string }[] };
    try {
      parsed = JSON.parse(result.toolCalls[0].function.arguments);
    } catch {
      throw new Error('Groq devolvió argumentos inválidos en reformulación.');
    }

    // Construir mapa name→type desde la respuesta
    const typeMap = new Map<string, FieldType>(
      parsed.fields.map((f) => [f.name, f.type as FieldType]),
    );

    // Aplicar tipos corregidos manteniendo el resto del campo intacto
    const reformulated: FieldDefinition[] = currentFields.map((field) => ({
      ...field,
      type: typeMap.get(field.name) ?? field.type,
    }));

    const changes = reformulated
      .filter((f, i) => f.type !== currentFields[i].type)
      .map((f) => `${f.name}: ${currentFields.find(c => c.name === f.name)?.type} → ${f.type}`);

    if (changes.length > 0) {
      this.logger.log(`✅ Reformulación — cambios: ${changes.join(', ')}`);
    } else {
      this.logger.warn(`⚠️  Reformulación sin cambios de tipo`);
    }

    return reformulated;
  }
}