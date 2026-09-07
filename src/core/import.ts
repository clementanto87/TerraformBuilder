/**
 * Terraform importer: existing `.tf` source in, canvas design out.
 *
 * Resource types the active pack does not know about are not an error — a
 * definition is synthesised from the attributes actually present, so an
 * unfamiliar codebase still renders, is still editable, and still round-trips
 * back to Terraform.
 */

import { autoLayout } from './layout';
import { findReferences, parseHcl, toJson, type HclBlockNode, type HclValueNode } from './parse';
import {
  emptyDesign,
  nodeRef,
  type Design,
  type FieldDef,
  type GraphEdge,
  type GraphNode,
  type JsonValue,
  type ProviderPack,
  type ResourceDef,
} from './types';

export interface ImportResult {
  design: Design;
  /** Definitions synthesised for types the pack did not contain. */
  discovered: ResourceDef[];
  warnings: string[];
  stats: { resources: number; modules: number; data: number; edges: number };
}

export interface ImportInput {
  path: string;
  contents: string;
}

let sequence = 0;
const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(sequence += 1)}`;

/** Best-effort field type from an observed value. */
function inferType(value: HclValueNode): FieldDef['type'] {
  if (value.kind === 'literal') {
    if (typeof value.value === 'number') return 'number';
    if (typeof value.value === 'boolean') return 'boolean';
    return 'string';
  }
  if (value.kind === 'list') return 'list';
  if (value.kind === 'object') return 'keyvalue';
  return 'string';
}

/** Turns `virtual_network_name` into `Virtual network name`. */
const humanize = (key: string): string =>
  key.replace(/_/g, ' ').replace(/^./, (char) => char.toUpperCase());

const titleize = (type: string): string =>
  type
    .replace(/^[a-z]+_/, '')
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/**
 * Builds a definition for an unknown resource type from what its blocks
 * actually contain, so it behaves like a first-class catalog entry.
 */
function synthesizeDef(
  terraformType: string,
  kind: ResourceDef['kind'],
  samples: HclBlockNode[],
): ResourceDef {
  const fields = new Map<string, FieldDef>();

  for (const sample of samples) {
    for (const [key, value] of Object.entries(sample.body.attributes)) {
      // `name` is modelled by GraphNode.name, and `tags` has its own tab.
      if (key === 'name' || key === 'tags' || fields.has(key)) continue;
      fields.set(key, {
        key,
        label: humanize(key),
        type: inferType(value),
        raw: value.kind === 'expr',
      });
    }
  }

  return {
    id: terraformType,
    kind,
    provider: terraformType.split('_')[0] ?? 'imported',
    category: 'imported',
    label: kind === 'module' ? titleize(terraformType.split('/').pop() ?? 'Module') : titleize(terraformType),
    terraformType,
    icon: kind === 'module' ? 'module' : 'resource',
    accent: '#64748b',
    namePrefix: 'imported',
    summary: `Discovered in the imported configuration as ${terraformType}.`,
    fields: [...fields.values()],
  };
}

export function importTerraform(inputs: ImportInput[], pack: ProviderPack): ImportResult {
  const warnings: string[] = [];
  const design = emptyDesign(pack.id, pack.defaultRegion ?? '');

  // Pass 1 — collect every declaration so references can resolve either way.
  interface Declaration {
    address: string;
    terraformType: string;
    label: string;
    kind: ResourceDef['kind'];
    block: HclBlockNode;
  }
  const declarations: Declaration[] = [];

  for (const input of inputs) {
    let body;
    try {
      body = parseHcl(input.contents);
    } catch (error) {
      warnings.push(`${input.path}: ${(error as Error).message}`);
      continue;
    }

    for (const node of body.blocks) {
      if (node.type === 'resource' && node.labels.length >= 2) {
        declarations.push({
          address: `${node.labels[0]}.${node.labels[1]}`,
          terraformType: node.labels[0],
          label: node.labels[1],
          kind: 'resource',
          block: node,
        });
      } else if (node.type === 'data' && node.labels.length >= 2) {
        declarations.push({
          address: `data.${node.labels[0]}.${node.labels[1]}`,
          terraformType: node.labels[0],
          label: node.labels[1],
          kind: 'data',
          block: node,
        });
      } else if (node.type === 'module' && node.labels.length >= 1) {
        const source = node.body.attributes.source;
        const sourceText = source ? String(toJson(source)) : node.labels[0];
        declarations.push({
          address: `module.${node.labels[0]}`,
          terraformType: sourceText,
          label: node.labels[0],
          kind: 'module',
          block: node,
        });
      }
    }
  }

  // Pass 2 — resolve or synthesise a definition per Terraform type.
  const byType = new Map<string, ResourceDef>(pack.resources.map((def) => [def.terraformType, def]));
  const discovered: ResourceDef[] = [];
  const samples = new Map<string, HclBlockNode[]>();
  for (const declaration of declarations) {
    const key = `${declaration.kind}:${declaration.terraformType}`;
    samples.set(key, [...(samples.get(key) ?? []), declaration.block]);
  }
  for (const [key, blocks] of samples) {
    const separator = key.indexOf(':');
    const kind = key.slice(0, separator) as ResourceDef['kind'];
    const terraformType = key.slice(separator + 1);
    const existing = byType.get(terraformType);
    if (existing && existing.kind === kind) continue;
    const def = synthesizeDef(terraformType, kind, blocks);
    discovered.push(def);
    byType.set(terraformType, def);
  }

  // Pass 3 — build nodes.
  const nodesByAddress = new Map<string, GraphNode>();
  for (const declaration of declarations) {
    const def = byType.get(declaration.terraformType);
    if (!def) continue;

    const attributes = declaration.block.body.attributes;
    const nameValue = attributes.name ? toJson(attributes.name) : undefined;
    const name =
      typeof nameValue === 'string' && nameValue.length > 0 ? nameValue : declaration.label;

    const values: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(attributes)) {
      if (key === 'name' || key === 'tags') continue;
      values[key] = toJson(value);
    }

    // Nested blocks flatten into the values map under their own keys, which is
    // where schema fields declaring `block:` expect to find them.
    for (const child of declaration.block.body.blocks) {
      const flattened: Record<string, JsonValue> = {};
      for (const [key, value] of Object.entries(child.body.attributes)) {
        flattened[key] = toJson(value);
      }
      for (const [key, value] of Object.entries(flattened)) {
        if (values[key] === undefined) values[key] = value;
      }
    }

    const tagsValue = attributes.tags ? toJson(attributes.tags) : undefined;
    const tags: Record<string, string> = {};
    if (tagsValue && typeof tagsValue === 'object' && !Array.isArray(tagsValue)) {
      for (const [key, value] of Object.entries(tagsValue)) tags[key] = String(value);
    }

    const node: GraphNode = {
      id: nextId('node'),
      defId: def.id,
      name,
      values,
      tags,
      position: { x: 0, y: 0 },
      parentId: null,
    };
    nodesByAddress.set(declaration.address, node);
    design.nodes.push(node);
  }

  // Pass 4 — references become parents (via inherit rules) or edges.
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();

  for (const declaration of declarations) {
    const node = nodesByAddress.get(declaration.address);
    if (!node) continue;
    const def = byType.get(declaration.terraformType);
    if (!def) continue;

    for (const [key, value] of Object.entries(declaration.block.body.attributes)) {
      for (const reference of findReferences(value)) {
        const address =
          reference.type === 'module'
            ? `module.${reference.name}`
            : `${reference.type}.${reference.name}`;
        const target = nodesByAddress.get(address);
        if (!target || target.id === node.id) continue;

        // An inherit rule means this reference was containment all along.
        const inherit = def.inherits?.find((rule) => rule.key === key);
        if (inherit && target.defId === inherit.fromDef) {
          node.parentId = target.id;
          delete node.values[key];
          continue;
        }

        // Otherwise store it as a typed reference and draw an edge.
        if (typeof node.values[key] === 'string') {
          node.values[key] = nodeRef(target.id, reference.attr ?? 'id') as unknown as JsonValue;
        }
        const signature = `${target.id}->${node.id}`;
        if (seenEdges.has(signature)) continue;
        seenEdges.add(signature);
        edges.push({ id: nextId('edge'), source: target.id, target: node.id, label: key });
      }
    }
  }

  design.edges = edges;
  design.name = inputs.length === 1 ? inputs[0].path.replace(/\.tf$/, '') : 'Imported configuration';

  const laid = autoLayout(design, {
    ...pack,
    resources: [...pack.resources, ...discovered],
  });

  return {
    design: laid,
    discovered,
    warnings,
    stats: {
      resources: declarations.filter((entry) => entry.kind === 'resource').length,
      modules: declarations.filter((entry) => entry.kind === 'module').length,
      data: declarations.filter((entry) => entry.kind === 'data').length,
      edges: edges.length,
    },
  };
}
