// ─────────────────────────────────────────────────────────────────────────────
// engine/node/store/store.handler.ts
// Motor único de storeNode: búsqueda (query/list), formateo, y operaciones
// sobre la colección. Usado tanto por NodeService (modo inline, dentro de la
// cadena del flujo) como por EngineService (modo flotante, interceptando
// mensajes fuera de la cadena).
// ─────────────────────────────────────────────────────────────────────────────

import { Logger } from '@nestjs/common';
import { DataResolverService, ResolvedDocument } from './dataResolver.service';
import { SessionService } from '../../session/session.service';
import {
  ChatSession, StoreOperation, StorePermissions, StoreSearchOutput,
  StoreOperationType, FormState,
} from '../../engine.types';

const logger = new Logger('StoreHandler');
const DEFAULT_PAGE_SIZE = 5;
const PAGINATION_KEY = '__pagination';

export interface StoreLike {
  nodeId: string;
  objectVar: string;
  schemas: string[];
  isArray: boolean;
  storePermissions: StorePermissions;
  search: boolean;
  searchOutput?: StoreSearchOutput;
  lastFound?: Record<string, any>[];
}

export interface StoreSearchResult {
  message: string;
  found: boolean;
  docs: Record<string, any>[];
  hasMore?: boolean;
  currentPage?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Búsqueda — query (puntual) o list (paginado)
// ─────────────────────────────────────────────────────────────────────────────

export async function performStoreSearch(
  store: StoreLike,
  intent: 'query' | 'list',
  queryText: string,
  session: ChatSession,
  dataResolver: DataResolverService,
  sessionService: SessionService,
): Promise<StoreSearchResult> {
  if (!store.search) {
    return { message: '', found: false, docs: [] };
  }

  const out = store.searchOutput;
  const pageSize = out?.pageSize ?? DEFAULT_PAGE_SIZE;

  if (intent === 'list') {
    const currentPage = getCurrentPage(session.formState, store.nodeId) + 1;
    setPage(session.formState, store.nodeId, currentPage);

    let resolved: ResolvedDocument[] = [];
    for (const schemaId of store.schemas) {
      const r = await dataResolver.resolve({
        companyId: session.company_id,
        schemes: [{ id: schemaId, selectedSchema: schemaId, selectedFields: [], schemaName: schemaId }],
        globalCriteria: out?.globalCriteria ?? [],
        formState: session.formState,
        useSemanticSearch: false,
        page: currentPage,
        pageSize,
      });
      resolved = resolved.concat(r);
    }

    const docs = resolved.flatMap(r => r.documents);
    const hasMore = resolved.some(r => r.hasMore);

    for (const r of resolved) sessionService.appendOutputCache(session.sessionId, r.schemaId, r.documents);

    if (!docs.length) {
      clearPage(session.formState, store.nodeId);
      return {
        message: emptyMessage(out),
        found: false, docs: [], hasMore: false,
      };
    }
    if (!hasMore) clearPage(session.formState, store.nodeId);

    const message = out?.searchFeedback === false
      ? ''
      : buildDeterministicList(docs, out?.templateList ?? '');

    return { message, found: true, docs, hasMore, currentPage };
  }

  // intent === 'query'
  if (!queryText?.trim()) return { message: '', found: false, docs: [] };

  let resolved: ResolvedDocument[] = [];
  for (const schemaId of store.schemas) {
    try {
      const r = await dataResolver.resolve({
        companyId: session.company_id,
        schemes: [{ id: schemaId, selectedSchema: schemaId, selectedFields: [], schemaName: schemaId }],
        globalCriteria: out?.globalCriteria ?? [],
        formState: session.formState,
        searchQuery: queryText,
        useSemanticSearch: true,
        page: 1,
        pageSize: 3,
      });
      resolved = resolved.concat(r);
    } catch (err: any) {
      logger.error(`[performStoreSearch] error schema="${schemaId}": ${err.message}`);
    }
  }

  const docs = resolved.flatMap(r => r.documents);
  for (const r of resolved) sessionService.appendOutputCache(session.sessionId, r.schemaId, r.documents);

  if (!docs.length) {
    return { message: emptyMessage(out), found: false, docs: [] };
  }

  const message = out?.searchFeedback === false
    ? ''
    : (out?.templateObj ? applyTemplate(out.templateObj, docs[0]) : buildSingleDocFallback(docs[0]));

  return { message, found: true, docs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Operaciones sobre la colección (insert/edit/delete/show)
// ─────────────────────────────────────────────────────────────────────────────

export interface OperationResult {
  feedbackText: string;
  formPatch: FormState;
  result: 'success' | 'error' | 'not_found';
}

export function nameOf(doc: any): string {
  const d = doc?.data ?? doc ?? {};
  return d.nombre ?? d.name ?? d.label ?? String(Object.values(d)[0] ?? '');
}

function matchInPool(pool: Record<string, any>[], text: string): Record<string, any> | null {
  if (!text?.trim()) return null;
  const needle = text.toLowerCase();
  return pool.find(doc => {
    const n = nameOf(doc).toLowerCase();
    return n && (n.includes(needle) || needle.includes(n));
  }) ?? null;
}

export function resolveOperand(
  store: StoreLike, text: string | undefined, session: ChatSession, sessionService: SessionService,
): Record<string, any> | null {
  if (text?.trim()) {
    const pool = store.schemas.flatMap(s => sessionService.getOutputCache(session.sessionId, s));
    const cached = matchInPool(pool, text);
    if (cached) return cached;
  }
  return store.lastFound?.[0] ?? null;
}

export function executeStoreOperation(
  store: StoreLike, op: StoreOperation, session: ChatSession, sessionService: SessionService,
): OperationResult {
  const current = session.formState[store.objectVar];

  switch (op.type) {
    case 'insert': {
      const doc = resolveOperand(store, op.item, session, sessionService);
      if (!doc) return { feedbackText: `No encontré "${op.item || '(sin especificar)'}" disponible.`, formPatch: {}, result: 'not_found' };
      const newValue = store.isArray ? [...(Array.isArray(current) ? current : []), doc] : doc;
      return {
        feedbackText: defaultFeedback('insert', nameOf(doc), newValue),
        formPatch: { [store.objectVar]: newValue },
        result: 'success',
      };
    }
    case 'edit': {
      const newDoc = resolveOperand(store, op.item, session, sessionService);
      if (store.isArray && Array.isArray(current) && op.target) {
        let touched = false;
        const updated = current.map((entry: any) => {
          if (nameOf(entry).toLowerCase().includes(op.target!.toLowerCase()) && newDoc) {
            touched = true;
            return newDoc;
          }
          return entry;
        });
        if (!touched) return { feedbackText: `No encontré "${op.target}" en tu lista.`, formPatch: {}, result: 'not_found' };
        return { feedbackText: defaultFeedback('edit', op.target ?? '', updated), formPatch: { [store.objectVar]: updated }, result: 'success' };
      }
      if (!newDoc) return { feedbackText: `No encontré "${op.item || '(sin especificar)'}" disponible.`, formPatch: {}, result: 'not_found' };
      return { feedbackText: defaultFeedback('edit', nameOf(newDoc), newDoc), formPatch: { [store.objectVar]: newDoc }, result: 'success' };
    }
    case 'delete': {
      if (store.isArray && Array.isArray(current) && op.target) {
        const filtered = current.filter((e: any) => !nameOf(e).toLowerCase().includes(op.target!.toLowerCase()));
        const changed = filtered.length !== current.length;
        return {
          feedbackText: changed ? defaultFeedback('delete', op.target, filtered) : `No encontré "${op.target}" en tu lista.`,
          formPatch: changed ? { [store.objectVar]: filtered } : {},
          result: changed ? 'success' : 'not_found',
        };
      }
      return { feedbackText: defaultFeedback('delete', op.target ?? '', null), formPatch: { [store.objectVar]: null }, result: 'success' };
    }
    case 'show':
      return { feedbackText: defaultFeedback('show', '', current), formPatch: {}, result: 'success' };
  }
}

function defaultFeedback(type: StoreOperationType, item: string, newValue: any): string {
  const count  = Array.isArray(newValue) ? newValue.length : (newValue ? 1 : 0);
  const plural = count === 1 ? 'ítem' : 'ítems';
  switch (type) {
    case 'insert': return `He agregado "${item}" a tu lista. Ahora tienes ${count} ${plural}.`;
    case 'delete': return `He eliminado "${item}" de tu lista. Te quedan ${count} ${plural}.`;
    case 'edit':   return `He actualizado "${item}".`;
    case 'show': {
      const list = Array.isArray(newValue) ? newValue.map(nameOf).join(', ') : String(newValue ?? '');
      return list ? `Tu lista contiene: ${list}.` : 'Tu lista está vacía.';
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de formateo/paginación (portados de output.handler.ts)
// ─────────────────────────────────────────────────────────────────────────────

function getPaginationMap(fs: FormState): Record<string, number> {
  const raw = fs[PAGINATION_KEY];
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, number> : {};
}
function getCurrentPage(fs: FormState, key: string): number { return getPaginationMap(fs)[key] ?? 0; }
function setPage(fs: FormState, key: string, page: number): void {
  const m = getPaginationMap(fs); m[key] = page; fs[PAGINATION_KEY] = m;
}
function clearPage(fs: FormState, key: string): void {
  const m = getPaginationMap(fs); delete m[key]; fs[PAGINATION_KEY] = m;
}

function emptyMessage(out?: StoreSearchOutput): string {
  return out?.emptyFallbackEnabled === false ? '' : (out?.emptyFallbackMessage ?? 'No encontré resultados.');
}

function parseTemplate(raw: string): { header: string; itemPattern: string } {
  const match = raw.match(/([\s\S]*?)\{\{#each\}\}([\s\S]*?)\{\{\/each\}\}/);
  if (match) return { header: match[1].trim(), itemPattern: match[2].trim() };
  return { header: '', itemPattern: raw.trim() };
}

function buildDeterministicList(docs: Record<string, any>[], template: string): string {
  if (!docs.length) return 'No se encontraron resultados.';
  if (!template) {
    return docs.map((doc, i) => {
      const d = doc.data ?? doc;
      const fields = Object.entries(d).filter(([k]) => k !== '_id' && !k.startsWith('__')).map(([k, v]) => `${k}: ${v}`).join(' — ');
      return `${i + 1}. ${fields}`;
    }).join('\n');
  }
  const { header, itemPattern } = parseTemplate(template);
  const items = docs.map((doc, i) => applyTemplate(itemPattern, doc, i + 1)).join('\n');
  return header ? `${header}\n${items}` : items;
}

export function applyTemplate(template: string, doc: Record<string, any>, index?: number): string {
  const d = doc.data ?? doc;
  return template.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
    if (key === 'index' && index !== undefined) return String(index);
    const dbMatch = key.match(/^db\.(\w+)\.(\w+)$/);
    if (dbMatch) {
      const nk = `${dbMatch[1]}.${dbMatch[2]}`;
      const val = d[nk] ?? doc[nk];
      return val !== undefined && val !== null ? String(val) : `[${key}]`;
    }
    const val = d[key] ?? doc[key];
    return val !== undefined && val !== null ? String(val) : `[${key}]`;
  });
}

function buildSingleDocFallback(doc: Record<string, any>): string {
  const d = doc.data ?? doc;
  return Object.entries(d).filter(([k]) => k !== '_id' && !k.startsWith('_')).map(([k, v]) => `${k}: ${v}`).join('\n');
}