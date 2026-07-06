// src/data/mapflow/store-enrichment.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { GroqService } from 'src/groq/groq.service';
import { RuntimeNode } from './runtime.helper';

interface StoreDescriptor {
  nodeId: string;
  objectVar: string;
  schemas: string[];
  storePermissions: Record<string, boolean>;
  search: boolean;
  operatorNotes?: string;
}

export interface PreviousStoreDescription {
  configHash: string;
  llmDescription: string;
}

@Injectable()
export class StoreEnrichmentService {
  private readonly logger = new Logger(StoreEnrichmentService.name);

  constructor(private readonly groq: GroqService) {}

  async enrich(
    nodes: Record<string, RuntimeNode>,
    startNode: string,
    previousDescriptions: Record<string, PreviousStoreDescription> = {},
  ): Promise<void> {
    const storeNodes = Object.values(nodes).filter(n => n.type === 'storeNode');
    if (!storeNodes.length) return;

    const triggerPaths = this.reconstructStoreTriggerPaths(nodes, startNode);
    const pending: { node: RuntimeNode; descriptor: StoreDescriptor; configHash: string }[] = [];

    for (const node of storeNodes) {
      const descriptor = this.toDescriptor(node);
      const configHash = this.hashDescriptor(descriptor, triggerPaths[node.id] ?? []);

      const previous = previousDescriptions[node.id];
      if (previous?.configHash === configHash) {
        node.data.llmDescription = previous.llmDescription;
        node.data.configHash = configHash;
        continue;
      }
      pending.push({ node, descriptor, configHash });
    }

    if (!pending.length) {
      this.logger.log('[enrich] ningún store cambió — sin llamadas LLM');
      return;
    }

    const generated = await this.generateDescriptions(
      pending.map(p => ({ ...p.descriptor, precedingPaths: triggerPaths[p.node.id] ?? [] })),
    );

    for (const p of pending) {
      p.node.data.llmDescription = generated[p.node.id] ?? p.node.data.llmDescription ?? '';
      p.node.data.configHash = p.configHash;
    }
  }

  private toDescriptor(node: RuntimeNode): StoreDescriptor {
    const d = node.data ?? {};
    return {
      nodeId: node.id,
      objectVar: d.objectVar ?? '',
      schemas: d.schemas ?? [],
      storePermissions: d.storePermissions ?? {},
      search: d.search ?? false,
      operatorNotes: d.operatorNotes,
    };
  }

  private hashDescriptor(descriptor: StoreDescriptor, paths: string[][]): string {
    return crypto.createHash('sha256').update(JSON.stringify({ ...descriptor, paths })).digest('hex');
  }

  /**
   * Reconstruye el camino conversacional hacia cada store. Para un store
   * FLOTANTE, el "camino" se deriva de qué nodos lo referencian en
   * initStores. Para un store INLINE (con next/branches propios, corriendo
   * dentro de la cadena como el viejo outputNode), el camino es simplemente
   * su posición en el árbol — se detecta porque el propio nodo aparece
   * alcanzable desde start vía next/branches normales.
   */
  private reconstructStoreTriggerPaths(
    nodes: Record<string, RuntimeNode>,
    startNode: string,
  ): Record<string, string[][]> {
    const result: Record<string, string[][]> = {};
    const MAX_DEPTH = 25;

    const walk = (nodeId: string, path: string[], visited: Set<string>) => {
      if (visited.has(nodeId) || path.length > MAX_DEPTH) return;
      const node = nodes[nodeId];
      if (!node) return;

      const nextVisited = new Set(visited);
      nextVisited.add(nodeId);

      const msg = this.messageFor(node);
      const nextPath = msg ? [...path, msg] : path;

      // Store flotante: activado por initStores de este nodo.
      const initIds: string[] = node.data?.initStores ?? [];
      for (const storeId of initIds) {
        (result[storeId] ??= []).push(nextPath);
      }

      // Store inline: si ESTE nodo es un storeNode alcanzado directamente
      // por el árbol (no vía initStores), registra el camino hacia sí mismo.
      if (node.type === 'storeNode') {
        (result[node.id] ??= []).push(path);
      }

      for (const n of node.next ?? []) walk(n, nextPath, nextVisited);
      if (node.branches) for (const n of Object.values(node.branches)) walk(n, nextPath, nextVisited);
      if (node.fallback) walk(node.fallback, nextPath, nextVisited);
    };

    walk(startNode, [], new Set());
    return result;
  }

  private messageFor(node: RuntimeNode): string | null {
    const d = node.data ?? {};
    switch (node.type) {
      case 'conversationNode': return d.message || null;
      case 'inputNode':        return d.description ? `[pide al usuario: ${d.description}]` : null;
      case 'confirmationNode': return d.confirmationMessage || null;
      case 'storeNode':
        return d.search
          ? `[consulta/gestiona: ${(d.schemas ?? []).join(', ')}]`
          : null;
      default: return null;
    }
  }

  private async generateDescriptions(
    stores: (StoreDescriptor & { precedingPaths: string[][] })[],
  ): Promise<Record<string, string>> {
    const permissionLabel: Record<string, string> = {
      create: 'agregar ítems nuevos',
      show:   'ver/listar el contenido',
      delete: 'eliminar ítems',
      update: 'editar ítems existentes',
    };

    const block = stores.map(s => {
      const perms = Object.entries(s.storePermissions ?? {})
        .filter(([, v]) => v).map(([k]) => permissionLabel[k] ?? k).join(', ') || '(ninguno)';

      const paths = s.precedingPaths.length
        ? s.precedingPaths.map((p, i) => `  camino ${i + 1}: ${p.join(' → ') || '(nodo raíz del flujo)'}`).join('\n')
        : '  (no se encontró ningún nodo que lo active — revisar configuración del flow)';

      return [
        `[Store nodeId="${s.nodeId}"]`,
        `  variable: ${s.objectVar}`,
        `  schemas: ${s.schemas.join(', ') || '(ninguno)'}`,
        `  permisos de colección: ${perms}`,
        `  búsqueda habilitada: ${s.search ? 'sí' : 'no'}`,
        s.operatorNotes ? `  nota del operador: ${s.operatorNotes}` : null,
        `  camino(s) conversacional(es) hacia este store:\n${paths}`,
      ].filter(Boolean).join('\n');
    }).join('\n\n---\n\n');

    const prompt = `Aquí está la definición de ${stores.length} store(s) (colecciones dinámicas,
algunas con capacidad de búsqueda) dentro del flujo de un chatbot, junto con
el camino conversacional que lleva a cada uno.

${block}

Para CADA store, genera una descripción semántica enriquecida (llm_description) que:
1. Explique su propósito de negocio, inferido del camino conversacional,
   los schemas que maneja, y si tiene búsqueda habilitada (en ese caso,
   menciona también que puede resolver consultas de catálogo, no solo
   gestionar la colección).
2. Si dos o más stores comparten el mismo schema, distínguelos explícitamente
   entre sí — deben poder diferenciarse por intención, no solo por nombre.
3. Sea autosuficiente como criterio de clasificación en runtime.

Responde ÚNICAMENTE con JSON (sin markdown):
{"descriptions": {"<nodeId>": "<descripción>", ...}}`;

    try {
      const result = await this.groq.chatStructured<{ descriptions: Record<string, string> }>(
        [{ role: 'user', content: prompt }],
        { temperature: 0.3, maxCompletionTokens: 1200, responseFormat: 'json_object' },
      );
      return result?.data?.descriptions ?? {};
    } catch (err: any) {
      this.logger.error(`[enrich] LLM error: ${err.message}`);
      return {};
    }
  }
}