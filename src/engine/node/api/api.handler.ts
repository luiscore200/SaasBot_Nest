// engine/node/api/api.handler.ts
import { Logger } from '@nestjs/common';
import { RunnerContext, NodeResult } from '../node.service';

const logger = new Logger('ApiNodeHandler');

export async function runApiNode(ctx: RunnerContext): Promise<NodeResult> {
  const { data, id: nodeId } = ctx.node;
  const { session } = ctx;

  const url:         string = data.url         ?? '';
  const bodyFields:  any[]  = data.bodyFields  ?? [];
  const responseVar: string = data.responseVar ?? '';

  logger.log(`[API] nodeId="${nodeId}" url="${url}" fields=${bodyFields.length}`);

  if (!url) {
    logger.warn(`[API] URL vacía — abortando`);
    return errorResult(ctx);
  }

  // ── Construir body ────────────────────────────────────────────────────────
  const body: Record<string, any> = {};

  for (const field of bodyFields) {
    body[field.fieldName] = resolveSource(field.source, session.formState, field.fieldType);
  }

  logger.log(`[API] body=${JSON.stringify(body)}`);

  // ── POST ──────────────────────────────────────────────────────────────────
  let responseData: any;
  try {
    const response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!response.ok) {
      logger.error(`[API] HTTP ${response.status} ${response.statusText}`);
      return errorResult(ctx);
    }

    const contentType = response.headers.get('content-type') ?? '';
    responseData = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    logger.log(`[API] respuesta OK — tipo=${contentType}`);
  } catch (err: any) {
    logger.error(`[API] fetch ERROR: ${err.message}`);
    return errorResult(ctx);
  }

  // ── Guardar respuesta en formState ────────────────────────────────────────
  const extraData: Record<string, any> = {};
  if (responseVar && responseData !== undefined) {
    extraData[responseVar] = responseData;
    logger.log(`[API] responseVar="${responseVar}" guardado en formState`);
  }

  return {
    message:    '',
    data:       extraData,
    done:       true,
    nextNodeId: ctx.node.branches?.['success'] ?? ctx.node.next?.[0],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function resolveSource(
  source: string,
  formState: Record<string, any>,
  fieldType: string,
): any {
  if (!source) return null;

  if (source.startsWith('static:')) {
    return castValue(source.slice(7), fieldType);
  }

  if (source === 'auto:now') return new Date().toISOString();

  if (source.startsWith('form:')) {
    const key = source.slice(5);
    return formState[key] ?? null;
  }

  if (source.startsWith('obj:')) {
    const [varName, ...attrParts] = source.slice(4).split('.');
    const attr = attrParts.join('.');
    const obj  = formState[varName];
    if (Array.isArray(obj)) return obj.map((item) => item?.[attr] ?? null);
    return obj?.[attr] ?? null;
  }

  return null;
}

function castValue(raw: string, type: string): any {
  switch (type) {
    case 'number':  return Number(raw);
    case 'boolean': return raw === 'true';
    default:        return raw;
  }
}

function errorResult(ctx: RunnerContext): NodeResult {
  return {
    message:    '',
    data:       {},
    done:       true,
    nextNodeId: ctx.node.branches?.['error'] ?? ctx.node.next?.[0],
  };
}