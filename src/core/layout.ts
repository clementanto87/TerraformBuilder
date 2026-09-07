/**
 * Automatic layout.
 *
 * Used when a design arrives without coordinates — an imported Terraform
 * project, or the "Auto arrange" button. Containers are measured bottom-up so
 * a virtual network is exactly big enough for its subnets, then top-level
 * nodes are layered top-to-bottom following the direction of their edges.
 */

import type { Design, GraphNode, ProviderPack } from './types';

export const NODE_WIDTH = 208;
export const NODE_HEIGHT = 68;
const GAP_X = 28;
const GAP_Y = 24;
const CONTAINER_HEADER = 46;
const CONTAINER_PADDING = 16;
const LAYER_GAP = 96;

interface Measured {
  width: number;
  height: number;
}

/** Groups nodes by parent, preserving their existing relative order. */
function childMap(nodes: GraphNode[]): Map<string | null, GraphNode[]> {
  const children = new Map<string | null, GraphNode[]>();
  for (const node of nodes) {
    const key = node.parentId ?? null;
    children.set(key, [...(children.get(key) ?? []), node]);
  }
  return children;
}

/** Containers holding other containers read better in a row than a grid. */
function columnsFor(children: GraphNode[], isContainer: (node: GraphNode) => boolean): number {
  if (children.length <= 1) return 1;
  if (children.every(isContainer)) return children.length;
  return Math.min(2, children.length);
}

export function autoLayout(design: Design, pack: ProviderPack): Design {
  const defs = new Map(pack.resources.map((def) => [def.id, def]));
  const isContainer = (node: GraphNode) => Boolean(defs.get(node.defId)?.container);
  const children = childMap(design.nodes);
  const sizes = new Map<string, Measured>();
  const positions = new Map<string, { x: number; y: number }>();

  /** Measures a node and positions its children relative to it. */
  const measure = (node: GraphNode): Measured => {
    const kids = children.get(node.id) ?? [];
    if (kids.length === 0) {
      const size = isContainer(node)
        ? {
            width: defs.get(node.defId)?.container?.minWidth ?? 280,
            height: defs.get(node.defId)?.container?.minHeight ?? 140,
          }
        : { width: NODE_WIDTH, height: NODE_HEIGHT };
      sizes.set(node.id, size);
      return size;
    }

    const measured = kids.map(measure);
    const columns = columnsFor(kids, isContainer);
    const rows = Math.ceil(kids.length / columns);

    // Column widths and row heights are measured independently, so one wide
    // child does not inflate every other column.
    const columnWidths: number[] = [];
    for (let column = 0; column < columns; column += 1) {
      const slice = measured.filter((_, index) => index % columns === column);
      columnWidths.push(slice.length > 0 ? Math.max(...slice.map((size) => size.width)) : 0);
    }
    const rowHeights: number[] = [];
    for (let row = 0; row < rows; row += 1) {
      const slice = measured.slice(row * columns, row * columns + columns);
      rowHeights.push(Math.max(...slice.map((size) => size.height)));
    }

    const columnOffset = (column: number) =>
      CONTAINER_PADDING +
      columnWidths.slice(0, column).reduce((total, value) => total + value + GAP_X, 0);

    kids.forEach((kid, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const y =
        CONTAINER_HEADER +
        rowHeights.slice(0, row).reduce((total, height) => total + height + GAP_Y, 0);
      positions.set(kid.id, { x: columnOffset(column), y });
    });

    const width =
      CONTAINER_PADDING * 2 +
      columnWidths.reduce((total, value) => total + value, 0) +
      (columns - 1) * GAP_X;
    const height =
      CONTAINER_HEADER +
      CONTAINER_PADDING +
      rowHeights.reduce((total, value) => total + value, 0) +
      (rows - 1) * GAP_Y;

    const size = { width, height };
    sizes.set(node.id, size);
    return size;
  };

  const roots = children.get(null) ?? [];
  roots.forEach(measure);

  /* Layer the top-level nodes by following edges between their subtrees. */
  const rootOf = new Map<string, string>();
  const assignRoot = (node: GraphNode, root: string) => {
    rootOf.set(node.id, root);
    for (const kid of children.get(node.id) ?? []) assignRoot(kid, root);
  };
  roots.forEach((root) => assignRoot(root, root.id));

  const layer = new Map<string, number>(roots.map((root) => [root.id, 0]));
  const incoming = new Map<string, string[]>();
  for (const edge of design.edges) {
    const from = rootOf.get(edge.source);
    const to = rootOf.get(edge.target);
    if (!from || !to || from === to) continue;
    incoming.set(to, [...(incoming.get(to) ?? []), from]);
  }

  // Longest-path layering, iterated to a fixed point and capped so that a
  // cycle in the graph can never spin forever.
  for (let pass = 0; pass < roots.length + 1; pass += 1) {
    let changed = false;
    for (const root of roots) {
      const sources = incoming.get(root.id) ?? [];
      if (sources.length === 0) continue;
      const depth = Math.max(...sources.map((id) => layer.get(id) ?? 0)) + 1;
      if (depth > (layer.get(root.id) ?? 0)) {
        layer.set(root.id, depth);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const byLayer = new Map<number, GraphNode[]>();
  for (const root of roots) {
    const depth = layer.get(root.id) ?? 0;
    byLayer.set(depth, [...(byLayer.get(depth) ?? []), root]);
  }

  const widest = Math.max(
    1,
    ...[...byLayer.values()].map((group) =>
      group.reduce((total, node) => total + (sizes.get(node.id)?.width ?? NODE_WIDTH) + GAP_X, 0),
    ),
  );

  let y = 0;
  for (const depth of [...byLayer.keys()].sort((a, b) => a - b)) {
    const group = byLayer.get(depth) ?? [];
    const rowWidth = group.reduce(
      (total, node) => total + (sizes.get(node.id)?.width ?? NODE_WIDTH) + GAP_X,
      -GAP_X,
    );
    let x = (widest - rowWidth) / 2;
    let tallest = 0;
    for (const node of group) {
      const size = sizes.get(node.id) ?? { width: NODE_WIDTH, height: NODE_HEIGHT };
      positions.set(node.id, { x, y });
      x += size.width + GAP_X;
      tallest = Math.max(tallest, size.height);
    }
    y += tallest + LAYER_GAP;
  }

  return {
    ...design,
    nodes: design.nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position,
      size: sizes.get(node.id) ?? node.size,
    })),
  };
}
