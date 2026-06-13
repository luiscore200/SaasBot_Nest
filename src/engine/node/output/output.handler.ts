// ─────────────────────────────────────────────────────────────────────────────
// engine/node/output/output.handler.ts  (v4 — caché en sesión)
// ─────────────────────────────────────────────────────────────────────────────

import { Logger } from '@nestjs/common';
import { RunnerContext, NodeResult } from '../node.service';
import { ChatGroqService } from '../../groq/chatGroq.service';
import { DataResolverService, ResolvedDocument, ResolveParams } from './dataResolver.service';
import { FormState } from '../../engine.types';
import { SessionService } from '../../session/session.service';

const logger = new Logger('OutputNodeHandler');
const DEFAULT_PAGE_SIZE = 5;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de paginación múltiple
// ─────────────────────────────────────────────────────────────────────────────

export interface PaginationEntry {
  nodeId: string;
  hasMore: boolean;
  currentPage: number;
}

// Clave en formState donde se guarda el mapa de paginación (solo páginas, no docs)
const PAGINATION_KEY = '__pagination';

function getPaginationMap(formState: FormState): Record<string, number> {
  const raw = formState[PAGINATION_KEY];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, number>;
  }
  return {};
}

function setPaginationPage(formState: FormState, nodeId: string, page: number): void {
  const map = getPaginationMap(formState);
  map[nodeId] = page;
  formState[PAGINATION_KEY] = map;
}

function clearPaginationEntry(formState: FormState, nodeId: string): void {
  const map = getPaginationMap(formState);
  delete map[nodeId];
  formState[PAGINATION_KEY] = map;
}

