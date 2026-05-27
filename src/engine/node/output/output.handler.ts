// ─────────────────────────────────────────────────────────────────────────────
// engine/node/output/output.handler.ts
// ─────────────────────────────────────────────────────────────────────────────

import { Logger } from '@nestjs/common';
import { RunnerContext, NodeResult } from '../node.service';
import { ChatGroqService } from '../../groq/chatGroq.service';
import { DataResolverService, ResolvedDocument, ResolveParams } from './dataResolver.service';
import { FormState } from '../../engine.types';

const logger = new Logger('OutputNodeHandler');
const DEFAULT_PAGE_SIZE = 5;

export async function runOutputNode(
  ctx: RunnerContext,
  groq: ChatGroqService,
  dataResolver: DataResolverService,
): Promise<NodeResult> {
  const { data } = ctx.node;
  const { session } = ctx;

  const templateMode: 'raw' | 'message' | 'list' = data.templateMode ?? 'raw';
  const pageSize: number = data.pageSize ?? DEFAULT_PAGE_SIZE;
  const pageKey = `__page_${ctx.node.id}`;

  logger.log(`[ENTRY] nodeId="${ctx.node.id}" templateMode="${templateMode}" userMessage="${ctx.userMessage}"`);

  // ── Paginación activa ─────────────────────────────────────────────────────
  if (pageKey in session.formState) {
    logger.log(`[PAGINATION] pageKey="${pageKey}" currentValue=${session.formState[pageKey]}`);
    const wantsMore = await detectMoreRequest(ctx, groq);
    logger.log(`[PAGINATION] wantsMore=${wantsMore}`);
    if (wantsMore) {
      session.formState[pageKey] = ((session.formState[pageKey] as number) ?? 1) + 1;
    } else {
      delete session.formState[pageKey];
      return {
        message: '¿En qué más puedo ayudarte?',
        data: {},
        done: true,
        nextNodeId: ctx.node.branches?.['success'] ?? ctx.node.next?.[0],
      };
    }
  } else {
    session.formState[pageKey] = 1;
  }

  const currentPage = session.formState[pageKey] as number;

  // ── rawCall #1: estrategia de búsqueda ────────────────────────────────────
  logger.log(`[STRATEGY] Llamando decideSearchStrategy...`);
  const searchDecision = await decideSearchStrategy(ctx, groq);
  logger.log(`[STRATEGY] result=${JSON.stringify(searchDecision)}`);

  // ── Resolver documentos (incluye re-ranking LLM para búsqueda semántica) ──
  logger.log(`[RESOLVE] Llamando dataResolver.resolve() page=${currentPage}...`);
  let resolved: ResolvedDocument[];
  try {
    resolved = await dataResolver.resolve({
      companyId:         session.company_id,
      schemes:           data.schemes ?? [],
      globalCriteria:    data.globalCriteria ?? [],
      formState:         session.formState,
      searchQuery:       searchDecision.searchQuery ?? undefined,
      useSemanticSearch: searchDecision.useSemanticSearch,
      page:              currentPage,
      pageSize,
    } satisfies ResolveParams);
    logger.log(
      `[RESOLVE] OK — schemas=${resolved.length} ` +
      `totalDocs=${resolved.reduce((s, r) => s + r.documents.length, 0)} ` +
      `(post re-ranking)`,
    );
  } catch (err: any) {
    logger.error(`[RESOLVE] ERROR: ${err.message}`);
    delete session.formState[pageKey];
    return errorResult(ctx, data, session.formState);
  }

  const totalDocs = resolved.reduce((sum, r) => sum + r.documents.length, 0);

  // ── Sin resultados ────────────────────────────────────────────────────────
  if (totalDocs === 0) {
    logger.log(`[EMPTY] Sin resultados — emptyFallbackEnabled=${data.emptyFallbackEnabled}`);
    delete session.formState[pageKey];

    const rawEmptyMsg = data.emptyFallbackEnabled
      ? (data.emptyFallbackMessage ?? 'No encontré resultados para tu búsqueda.')
      : 'No encontré resultados para tu búsqueda.';
    const emptyMsg = resolveTemplate(rawEmptyMsg, session.formState);

    return {
      message: emptyMsg,
      data: {},
      done: true,
      nextNodeId: ctx.node.branches?.['empty'] ?? ctx.node.next?.[0],
    };
  }

  const hasMore = resolved.some(r => r.hasMore);
  const successNextId = ctx.node.branches?.['success'] ?? ctx.node.next?.[0];

  // ── templateMode: raw ─────────────────────────────────────────────────────
  if (templateMode === 'raw') {
    logger.log(`[FORMAT] templateMode=raw → JSON directo, sin LLM`);
    if (!hasMore) delete session.formState[pageKey];
    return {
      message: JSON.stringify(
        resolved.map(r => ({ schemaId: r.schemaId, results: r.documents })),
        null, 2,
      ),
      data: {},
      done: !hasMore,
      nextNodeId: hasMore ? undefined : successNextId,
    };
  }

  // ── templateMode: list | message ──────────────────────────────────────────
  const outputTemplate = (data.outputTemplate ?? '').trim();
  const documents      = resolved.flatMap(r => r.documents);

  logger.log(`[FORMAT] templateMode="${templateMode}" outputTemplate="${outputTemplate}" docs=${documents.length}`);
  logger.log(`[FORMAT] Llamando formatWithTemplate (rawCall #2)...`);

  const llmFormatted = await formatWithTemplate(groq, documents, templateMode, outputTemplate, hasMore);

  logger.log(`[FORMAT] rawCall resultado: ${llmFormatted === null ? 'NULL → usando fallback determinístico' : `OK (${llmFormatted.length} chars)`}`);

  const finalMessage = llmFormatted
    ?? buildDeterministicFallback(documents, outputTemplate, templateMode);

  logger.log(`[RESULT] finalMessage="${finalMessage.substring(0, 120)}..." hasMore=${hasMore}`);

  if (hasMore) {
    return { message: finalMessage, data: {}, done: false, nextNodeId: undefined };
  }

  delete session.formState[pageKey];
  return { message: finalMessage, data: {}, done: true, nextNodeId: successNextId };
}

