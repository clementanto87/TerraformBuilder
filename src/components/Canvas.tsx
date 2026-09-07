/**
 * The design surface.
 *
 * React Flow renders the diagram, but the `Design` in the store stays the
 * source of truth: flow nodes are derived on every render and every gesture is
 * written straight back to the store, so the code panel can never drift from
 * what is on screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type OnConnect,
} from '@xyflow/react';
import { Icon } from './Icon';
import { DRAG_TYPE } from './Catalog';
import { nodeTypes, type NodePayload } from './nodes';
import { useDesign } from '@/store/useDesign';
import { absolutePosition, depthOf, findDropTarget, nodeSize, toRelative } from '@/core/spatial';
import type { ValidationIssue } from '@/core/types';

interface CanvasProps {
  issues: ValidationIssue[];
}

export function Canvas({ issues }: CanvasProps) {
  const design = useDesign((state) => state.design);
  const pack = useDesign((state) => state.pack);
  const selectedId = useDesign((state) => state.selectedId);
  const select = useDesign((state) => state.select);
  const addNode = useDesign((state) => state.addNode);
  const moveNode = useDesign((state) => state.moveNode);
  const resizeNode = useDesign((state) => state.resizeNode);
  const removeNode = useDesign((state) => state.removeNode);
  const connect = useDesign((state) => state.connect);
  const removeEdge = useDesign((state) => state.removeEdge);
  const revision = useDesign((state) => state.revision);

  const { screenToFlowPosition, zoomIn, zoomOut, fitView, getZoom } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(100);

  const defs = useMemo(
    () => new Map(pack.resources.map((def) => [def.id, def])),
    [pack],
  );

  // Frame a newly loaded design once its nodes have been measured. Adding a
  // single resource must not move the viewport, so this keys off `revision`.
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      fitView({ padding: 0.18, duration: 260, maxZoom: 1 }),
    );
    return () => cancelAnimationFrame(frame);
  }, [revision, fitView]);

  /** Error counts per node, for the badge on each card. */
  const errorsByNode = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of issues) {
      if (issue.level !== 'error' || !issue.nodeId) continue;
      counts.set(issue.nodeId, (counts.get(issue.nodeId) ?? 0) + 1);
    }
    return counts;
  }, [issues]);

  const flowNodes: Node<NodePayload>[] = useMemo(() => {
    const byId = new Map(design.nodes.map((node) => [node.id, node]));

    // React Flow requires a parent to appear before its children.
    const ordered = [...design.nodes].sort((a, b) => depthOf(a, byId) - depthOf(b, byId));

    return ordered.flatMap((node) => {
      const def = defs.get(node.defId);
      if (!def) return [];
      const size = nodeSize(node, def);

      return [
        {
          id: node.id,
          type: def.container ? 'container' : 'resource',
          position: node.position,
          parentId: node.parentId ?? undefined,
          extent: node.parentId ? ('parent' as const) : undefined,
          selected: node.id === selectedId,
          draggable: true,
          data: { node, def, errors: errorsByNode.get(node.id) ?? 0 },
          ...(def.container ? { style: { width: size.width, height: size.height } } : {}),
          // Stacking is left to React Flow. It forces a child's z-index to sit
          // above its parent's and pins each edge to the deepest node it
          // touches, so a link into a nested resource always paints over the
          // containers around it — no z-index we could set changes that.
          // Edges are drawn thin and low-contrast instead, so a crossing
          // reads as a line passing behind rather than as a broken label.
        },
      ];
    });
  }, [design.nodes, defs, selectedId, errorsByNode]);

  const flowEdges: Edge[] = useMemo(
    () =>
      design.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        // Bezier rather than smoothstep: React Flow pins an edge's z-index to
        // the deepest node it connects, so a link into a nested resource
        // always paints over the containers around it. A curve crosses a
        // container diagonally instead of running a long horizontal segment
        // through its label.
        type: 'default',
        animated: false,
        markerEnd: { type: 'arrowclosed' as never, width: 16, height: 16 },
      })),
    [design.edges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<NodePayload>>[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position && !change.dragging) {
          // Committed on drag stop, where reparenting is also resolved.
          continue;
        }
        if (change.type === 'dimensions' && change.dimensions && change.resizing) {
          resizeNode(change.id, change.dimensions);
        }
        if (change.type === 'remove') removeNode(change.id);
        if (change.type === 'select' && change.selected) select(change.id);
      }
    },
    [removeNode, resizeNode, select],
  );

  const onConnect: OnConnect = useCallback(
    (connection) => {
      if (connection.source && connection.target) connect(connection.source, connection.target);
    },
    [connect],
  );

  /** On drop, work out which container (if any) the pointer landed in. */
  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);

      const defId = event.dataTransfer.getData(DRAG_TYPE);
      if (!defId) return;

      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const parentId = findDropTarget(design, pack, point, { defId });
      const position = toRelative(point, parentId, design);

      // Drop on the pointer's centre rather than its top-left corner.
      addNode(defId, { x: position.x - 104, y: position.y - 34 }, parentId);
    },
    [addNode, design, pack, screenToFlowPosition],
  );

  return (
    <div className="canvas__surface" ref={wrapper}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onEdgesDelete={(edges) => edges.forEach((edge) => removeEdge(edge.id))}
        onNodeClick={(_, node) => select(node.id)}
        onPaneClick={() => select(null)}
        onNodeDragStop={(_, node) => {
          const byId = new Map(design.nodes.map((entry) => [entry.id, entry]));
          const current = byId.get(node.id);
          if (!current) return;

          // React Flow reports a position relative to the current parent;
          // resolve it to absolute before looking for a new container.
          const parent = current.parentId ? byId.get(current.parentId) : undefined;
          const parentOrigin = parent ? absolutePosition(parent, byId) : { x: 0, y: 0 };
          const size = nodeSize(current, defs.get(current.defId));
          const centre = {
            x: parentOrigin.x + node.position.x + size.width / 2,
            y: parentOrigin.y + node.position.y + size.height / 2,
          };

          const target = findDropTarget(design, pack, centre, {
            defId: current.defId,
            movingId: current.id,
          });

          const absolute = {
            x: parentOrigin.x + node.position.x,
            y: parentOrigin.y + node.position.y,
          };
          moveNode(node.id, toRelative(absolute, target, design), target);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!wrapper.current?.contains(event.relatedTarget as globalThis.Node | null)) {
            setDragging(false);
          }
        }}
        onDrop={handleDrop}
        onMove={() => setZoom(Math.round(getZoom() * 100))}
        onInit={() => setZoom(Math.round(getZoom() * 100))}
        minZoom={0.2}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.24, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={['Backspace', 'Delete']}
        selectionKeyCode={null}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--border-strong)" />
      </ReactFlow>

      <div className="canvas__zoom">
        <button type="button" className="btn btn--ghost btn--icon" onClick={() => zoomOut()} aria-label="Zoom out">
          <Icon name="minus" size={16} />
        </button>
        <span className="canvas__zoom-value">{zoom}%</span>
        <button type="button" className="btn btn--ghost btn--icon" onClick={() => zoomIn()} aria-label="Zoom in">
          <Icon name="plus" size={16} />
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={() => fitView({ padding: 0.24, duration: 220 })}
          aria-label="Fit to screen"
        >
          <Icon name="fit" size={16} />
        </button>
      </div>

      {dragging && <div className="canvas__drop">Drop to add to the design</div>}

      {design.nodes.length === 0 && !dragging && (
        <div className="canvas__empty">
          <div>
            <h2>Start with a resource group</h2>
            <p>
              Drag anything from the catalog onto the canvas.
              <br />
              Nest resources to express containment — a subnet inside a virtual network
              <br />
              writes its own <code className="inline">virtual_network_name</code>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
