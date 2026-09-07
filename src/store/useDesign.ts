/**
 * Application state.
 *
 * The `Design` is the single source of truth: the canvas, the properties panel
 * and the generated code are all views of it. React Flow nodes are derived on
 * render rather than stored, so there is never a second copy to keep in sync.
 */

import { create } from 'zustand';
import { autoLayout } from '@/core/layout';
import { emptyDesign, type Design, type GraphNode, type JsonValue, type ProviderPack, type ResourceDef } from '@/core/types';
import { defaultPack, packById, withDiscovered } from '@/packs';

const STORAGE_KEY = 'terraform-builder:design:v1';
const HISTORY_LIMIT = 60;

let counter = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter += 1).toString(36)}`;

/** Seeds a new node's values from its schema defaults. */
function defaultValues(def: ResourceDef): Record<string, JsonValue> {
  const values: Record<string, JsonValue> = {};
  for (const field of def.fields) {
    if (field.default !== undefined) values[field.key] = field.default;
  }
  return values;
}

/** Picks the next free name for a definition, e.g. `vm-1`, `vm-2`. */
function nextName(design: Design, def: ResourceDef): string {
  const taken = new Set(design.nodes.map((node) => node.name));
  for (let index = 1; index < 500; index += 1) {
    const candidate = `${def.namePrefix}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${def.namePrefix}-${uid('x')}`;
}

interface DesignState {
  design: Design;
  pack: ProviderPack;
  selectedId: string | null;
  past: Design[];
  future: Design[];
  /** Bumped when the whole design is replaced, so the canvas can re-frame. */
  revision: number;

  addNode: (defId: string, position: { x: number; y: number }, parentId?: string | null) => string | null;
  removeNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  renameNode: (id: string, name: string) => void;
  setValue: (id: string, key: string, value: JsonValue | undefined) => void;
  setTags: (id: string, tags: Record<string, string>) => void;
  moveNode: (id: string, position: { x: number; y: number }, parentId?: string | null) => void;
  resizeNode: (id: string, size: { width: number; height: number }) => void;

  connect: (source: string, target: string) => void;
  removeEdge: (id: string) => void;

  select: (id: string | null) => void;
  setDesignName: (name: string) => void;
  setRegion: (region: string) => void;

  loadDesign: (design: Design, discovered?: ResourceDef[]) => void;
  reset: () => void;
  arrange: () => void;
  undo: () => void;
  redo: () => void;
}

function load(): { design: Design; pack: ProviderPack } {
  const fallback = {
    design: emptyDesign(defaultPack.id, defaultPack.defaultRegion ?? ''),
    pack: defaultPack,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { design: Design; discovered?: ResourceDef[] };
    if (!parsed.design?.nodes) return fallback;
    return {
      design: parsed.design,
      pack: withDiscovered(packById(parsed.design.packId), parsed.discovered ?? []),
    };
  } catch {
    return fallback;
  }
}

function persist(design: Design, pack: ProviderPack) {
  try {
    const base = new Set(packById(design.packId).resources.map((def) => def.id));
    const discovered = pack.resources.filter((def) => !base.has(def.id));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ design, discovered }));
  } catch {
    // A full or unavailable localStorage must never break the editor.
  }
}

const initial = load();

export const useDesign = create<DesignState>((set, get) => {
  /** Applies a change, recording the previous design for undo. */
  const commit = (mutate: (design: Design) => Design) =>
    set((state) => {
      const next = mutate(state.design);
      if (next === state.design) return state;
      persist(next, state.pack);
      return {
        design: next,
        past: [...state.past, state.design].slice(-HISTORY_LIMIT),
        future: [],
      };
    });

  const patchNode = (id: string, patch: (node: GraphNode) => GraphNode) =>
    commit((design) => ({
      ...design,
      nodes: design.nodes.map((node) => (node.id === id ? patch(node) : node)),
    }));

  return {
    ...initial,
    selectedId: null,
    past: [],
    future: [],
    revision: 0,

    addNode: (defId, position, parentId = null) => {
      const { pack, design } = get();
      const def = pack.resources.find((entry) => entry.id === defId);
      if (!def) return null;

      const id = uid('node');
      const node: GraphNode = {
        id,
        defId,
        name: nextName(design, def),
        values: defaultValues(def),
        tags: {},
        position,
        parentId,
        ...(def.container
          ? {
              size: {
                width: def.container.minWidth ?? 320,
                height: def.container.minHeight ?? 180,
              },
            }
          : {}),
      };

      // A resource group carries the design's region unless told otherwise.
      if (def.id === pack.rootResource && !node.values.location) {
        node.values.location = design.region;
      }

      commit((current) => ({ ...current, nodes: [...current.nodes, node] }));
      set({ selectedId: id });
      return id;
    },

    removeNode: (id) =>
      commit((design) => {
        // Removing a container removes everything inside it.
        const doomed = new Set<string>([id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const node of design.nodes) {
            if (node.parentId && doomed.has(node.parentId) && !doomed.has(node.id)) {
              doomed.add(node.id);
              grew = true;
            }
          }
        }
        return {
          ...design,
          nodes: design.nodes.filter((node) => !doomed.has(node.id)),
          edges: design.edges.filter(
            (edge) => !doomed.has(edge.source) && !doomed.has(edge.target),
          ),
        };
      }),

    duplicateNode: (id) => {
      const { design, pack } = get();
      const original = design.nodes.find((node) => node.id === id);
      const def = original && pack.resources.find((entry) => entry.id === original.defId);
      if (!original || !def) return;

      const copy: GraphNode = {
        ...original,
        id: uid('node'),
        name: nextName(design, def),
        values: { ...original.values },
        tags: { ...original.tags },
        position: { x: original.position.x + 32, y: original.position.y + 32 },
      };
      commit((current) => ({ ...current, nodes: [...current.nodes, copy] }));
      set({ selectedId: copy.id });
    },

    renameNode: (id, name) => patchNode(id, (node) => ({ ...node, name })),

    setValue: (id, key, value) =>
      patchNode(id, (node) => {
        const values = { ...node.values };
        if (value === undefined) delete values[key];
        else values[key] = value;
        return { ...node, values };
      }),

    setTags: (id, tags) => patchNode(id, (node) => ({ ...node, tags })),

    moveNode: (id, position, parentId) =>
      patchNode(id, (node) => ({
        ...node,
        position,
        parentId: parentId === undefined ? node.parentId : parentId,
      })),

    resizeNode: (id, size) => patchNode(id, (node) => ({ ...node, size })),

    connect: (source, target) =>
      commit((design) => {
        if (source === target) return design;
        const exists = design.edges.some(
          (edge) =>
            (edge.source === source && edge.target === target) ||
            (edge.source === target && edge.target === source),
        );
        if (exists) return design;
        return { ...design, edges: [...design.edges, { id: uid('edge'), source, target }] };
      }),

    removeEdge: (id) =>
      commit((design) => ({ ...design, edges: design.edges.filter((edge) => edge.id !== id) })),

    select: (id) => set({ selectedId: id }),

    setDesignName: (name) => commit((design) => ({ ...design, name })),

    setRegion: (region) =>
      commit((design) => ({
        ...design,
        region,
        // Keep resource groups on the design's region unless overridden.
        nodes: design.nodes.map((node) =>
          node.defId === get().pack.rootResource && node.values.location === design.region
            ? { ...node, values: { ...node.values, location: region } }
            : node,
        ),
      })),

    loadDesign: (design, discovered = []) => {
      const pack = withDiscovered(packById(design.packId), discovered);
      persist(design, pack);
      set((state) => ({
        design,
        pack,
        selectedId: null,
        revision: state.revision + 1,
        past: [...state.past, state.design].slice(-HISTORY_LIMIT),
        future: [],
      }));
    },

    reset: () => {
      const design = emptyDesign(defaultPack.id, defaultPack.defaultRegion ?? '');
      persist(design, defaultPack);
      set((state) => ({
        design,
        pack: defaultPack,
        selectedId: null,
        revision: state.revision + 1,
        past: [...state.past, state.design].slice(-HISTORY_LIMIT),
        future: [],
      }));
    },

    arrange: () => {
      commit((design) => autoLayout(design, get().pack));
      set((state) => ({ revision: state.revision + 1 }));
    },

    undo: () =>
      set((state) => {
        const previous = state.past[state.past.length - 1];
        if (!previous) return state;
        persist(previous, state.pack);
        return {
          design: previous,
          past: state.past.slice(0, -1),
          future: [state.design, ...state.future].slice(0, HISTORY_LIMIT),
        };
      }),

    redo: () =>
      set((state) => {
        const [next, ...rest] = state.future;
        if (!next) return state;
        persist(next, state.pack);
        return {
          design: next,
          past: [...state.past, state.design].slice(-HISTORY_LIMIT),
          future: rest,
        };
      }),
  };
});

/** Looks up a definition in the active pack. */
export const useDef = (defId: string | undefined): ResourceDef | undefined =>
  useDesign((state) => state.pack.resources.find((def) => def.id === defId));

export const useSelectedNode = (): GraphNode | undefined =>
  useDesign((state) => state.design.nodes.find((node) => node.id === state.selectedId));
