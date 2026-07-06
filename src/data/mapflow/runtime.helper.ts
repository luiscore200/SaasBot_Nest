import * as crypto from 'crypto';
import { NodeType } from './types';

export interface RuntimeNode {
  id: string;
  type: NodeType;
  data: Record<string, any>;
  next: string[];
  branches?: Record<string, string>;
  fallback?: string;
}

export interface RuntimeBuildResult {
  nodes: Record<string, RuntimeNode>;
  startNode: string;
  hash: string;
}

const RUNTIME_UI_ONLY_KEYS = new Set(['initNodes', 'finishNodes']);

function cleanRuntimeData(data: Record<string, any> = {}): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (RUNTIME_UI_ONLY_KEYS.has(key)) continue;
    clean[key] = value;
  }
  return clean;
}


export function buildFlowRuntimeSkeleton(map: any[]): { nodes: Record<string, RuntimeNode>; startNode: string } {
  if (!Array.isArray(map) || map.length === 0) {
    throw new Error('El map está vacío o es inválido.');
  }

  const nodes: Record<string, RuntimeNode> = {};
  const visited = new Set<string>();

  function traverse(node: any): void {

    if (!node?.id) throw new Error('Nodo sin ID detectado.');
    if (!node?.type) throw new Error(`Nodo sin tipo: ${node.id}`);

    if (node.type === 'goToNode') {
      if (!node.data?.targetNodeId) {
        throw new Error(`goToNode "${node.id}" no tiene targetNodeId. Asigna un nodo destino antes de guardar.`);
      }
      nodes[node.id] = { id: node.id, type: 'goToNode', data: cleanRuntimeData(node.data), next: [] }; // ← cambio
      return;
    }

    if (visited.has(node.id)) return;
    visited.add(node.id);

    const runtimeNode: RuntimeNode = {
      id: node.id,
      type: node.type as NodeType,
      data: cleanRuntimeData(node.data), // ← cambio
      next: [],
    };

    if (Array.isArray(node.next) && node.next.length > 0) {
      for (const child of node.next) {
        if (!child?.id) throw new Error(`Nodo hijo sin id en "${node.id}".`);
        runtimeNode.next.push(child.id);
        traverse(child);
      }
    }

    if (node.branches && typeof node.branches === 'object') {
      runtimeNode.branches = {};
      for (const [key, branchNode] of Object.entries(node.branches) as [string, any][]) {
        if (!branchNode?.id) throw new Error(`Branch "${key}" sin id en nodo "${node.id}".`);
        runtimeNode.branches[key] = branchNode.id;
        traverse(branchNode);
      }
    }

    if (node.fallback) {
      if (!node.fallback.id) throw new Error(`Fallback sin id en nodo "${node.id}".`);
      runtimeNode.fallback = node.fallback.id;
      traverse(node.fallback);
    }

    nodes[node.id] = runtimeNode;
    visited.delete(node.id);
  }

  for (const root of map) traverse(root);

  const startNode = findStartNode(map);
  if (!nodes[startNode]) throw new Error(`El startNode "${startNode}" no existe en el runtime generado.`);

  for (const node of Object.values(nodes)) {
    if (node.type === 'goToNode') {
      const target = node.data.targetNodeId as string;
      if (!nodes[target]) {
        throw new Error(`goToNode "${node.id}" apunta a "${target}" pero ese nodo no existe en el runtime.`);
      }
    }

     const initIds: string[] = node.data?.initStores ?? [];
  const finishIds: string[] = node.data?.finishStores ?? [];
    for (const storeId of [...initIds, ...finishIds]) {
      if (!nodes[storeId] || nodes[storeId].type !== 'storeNode') {
        throw new Error(
          `Nodo "${node.id}" referencia storeNodeId="${storeId}" en initStores/finishStores ` +
          `pero ese storeNode no existe en el flow.`,
        );
      }
    }
  }

  return { nodes, startNode };
}

export function computeRuntimeHash(nodes: Record<string, RuntimeNode>): string {
  const sorted = Object.keys(nodes).sort().reduce<Record<string, RuntimeNode>>((acc, key) => {
    acc[key] = nodes[key];
    return acc;
  }, {});
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

export function buildFlowRuntime(map: any[]): RuntimeBuildResult {
  const { nodes, startNode } = buildFlowRuntimeSkeleton(map);
  const hash = computeRuntimeHash(nodes);
  return { nodes, startNode, hash };
}

function findStartNode(map: any[]): string {
  let startId: string | null = null;

  function search(node: any): void {
    if (node.type === 'conversationNode' && node.data?.type === 'start') startId = node.id;
    node.next?.forEach(search);
    if (node.branches) Object.values(node.branches).forEach(search);
    if (node.fallback) search(node.fallback);
  }

  for (const root of map) search(root);

  if (!startId) {
    throw new Error('No se encontró nodo de inicio. Asegúrate de tener un conversationNode con type="start".');
  }
  return startId;
}