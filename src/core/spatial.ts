/**
 * Canvas geometry: absolute positions, node bounds and drop targeting.
 *
 * Node positions are stored relative to their parent (which is what React Flow
 * expects for nested nodes), so anything that compares two nodes has to
 * resolve them to absolute coordinates first.
 */

import { NODE_HEIGHT, NODE_WIDTH } from './layout';
import type { Design, GraphNode, ProviderPack, ResourceDef } from './types';

export interface Point {
  x: number;
  y: number;
}

export interface Bounds extends Point {
  width: number;
  height: number;
}

export const nodeSize = (node: GraphNode, def: ResourceDef | undefined): { width: number; height: number } =>
  node.size ??
  (def?.container
    ? { width: def.container.minWidth ?? 320, height: def.container.minHeight ?? 180 }
    : { width: NODE_WIDTH, height: NODE_HEIGHT });

/** Walks up the parent chain, summing offsets. */
export function absolutePosition(node: GraphNode, byId: Map<string, GraphNode>): Point {
  let { x, y } = node.position;
  const seen = new Set<string>([node.id]);
  let parent = node.parentId ? byId.get(node.parentId) : undefined;

  while (parent && !seen.has(parent.id)) {
    x += parent.position.x;
    y += parent.position.y;
    seen.add(parent.id);
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return { x, y };
}

export const depthOf = (node: GraphNode, byId: Map<string, GraphNode>): number => {
  let depth = 0;
  const seen = new Set<string>([node.id]);
  let parent = node.parentId ? byId.get(node.parentId) : undefined;
  while (parent && !seen.has(parent.id)) {
    depth += 1;
    seen.add(parent.id);
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return depth;
};

const contains = (bounds: Bounds, point: Point): boolean =>
  point.x >= bounds.x &&
  point.x <= bounds.x + bounds.width &&
  point.y >= bounds.y &&
  point.y <= bounds.y + bounds.height;

/** True when `candidate` is `ancestorId` or sits inside it. */
export function isDescendant(
  candidate: GraphNode,
  ancestorId: string,
  byId: Map<string, GraphNode>,
): boolean {
  if (candidate.id === ancestorId) return true;
  const seen = new Set<string>([candidate.id]);
  let parent = candidate.parentId ? byId.get(candidate.parentId) : undefined;
  while (parent && !seen.has(parent.id)) {
    if (parent.id === ancestorId) return true;
    seen.add(parent.id);
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return false;
}

export interface DropTargetOptions {
  /** The definition being dropped, so container rules can be checked. */
  defId: string;
  /** A node being moved: it cannot be dropped into itself or its own subtree. */
  movingId?: string;
}

/**
 * Finds the innermost container under a point that will accept the resource.
 * Returns `null` for the canvas root.
 */
export function findDropTarget(
  design: Design,
  pack: ProviderPack,
  point: Point,
  options: DropTargetOptions,
): string | null {
  const byId = new Map(design.nodes.map((node) => [node.id, node]));
  const defs = new Map(pack.resources.map((def) => [def.id, def]));

  const candidates = design.nodes
    .filter((node) => {
      const def = defs.get(node.defId);
      const accepts = def?.container?.accepts;
      if (!accepts) return false;
      if (!accepts.includes('*') && !accepts.includes(options.defId)) return false;
      if (options.movingId && isDescendant(node, options.movingId, byId)) return false;

      const size = nodeSize(node, def);
      const origin = absolutePosition(node, byId);
      return contains({ ...origin, ...size }, point);
    })
    // Deepest container wins, so a subnet beats the VNet that holds it.
    .sort((a, b) => depthOf(b, byId) - depthOf(a, byId));

  return candidates[0]?.id ?? null;
}

/** Converts an absolute point into coordinates relative to a parent node. */
export function toRelative(
  point: Point,
  parentId: string | null,
  design: Design,
): Point {
  if (!parentId) return point;
  const byId = new Map(design.nodes.map((node) => [node.id, node]));
  const parent = byId.get(parentId);
  if (!parent) return point;
  const origin = absolutePosition(parent, byId);
  return { x: point.x - origin.x, y: point.y - origin.y };
}
