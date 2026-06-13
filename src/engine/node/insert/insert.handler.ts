import { Logger } from '@nestjs/common';
import { RunnerContext, NodeResult } from '../node.service';
import { DocumentsService } from '../../../data/documents/documents.service';
import { PersistenceService } from '../../../common/services/percistence/persistence.service';
import { SchemaModel, SchemaModelSchema } from '../../../mongoose/schemas.schema';
import { MongoOrmService } from '../../../mongoose/mongoose.service';

const logger = new Logger('InsertNodeHandler');

export async function runInsertNode(
  ctx: RunnerContext,
  documentsService: DocumentsService,
  persistence: PersistenceService,
): Promise<NodeResult> {
  const { data, id: nodeId } = ctx.node;
  const { session } = ctx;

  const schemaName:    string = data.schemaName       ?? '';
  const schemaId:      string = data.selectedSchemaId ?? '';
  const fieldMappings: any[]  = data.fieldMappings    ?? [];
  const outputEnabled: boolean = data.outputEnabled   ?? false;
  const outputTemplate: string = data.outputTemplate  ?? '';

  logger.log(
    `[INSERT] nodeId="${nodeId}" schemaName="${schemaName}" ` +
    `schemaId="${schemaId}" mappings=${fieldMappings.length}`,
  );

  if (!schemaName || !schemaId) {
    logger.warn(`[INSERT] schemaName o schemaId vacío — abortando`);
    return errorResult(ctx);
  }

  // ── Cargar schema para saber tipos y campos auto ──────────────────────────
  let fieldTypes: Record<string, string> = {};
  try {
    const schemaModel = await persistence.getTenantModel<SchemaModel>(
      session.company_id,
      'Schema',
      SchemaModelSchema,
    );
    const schemaOrm = new MongoOrmService<SchemaModel>(schemaModel);
    const schema = await schemaOrm.findById(schemaId);
    if (schema?.fields) {
      fieldTypes = Object.fromEntries(
        schema.fields.map((f: any) => [f.name, f.type]),
      );
    }
  } catch (err: any) {
    logger.warn(`[INSERT] No se pudo cargar schema para coerción: ${err.message}`);
  }

  let documents: Record<string, any>[];
  try {
    documents = resolveDocuments(fieldMappings, session.formState, fieldTypes);
  } catch (err: any) {
    logger.error(`[INSERT] resolveDocuments ERROR: ${err.message}`);
    return errorResult(ctx);
  }

  if (!documents.length) {
    logger.warn(`[INSERT] No se generaron documentos — abortando`);
    return errorResult(ctx);
  }

  logger.log(
    `[INSERT] Insertando ${documents.length} documento(s) en "${schemaName}"\n` +
    `  docs: ${JSON.stringify(documents)}`,
  );

  // ── Insertar y capturar los docs creados para el template ─────────────────
  let createdDocs: any[] = [];
  try {
    if (documents.length === 1) {
      const created = await documentsService.createDocument(
        session.company_id, schemaId, documents[0],
      );
      createdDocs = [created];
    } else {
      const created = await documentsService.createDocuments(
        session.company_id, schemaId, documents,
      );
      createdDocs = Array.isArray(created) ? created : [created];
      logger.log(`[INSERT] createdDocs[0] keys: ${JSON.stringify(Object.keys(createdDocs[0] ?? {}))}`);
logger.log(`[INSERT] createdDocs[0]._id: ${createdDocs[0]?._id}`);
logger.log(`[INSERT] createdDocs[0].data: ${JSON.stringify(createdDocs[0]?.data)}`);
    }
    logger.log(`[INSERT] OK — ${createdDocs.length} doc(s) insertados`);
  } catch (err: any) {
    logger.error(`[INSERT] DocumentsService ERROR: ${err.message}`);
    return errorResult(ctx);
  }

  // ── Resolver mensaje de salida ────────────────────────────────────────────
  const message = resolveOutputMessage(
    outputEnabled,
    outputTemplate,
    createdDocs,
    session.formState,
  );

  return {
    message,
    data:       {},
    done:       true,
    nextNodeId: ctx.node.branches?.['success'] ?? ctx.node.next?.[0],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveOutputMessage
// ─────────────────────────────────────────────────────────────────────────────

function resolveOutputMessage(
  outputEnabled: boolean,
  outputTemplate: string,
  createdDocs: any[],
  formState: Record<string, any>,
): string {
  if (!outputEnabled || !outputTemplate.trim()) return '';

  const template = outputTemplate.trim();
  const { header, itemPattern } = parseTemplate(template);
  const hasEach = !!itemPattern;

  if (!hasEach || createdDocs.length === 1) {
    return applyTemplate(template, createdDocs[0], formState);
  }

  // ── Lote con {{#each}} ────────────────────────────────────────────────────
  // El header puede tener variables de lote (batch_id, timestamp, id del primer doc)
  // Se resuelve contra el primer doc y el formState
  const resolvedHeader = header
    ? applyTemplate(header, createdDocs[0], formState)
    : '';

  const items = createdDocs
    .map((doc, i) => applyTemplate(itemPattern, doc, formState, i + 1))
    .join('\n');

  return resolvedHeader ? `${resolvedHeader}\n${items}` : items;
}

function parseTemplate(raw: string): { header: string; itemPattern: string } {
  const match = raw.match(/([\s\S]*?)\{\{#each\}\}([\s\S]*?)\{\{\/each\}\}/);
  if (match) {
    return { header: match[1].trim(), itemPattern: match[2].trim() };
  }
  return { header: '', itemPattern: '' };
}

function toPlainDoc(doc: any): { id: string; data: Record<string, any> } {
  const raw = doc?._doc ?? (typeof doc?.toObject === 'function' ? doc.toObject() : doc);
  return {
    id:   raw?._id?.toString() ?? '',
    data: raw?.data ?? {},
  };
}

function applyTemplate(
  template: string,
  doc: any,
  formState: Record<string, any>,
  index?: number,
): string {
  const { id, data } = toPlainDoc(doc);

  return template.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
    if (key === '_id' || key === 'id') return id;
    if (key === 'index' && index !== undefined) return String(index);

    if (key.startsWith('form.')) {
      const val = formState[key.slice(5)];
      return val !== null && val !== undefined ? formatValue(val) : `[${key}]`;
    }

    const val = data[key];
    if (val !== null && val !== undefined) return formatValue(val);

    const formVal = formState[key];
    return formVal !== null && formVal !== undefined ? formatValue(formVal) : `[${key}]`;
  });
}

function formatValue(val: any): string {
  if (typeof val !== 'string') return String(val);

  // Detecta ISO 8601 — "2026-06-11T19:08:15.451Z" o "2026-06-11T19:08:15.451+00:00"
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
    const date = new Date(val);
    if (!isNaN(date.getTime())) {
      return date.toLocaleString('es-CO', {
        timeZone:    'America/Bogota',
        year:        'numeric',
        month:       'long',
        day:         'numeric',
        hour:        '2-digit',
        minute:      '2-digit',
        hour12:      true,
      });
    }
  }

  return val;
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveDocuments — sin cambios respecto al original
// ─────────────────────────────────────────────────────────────────────────────

function resolveDocuments(
  fieldMappings: Array<{ schemaField: string; source: string }>,
  formState: Record<string, any>,
  fieldTypes: Record<string, string>,
): Record<string, any>[] {

  const arrayMapping = fieldMappings.find((m) => {
    if (!m.source.startsWith('obj:')) return false;
    const varName = m.source.slice(4).split('.')[0];
    return Array.isArray(formState[varName]);
  });

  if (!arrayMapping) {
    const doc: Record<string, any> = {};
    for (const m of fieldMappings) {
      if (!m.source) continue;
      doc[m.schemaField] = coerce(
        resolveSource(m.source, formState),
        fieldTypes[m.schemaField],
      );
    }
    return [doc];
  }

  const arrayVarName = arrayMapping.source.slice(4).split('.')[0];
  const items        = formState[arrayVarName] as any[];

  return items.map((rawItem) => {
    const item = unwrapDoc(rawItem);
    const doc: Record<string, any> = {};

    for (const m of fieldMappings) {
      if (!m.source) continue;

      let raw: any;
      if (m.source.startsWith('obj:')) {
        const parts   = m.source.slice(4).split('.');
        const varName = parts[0];
        const attr    = parts.slice(1).join('.');

        if (varName === arrayVarName) {
          raw = attr ? (item[attr] ?? null) : item;
        } else {
          const other = unwrapDoc(formState[varName]);
          raw = attr ? (other?.[attr] ?? null) : other;
        }
      } else {
        raw = resolveSource(m.source, formState);
      }

      doc[m.schemaField] = coerce(raw, fieldTypes[m.schemaField]);
    }
    return doc;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — sin cambios
// ─────────────────────────────────────────────────────────────────────────────

function coerce(value: any, targetType: string | undefined): any {
  if (value === null || value === undefined) return null;
  if (!targetType) return value;
  switch (targetType) {
    case 'string':  return typeof value === 'string' ? value : String(value);
    case 'number': {
      if (typeof value === 'number') return value;
      const n = Number(value);
      return isNaN(n) ? value : n;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      return value === 'true' || value === '1' || value === true;
    case 'date':
      if (value instanceof Date) return value.toISOString();
      return typeof value === 'string' ? value : String(value);
    default: return value;
  }
}

function unwrapDoc(obj: any): Record<string, any> {
  if (
    obj && typeof obj === 'object' && !Array.isArray(obj) &&
    obj.data && typeof obj.data === 'object'
  ) {
    return obj.data as Record<string, any>;
  }
  return obj ?? {};
}

function resolveSource(source: string, formState: Record<string, any>): any {
  if (!source) return null;
  if (source === 'auto:now')   return new Date().toISOString();
  if (source === 'auto:order') return (formState['__order_date'] as string | undefined) ?? new Date().toISOString();
  if (source.startsWith('form:')) return formState[source.slice(5)] ?? null;
  if (source.startsWith('obj:')) {
    const parts   = source.slice(4).split('.');
    const varName = parts[0];
    const attr    = parts.slice(1).join('.');
    const raw     = formState[varName];
    if (Array.isArray(raw)) return raw;
    const obj = unwrapDoc(raw);
    return attr ? (obj?.[attr] ?? null) : obj;
  }
  return null;
}

function errorResult(ctx: RunnerContext): NodeResult {
  return {
    message:    '',
    data:       {},
    done:       true,
    nextNodeId: ctx.node.branches?.['error'] ?? ctx.node.next?.[0],
  };
}