function getCurrentPage(formState: FormState, nodeId: string): number {
  return getPaginationMap(formState)[nodeId] ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function runOutputNode(
  ctx: RunnerContext,
  groq: ChatGroqService,
  dataResolver: DataResolverService,
  sessionService: SessionService,
): Promise<NodeResult & { pagination?: PaginationEntry }> {
  const { data } = ctx.node;
  const { session } = ctx;

  const templateMode: 'raw' | 'message' | 'list' = data.templateMode ?? 'raw';
  const pageSize: number = data.pageSize ?? DEFAULT_PAGE_SIZE;
  const nodeId = ctx.node.id;

  logger.log(`[ENTRY] nodeId="${nodeId}" templateMode="${templateMode}" userMessage="${ctx.userMessage}"`);

  // ── Calcular página actual ────────────────────────────────────────────────
  const existingPage = getCurrentPage(session.formState, nodeId);
  const currentPage  = existingPage > 0 ? existingPage + 1 : 1;

  logger.log(`[PAGINATION] nodeId="${nodeId}" existingPage=${existingPage} → currentPage=${currentPage}`);

  setPaginationPage(session.formState, nodeId, currentPage);

  // ── Delegación por modo ───────────────────────────────────────────────────
  if (templateMode === 'list') {
    return runListMode(ctx, groq, dataResolver, sessionService, pageSize, currentPage);
  }

  if (templateMode === 'message') {
    return runMessageMode(ctx, groq, dataResolver);
  }

  // raw — JSON directo, sin LLM, sin template
  return runRawMode(ctx, dataResolver, pageSize, currentPage);
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST MODE — determinístico + acumulación de caché en sesión
// ─────────────────────────────────────────────────────────────────────────────

async function runListMode(
  ctx: RunnerContext,
  groq: ChatGroqService,
  dataResolver: DataResolverService,
  sessionService: SessionService,
  pageSize: number,
  currentPage: number,
): Promise<NodeResult & { pagination?: PaginationEntry }> {
  const { data, id: nodeId } = ctx.node;
  const { session } = ctx;

  let resolved: ResolvedDocument[];
  try {
    resolved = await dataResolver.resolve({
      companyId:         session.company_id,
      schemes:           data.schemes ?? [],
      globalCriteria:    data.globalCriteria ?? [],
      formState:         session.formState,
      useSemanticSearch: false,
      page:              currentPage,
      pageSize,
    } satisfies ResolveParams);
  } catch (err: any) {
    logger.error(`[LIST] resolve ERROR: ${err.message}`);
    clearPaginationEntry(session.formState, nodeId);
    return errorResult(ctx, data, session.formState);
  }

  const totalDocs = resolved.reduce((s, r) => s + r.documents.length, 0);

  if (totalDocs === 0) {
    clearPaginationEntry(session.formState, nodeId);
    const emptyMsg = resolveTemplate(
      data.emptyFallbackEnabled
        ? (data.emptyFallbackMessage ?? 'No encontré resultados.')
        : 'No encontré resultados.',
      session.formState,
    );
    return {
      message: emptyMsg,
      data: {},
      done: true,
      nextNodeId: ctx.node.branches?.['empty'] ?? ctx.node.next?.[0],
    };
  }

  const hasMore   = resolved.some(r => r.hasMore);
  const documents = resolved.flatMap(r => r.documents);
  const outputTemplate = (data.outputTemplate ?? '').trim();

  // ── Formateo determinístico para el mensaje al usuario ───────────────────
  const message = buildDeterministicList(documents, outputTemplate);
  logger.log(`[LIST] determinístico — docs=${documents.length} hasMore=${hasMore}`);

  // ── Acumular documentos CRUDOS en el caché de la sesión ──────────────────
  // Se guardan sin template, sin formatear — el inputNode con extractFromNodeId
  // los recibe tal cual para que el LLM pueda extraer campos específicos.
  sessionService.appendOutputCache(session.sessionId, nodeId, documents);

  if (!hasMore) {
    clearPaginationEntry(session.formState, nodeId);
  }

  const successNextId = ctx.node.branches?.['success'] ?? ctx.node.next?.[0];

  return {
    message,
    data:       {},
    done:       true,
    nextNodeId: successNextId,
    pagination: hasMore
      ? { nodeId, hasMore: true, currentPage }
      : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE MODE — búsqueda semántica + LLM escrutina coherencia + template
// ─────────────────────────────────────────────────────────────────────────────

async function runMessageMode(
  ctx: RunnerContext,
  groq: ChatGroqService,
  dataResolver: DataResolverService,
): Promise<NodeResult & { pagination?: PaginationEntry }> {
  const { data, id: nodeId } = ctx.node;
  const { session } = ctx;

  clearPaginationEntry(session.formState, nodeId); // message nunca pagina

  // ── 1. Decidir estrategia de búsqueda ────────────────────────────────────
  const searchDecision = await decideSearchStrategy(ctx, groq);
  logger.log(`[MESSAGE] searchDecision=${JSON.stringify(searchDecision)}`);

  // ── 2. Resolver — top 3 candidatos ───────────────────────────────────────
  let resolved: ResolvedDocument[];
  try {
    resolved = await dataResolver.resolve({
      companyId:         session.company_id,
      schemes:           data.schemes ?? [],
      globalCriteria:    data.globalCriteria ?? [],
      formState:         session.formState,
      searchQuery:       searchDecision.searchQuery ?? undefined,
      useSemanticSearch: searchDecision.useSemanticSearch,
      page:     1,
      pageSize: 3,
    } satisfies ResolveParams);
  } catch (err: any) {
    logger.error(`[MESSAGE] resolve ERROR: ${err.message}`);
    return errorResult(ctx, data, session.formState);
  }

  const candidates = resolved.flatMap(r => r.documents);
  logger.log(`[MESSAGE] candidatos=${candidates.length}`);

  if (!candidates.length) {
    const emptyMsg = resolveTemplate(
      data.emptyFallbackEnabled
        ? (data.emptyFallbackMessage ?? 'No encontré resultados para tu búsqueda.')
        : 'No encontré resultados para tu búsqueda.',
      session.formState,
    );
    return {
      message: emptyMsg,
      data: {},
      done: true,
      nextNodeId: ctx.node.branches?.['empty'] ?? ctx.node.next?.[0],
    };
  }

  // ── 3. LLM escrutina coherencia ───────────────────────────────────────────
  const outputTemplate = (data.outputTemplate ?? '').trim();
  const coherenceResult = await scrutinizeCoherence(groq, candidates, ctx.userMessage, outputTemplate);
  logger.log(`[MESSAGE] coherence=${JSON.stringify(coherenceResult)}`);

  const successNextId = ctx.node.branches?.['success'] ?? ctx.node.next?.[0];

  if (!coherenceResult.coherent || coherenceResult.selectedIndex < 0) {
    return {
      message:    coherenceResult.message || 'No encontré resultados que coincidan con tu búsqueda.',
      data:       {},
      done:       true,
      nextNodeId: ctx.node.branches?.['empty'] ?? ctx.node.next?.[0],
    };
  }

  const selectedDoc = candidates[coherenceResult.selectedIndex];
  const finalMessage = outputTemplate
    ? applyTemplate(outputTemplate, selectedDoc)
    : buildSingleDocFallback(selectedDoc);

  logger.log(`[MESSAGE] template aplicado — doc[${coherenceResult.selectedIndex}]`);

  return {
    message:    finalMessage,
    data:       {},
    done:       true,
    nextNodeId: successNextId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RAW MODE — JSON directo
// ─────────────────────────────────────────────────────────────────────────────

async function runRawMode(
  ctx: RunnerContext,
  dataResolver: DataResolverService,
  pageSize: number,
  currentPage: number,
): Promise<NodeResult & { pagination?: PaginationEntry }> {
  const { data, id: nodeId } = ctx.node;
  const { session } = ctx;

  let resolved: ResolvedDocument[];
  try {
    resolved = await dataResolver.resolve({
      companyId:         session.company_id,
      schemes:           data.schemes ?? [],
      globalCriteria:    data.globalCriteria ?? [],
      formState:         session.formState,
      useSemanticSearch: false,
      page:              currentPage,
      pageSize,
    } satisfies ResolveParams);
  } catch (err: any) {
    logger.error(`[RAW] resolve ERROR: ${err.message}`);
    clearPaginationEntry(session.formState, nodeId);
    return errorResult(ctx, data, session.formState);
  }

  const hasMore = resolved.some(r => r.hasMore);
  if (!hasMore) clearPaginationEntry(session.formState, nodeId);

  return {
    message: JSON.stringify(
      resolved.map(r => ({ schemaId: r.schemaId, results: r.documents })),
      null, 2,
    ),
    data:       {},
    done:       true,
    nextNodeId: hasMore ? undefined : (ctx.node.branches?.['success'] ?? ctx.node.next?.[0]),
    pagination: hasMore ? { nodeId, hasMore: true, currentPage } : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM — decidir estrategia de búsqueda (solo para message mode)
// ─────────────────────────────────────────────────────────────────────────────

async function decideSearchStrategy(
  ctx: RunnerContext,
  groq: ChatGroqService,
): Promise<{ useSemanticSearch: boolean; searchQuery: string | null }> {
  const safeMsg = ctx.userMessage?.trim();
  if (!safeMsg || safeMsg === '?') {
    return { useSemanticSearch: false, searchQuery: null };
  }

  const result = await groq.rawCall<{
    queryType: 'listing' | 'semantic';
    searchQuery: string | null;
    expandedQuery: string | null;
  }>(
    `Decide cómo buscar en un catálogo según el mensaje del usuario.

Responde SOLO con JSON. Dos casos:

CASO 1 — el usuario menciona algo específico:
{"queryType": "semantic", "searchQuery": "<término original>", "expandedQuery": "<términos expandidos>"}

Para expandedQuery:
- Nombre exacto de producto → repite igual sin expandir.
- Funcionalidad, uso, síntoma o necesidad → expande con nombres de productos,
  categorías, sinónimos y términos técnicos del dominio.

CASO 2 — quiere ver todo o no especifica:
{"queryType": "listing", "searchQuery": null, "expandedQuery": null}`,
    safeMsg,
  );

  if (!result?.queryType) {
    return { useSemanticSearch: false, searchQuery: null };
  }

  const finalQuery = result.expandedQuery?.trim() || result.searchQuery;
  return {
    useSemanticSearch: result.queryType === 'semantic',
    searchQuery: finalQuery,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM — escrutinio de coherencia (solo para message mode)
// ─────────────────────────────────────────────────────────────────────────────

async function scrutinizeCoherence(
  groq: ChatGroqService,
  candidates: Record<string, any>[],
  userMessage: string,
  outputTemplate: string,
): Promise<{ coherent: boolean; selectedIndex: number; message: string }> {
  const summaries = candidates.map((doc, i) => {
    const d = doc.data ?? doc;
    const fields = Object.entries(d)
      .filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    return `IDX_${i}: { ${fields} }`;
  });

  logger.log(
    `[scrutinize] userMessage="${userMessage}"\ncandidatos:\n${summaries.join('\n')}`,
  );

  const result = await groq.rawCall<{
    coherent: boolean;
    selectedIndex: number;
    message: string;
  }>(
    `El usuario buscó: "${userMessage}"

Candidatos recuperados:
${summaries.join('\n')}

Determina si algún candidato es genuinamente relevante para lo que el usuario busca.

Un candidato ES relevante si:
- Su nombre, descripción o atributos coinciden directa o parcialmente con la búsqueda
- Es un producto/ítem que satisface la necesidad, uso o función descrita
- Es sinónimo, nombre comercial o variante conocida de lo buscado

REGLAS:
- Si encuentras uno coherente → {"coherent": true, "selectedIndex": <índice>, "message": ""}
- Si ninguno es coherente     → {"coherent": false, "selectedIndex": -1, "message": "<mensaje natural al usuario>"}
- Selecciona SOLO UN índice — el más relevante.

Responde ÚNICAMENTE con JSON (sin markdown):`,
  );

  if (!result) {
    return { coherent: false, selectedIndex: -1, message: 'No encontré resultados que coincidan con tu búsqueda.' };
  }

  return {
    coherent:      result.coherent === true,
    selectedIndex: typeof result.selectedIndex === 'number' ? result.selectedIndex : -1,
    message:       result.message ?? '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de formateo determinístico
// ─────────────────────────────────────────────────────────────────────────────

function parseOutputTemplate(raw: string): { header: string; itemPattern: string } {
  const match = raw.match(/([\s\S]*?)\{\{#each\}\}([\s\S]*?)\{\{\/each\}\}/);
  if (match) {
    return { header: match[1].trim(), itemPattern: match[2].trim() };
  }
  return { header: '', itemPattern: raw.trim() };
}

function buildDeterministicList(
  documents: Record<string, any>[],
  outputTemplate: string,
): string {
  if (!documents.length) return 'No se encontraron resultados.';

  if (!outputTemplate) {
    return documents
      .map((doc, i) => {
        const d = doc.data ?? doc;
        const fields = Object.entries(d)
          .filter(([k]) => k !== '_id' && !k.startsWith('__'))
          .map(([k, v]) => `${k}: ${v}`)
          .join(' — ');
        return `${i + 1}. ${fields}`;
      })
      .join('\n');
  }

  const { header, itemPattern } = parseOutputTemplate(outputTemplate);
  const items = documents
    .map((doc, i) => applyTemplate(itemPattern, doc, i + 1))
    .join('\n');

  return header ? `${header}\n${items}` : items;
}

function applyTemplate(
  template: string,
  doc: Record<string, any>,
  index?: number,
): string {
  const d = doc.data ?? doc;

  return template.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
    if (key === 'index' && index !== undefined) return String(index);

    const dbMatch = key.match(/^db\.(\w+)\.(\w+)$/);
    if (dbMatch) {
      const namespacedKey = `${dbMatch[1]}.${dbMatch[2]}`;
      const val = d[namespacedKey] ?? doc[namespacedKey];
      return val !== undefined && val !== null ? String(val) : `[${key}]`;
    }

    const val = d[key] ?? doc[key];
    return val !== undefined && val !== null ? String(val) : `[${key}]`;
  });
}

function buildSingleDocFallback(doc: Record<string, any>): string {
  const d = doc.data ?? doc;
  return Object.entries(d)
    .filter(([k]) => k !== '_id' && !k.startsWith('_'))
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

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