import * as crypto from 'crypto';
import { NodeType } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos internos del runtime
// ─────────────────────────────────────────────────────────────────────────────

export interface RuntimeNode {
  id: string;
  type: NodeType;
  data: Record<string, any>;
  /** IDs de los nodos siguientes (flujo lineal) */
  next: string[];
  /** branch-key → nodeId */
  branches?: Record<string, string>;
  /** nodeId del fallback (intentNode) */
  fallback?: string;
}

export interface RuntimeBuildResult {
  nodes: Record<string, RuntimeNode>;
  startNode: string;
  hash: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildFlowRuntime — entry point
// ─────────────────────────────────────────────────────────────────────────────

export function buildFlowRuntime(map: any[]): RuntimeBuildResult {
  if (!Array.isArray(map) || map.length === 0) {
    throw new Error('El map está vacío o es inválido.');
  }

  const nodes: Record<string, RuntimeNode> = {};
  const visited = new Set<string>();

  function traverse(node: any): void {
    if (!node?.id) throw new Error('Nodo sin ID detectado.');
    if (!node?.type) throw new Error(`Nodo sin tipo: ${node.id}`);

    // goToNode es terminal en el árbol — solo registra la referencia en data.
    // El engine resuelve data.targetNodeId en tiempo de ejecución.
    if (node.type === 'goToNode') {
      if (!node.data?.targetNodeId) {
        throw new Error(
          `goToNode "${node.id}" no tiene targetNodeId. Asigna un nodo destino antes de guardar.`,
        );
      }
      nodes[node.id] = {
        id: node.id,
        type: 'goToNode',
        data: node.data ?? {},
        next: [],
      };
      return;
    }

    // Evitar loops infinitos en el traversal (no debería ocurrir si el front
    // valida ciclos, pero es una red de seguridad).
    if (visited.has(node.id)) return;
    visited.add(node.id);

    const runtimeNode: RuntimeNode = {
      id: node.id,
      type: node.type as NodeType,
      data: node.data ?? {},
      next: [],
    };

    // ── Flujo lineal ─────────────────────────────────────────────────────────
    if (Array.isArray(node.next) && node.next.length > 0) {
      for (const child of node.next) {
        if (!child?.id) throw new Error(`Nodo hijo sin id en "${node.id}".`);
        runtimeNode.next.push(child.id);
        traverse(child);
      }
    }

    // ── Branches (intentNode, routerNode, confirmationNode, outputNode) ──────
    if (node.branches && typeof node.branches === 'object') {
      runtimeNode.branches = {};
      for (const [key, branchNode] of Object.entries(node.branches) as [string, any][]) {
        if (!branchNode?.id) {
          throw new Error(`Branch "${key}" sin id en nodo "${node.id}".`);
        }
        runtimeNode.branches[key] = branchNode.id;
        traverse(branchNode);
      }
    }

    // ── Fallback (intentNode) ─────────────────────────────────────────────
    if (node.fallback) {
      if (!node.fallback.id) {
        throw new Error(`Fallback sin id en nodo "${node.id}".`);
      }
      runtimeNode.fallback = node.fallback.id;
      traverse(node.fallback);
    }

    nodes[node.id] = runtimeNode;
    visited.delete(node.id);
  }

  for (const root of map) {
    traverse(root);
  }

  const startNode = findStartNode(map);

  if (!nodes[startNode]) {
    throw new Error(`El startNode "${startNode}" no existe en el runtime generado.`);
  }

  // Validar que todos los targetNodeId de goToNodes apunten a nodos existentes
  for (const node of Object.values(nodes)) {
    if (node.type === 'goToNode') {
      const target = node.data.targetNodeId as string;
      if (!nodes[target]) {
        throw new Error(
          `goToNode "${node.id}" apunta a "${target}" pero ese nodo no existe en el runtime.`,
        );
      }
    }
  }

  const hash = hashRuntime(nodes);

  return { nodes, startNode, hash };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers privados
// ─────────────────────────────────────────────────────────────────────────────

function findStartNode(map: any[]): string {
  let startId: string | null = null;

  function search(node: any): void {
    if (node.type === 'conversationNode' && node.data?.type === 'start') {
      startId = node.id;
    }
    node.next?.forEach(search);
    if (node.branches) Object.values(node.branches).forEach(search);
    if (node.fallback) search(node.fallback);
  }

  for (const root of map) search(root);

  if (!startId) {
    throw new Error(
      'No se encontró nodo de inicio. Asegúrate de tener un conversationNode con type="start".',
    );
  }

  return startId;
}

function hashRuntime(nodes: Record<string, RuntimeNode>): string {
  // Ordenar las keys para que el hash sea determinista independiente
  // del orden de traversal.
  const sorted = Object.keys(nodes)
    .sort()
    .reduce<Record<string, RuntimeNode>>((acc, key) => {
      acc[key] = nodes[key];
      return acc;
    }, {});

  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}