// ─────────────────────────────────────────────────────────────────────────────
// rawCall #0 — ¿el usuario pide ver más?
// ─────────────────────────────────────────────────────────────────────────────

async function detectMoreRequest(ctx: RunnerContext, groq: ChatGroqService): Promise<boolean> {
  logger.log(`[detectMoreRequest] userMessage="${ctx.userMessage}"`);
  const result = await groq.rawCall<{ wantsMore: boolean }>(
    `Analiza si el usuario quiere ver más resultados. Responde SOLO con JSON:
{"wantsMore": true}   ← quiere ver más, continuar, siguiente, más opciones
{"wantsMore": false}  ← cualquier otro caso`,
    ctx.userMessage,
  );
  logger.log(`[detectMoreRequest] rawCall result=${JSON.stringify(result)}`);
  return result?.wantsMore === true;
}

// ─────────────────────────────────────────────────────────────────────────────
// rawCall #1 — decidir estrategia
// ─────────────────────────────────────────────────────────────────────────────

async function decideSearchStrategy(
  ctx: RunnerContext,
  groq: ChatGroqService,
): Promise<{ useSemanticSearch: boolean; searchQuery: string | null }> {
  const safeUserMessage = ctx.userMessage?.trim();
  if (!safeUserMessage || safeUserMessage === '?') {
    logger.warn(`[decideSearchStrategy] userMessage inválido ("${ctx.userMessage}") → forzando listing`);
    return { useSemanticSearch: false, searchQuery: null };
  }

  logger.log(`[decideSearchStrategy] userMessage="${safeUserMessage}"`);

 const result = await groq.rawCall<{
  queryType: 'listing' | 'semantic';
  searchQuery: string | null;
  expandedQuery: string | null;
}>(
  `Decide cómo buscar en un catálogo según el mensaje del usuario.

Responde SOLO con JSON. Dos casos posibles:

CASO 1 — el usuario menciona algo específico que busca:
{"queryType": "semantic", "searchQuery": "<término original>", "expandedQuery": "<términos expandidos>"}

Para expandedQuery:
- Si el usuario mencionó un nombre exacto de producto o ítem → repite el mismo término sin expandir.
- Si el usuario describió una funcionalidad, uso, síntoma, característica o necesidad
  en lugar de un nombre concreto → expande con nombres de productos, categorías,
  sinónimos y términos técnicos del dominio que podrían satisfacer esa necesidad.
  Usa tu conocimiento general para inferir qué productos o ítems resuelven lo que el usuario necesita.

CASO 2 — el usuario quiere ver todo el catálogo o no especifica qué busca:
{"queryType": "listing", "searchQuery": null, "expandedQuery": null}`,
  safeUserMessage,
);

  logger.log(`[decideSearchStrategy] rawCall result=${JSON.stringify(result)}`);

  if (!result?.queryType) {
    logger.warn(`[decideSearchStrategy] Respuesta inválida del LLM, usando listing por defecto`);
    return { useSemanticSearch: false, searchQuery: null };
  }

  // Usar expandedQuery para el embedding si está disponible, si no el searchQuery original
  const finalQuery = result.expandedQuery?.trim() || result.searchQuery;

  logger.log(`[decideSearchStrategy] finalQuery="${finalQuery}" (expandedQuery="${result.expandedQuery ?? 'null'}")`);

  return {
    useSemanticSearch: result.queryType === 'semantic',
    searchQuery: finalQuery,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// rawCall #2 — formatear con template
// ─────────────────────────────────────────────────────────────────────────────

async function formatWithTemplate(
  groq: ChatGroqService,
  documents: Record<string, any>[],
  templateMode: 'message' | 'list',
  outputTemplate: string,
  hasMore: boolean,
): Promise<string | null> {
  const dataJson = JSON.stringify(documents, null, 2);
  const moreHint = hasMore
    ? '\nTermina preguntando al usuario si desea ver más resultados.'
    : '';

  const systemPrompt = templateMode === 'list'
    ? buildListPrompt(dataJson, outputTemplate, moreHint)
    : buildMessagePrompt(dataJson, outputTemplate, moreHint);

  logger.log(`[formatWithTemplate] Enviando rawCall — templateMode="${templateMode}" docs=${documents.length}`);

  const result = await groq.rawCall<{ message: string }>(systemPrompt);

  logger.log(`[formatWithTemplate] rawCall result=${JSON.stringify(result)}`);

  if (typeof result?.message !== 'string' || !result.message.trim()) {
    logger.warn(`[formatWithTemplate] LLM devolvió message inválido: ${JSON.stringify(result)}`);
    return null;
  }

  return result.message.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────────────────────

function buildListPrompt(dataJson: string, outputTemplate: string, moreHint: string): string {
  const templateSection = outputTemplate
    ? `PLANTILLA POR ÍTEM (aplícala a cada objeto, reemplaza \${campo} con su valor):
"${outputTemplate}"

Ejemplo — si la plantilla es "\${nombre} — \${miligramos}mg" y hay 3 items:
1. acetaminofen — 100mg
2. aspirina — 200mg
3. dolex — 200mg`
    : `Genera una lista numerada clara. Por cada ítem muestra todos sus campos disponibles.`;

  return `Eres un formateador de datos. Tu ÚNICA tarea es convertir el JSON en una lista legible.

DATOS A FORMATEAR:
${dataJson}

${templateSection}

REGLAS:
- Usa ÚNICAMENTE los datos del JSON. Jamás inventes valores.
- No expliques nada. No hagas preguntas. Solo la lista.
- Numera los ítems (1. 2. 3. …).${moreHint}

Responde ÚNICAMENTE con este JSON (sin markdown, sin texto extra):
{"message": "<lista formateada aquí>"}`;
}

function buildMessagePrompt(dataJson: string, outputTemplate: string, moreHint: string): string {
  const templateSection = outputTemplate
    ? `PLANTILLA (usa el primer resultado, reemplaza \${campo} con su valor):
"${outputTemplate}"`
    : `Presenta la información del primer resultado de forma natural y concisa.`;

  return `Eres un formateador de datos. Tu ÚNICA tarea es presentar esta información.

DATOS:
${dataJson}

${templateSection}

REGLAS:
- Usa ÚNICAMENTE los datos del JSON. Jamás inventes valores.
- No hagas preguntas adicionales.${moreHint}

Responde ÚNICAMENTE con este JSON (sin markdown, sin texto extra):
{"message": "<respuesta formateada aquí>"}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback determinístico — cuando rawCall retorna null
// ─────────────────────────────────────────────────────────────────────────────

function buildDeterministicFallback(
  documents: Record<string, any>[],
  outputTemplate: string,
  templateMode: 'message' | 'list',
): string {
  if (!documents.length) return 'No se encontraron resultados.';

  if (outputTemplate) {
    if (templateMode === 'message') return applyTemplate(outputTemplate, documents[0]);
    return documents.map((doc, i) => `${i + 1}. ${applyTemplate(outputTemplate, doc)}`).join('\n');
  }

  return documents
    .map((doc, i) => {
      const fields = Object.entries(doc)
        .filter(([k]) => k !== '_id' && !k.startsWith('__'))
        .map(([k, v]) => `   ${k}: ${v}`)
        .join('\n');
      return `${i + 1}.\n${fields}`;
    })
    .join('\n\n');
}

function applyTemplate(template: string, doc: Record<string, any>): string {
  const data = doc.data ?? doc;
  return template.replace(/\$\{(\w+)\}/g, (_, key) => {
    const val = data[key] ?? doc[key];
    return val !== undefined && val !== null ? String(val) : `[${key}]`;
  });
}

// Interpolar variables ${form.X} en strings del outputNode
function resolveTemplate(template: string, formState: FormState): string {
  return template.replace(/\$\{form\.(\w+)\}/g, (_, key) => {
    const value = formState[key];
    return value !== null && value !== undefined ? String(value) : `[${key}]`;
  });
}

function errorResult(
  ctx: RunnerContext,
  data: Record<string, any>,
  formState: FormState,
): NodeResult {
  const rawMsg = data.emptyFallbackEnabled
    ? (data.emptyFallbackMessage ?? 'Ocurrió un error buscando los datos.')
    : 'Ocurrió un error buscando los datos. Intenta de nuevo.';
  return {
    message: resolveTemplate(rawMsg, formState),
    data: {},
    done: true,
    nextNodeId: ctx.node.branches?.['empty'] ?? ctx.node.next?.[0],
  };
}