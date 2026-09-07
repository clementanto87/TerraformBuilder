/**
 * The generic Terraform emitter.
 *
 * Everything here is driven by `ResourceDef` data: field schemas, inheritance
 * rules and connection rules. No provider is special-cased, so the same code
 * path emits Azure resources, AWS resources or a team's private modules.
 */

import { block, expr, joinBlocks, type Expr, type HclValue } from './hcl';
import {
  isNodeRef,
  type Design,
  type EmitContext,
  type FieldDef,
  type GraphNode,
  type JsonValue,
  type NodeRef,
  type ProviderPack,
  type ResourceDef,
} from './types';

export interface BackendConfig {
  type: 'azurerm' | 'local' | 'remote' | 'none';
  config?: Record<string, string>;
}

export interface GenerateOptions {
  backend?: BackendConfig;
  /** Emit `terraform {}` and `provider {}` blocks. */
  includeProvider?: boolean;
}

export interface GeneratedFile {
  path: string;
  contents: string;
}

export interface GenerateResult {
  files: GeneratedFile[];
  /** Convenience view of every file concatenated, for the code panel. */
  combined: string;
}

/* -------------------------------------------------------------------------- */
/* Naming                                                                     */
/* -------------------------------------------------------------------------- */

/** Coerces a display name into a valid HCL identifier. */
export function toIdentifier(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^[^A-Za-z_]+/, '');
  return cleaned.length > 0 ? cleaned : 'resource';
}

/**
 * Variable and output names avoid hyphens. They are legal in HCL identifiers,
 * but `var.web-01` reads as a subtraction to anyone skimming the diff.
 */
export const toSymbol = (name: string): string =>
  toIdentifier(name).toLowerCase().replace(/[^a-z0-9_]/g, '_');

/**
 * Terraform local labels must be unique per resource type. Duplicate names are
 * suffixed rather than rejected, so the canvas never blocks on a rename.
 */
function buildLabels(design: Design, defOf: (id: string) => ResourceDef | undefined): Map<string, string> {
  const labels = new Map<string, string>();
  const taken = new Map<string, number>();

  for (const node of design.nodes) {
    const def = defOf(node.defId);
    const base = toIdentifier(node.name || def?.namePrefix || 'resource');
    const scope = `${def?.terraformType ?? 'unknown'}::${base}`;
    const seen = taken.get(scope) ?? 0;
    taken.set(scope, seen + 1);
    labels.set(node.id, seen === 0 ? base : `${base}_${seen + 1}`);
  }
  return labels;
}

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

export interface GenerationContext {
  design: Design;
  pack: ProviderPack;
  defOf: (defId: string) => ResourceDef | undefined;
  nodeOf: (nodeId: string) => GraphNode | undefined;
  label: (nodeId: string) => string;
  address: (nodeId: string) => string;
  resolve: (ref: NodeRef) => string;
  ancestors: (node: GraphNode) => GraphNode[];
  ancestorOf: (node: GraphNode, defId: string) => GraphNode | undefined;
  /** Variables the design needs, collected while emitting. */
  variables: Map<string, { type: string; description: string; sensitive?: boolean; default?: HclValue }>;
}

export function createContext(design: Design, pack: ProviderPack): GenerationContext {
  const defs = new Map(pack.resources.map((def) => [def.id, def]));
  const nodes = new Map(design.nodes.map((node) => [node.id, node]));
  const defOf = (defId: string) => defs.get(defId);
  const nodeOf = (nodeId: string) => nodes.get(nodeId);
  const labels = buildLabels(design, defOf);

  const label = (nodeId: string) => labels.get(nodeId) ?? 'unknown';

  const address = (nodeId: string): string => {
    const node = nodeOf(nodeId);
    const def = node && defOf(node.defId);
    if (!node || !def) return 'null';
    if (def.kind === 'module') return `module.${label(nodeId)}`;
    if (def.kind === 'data') return `data.${def.terraformType}.${label(nodeId)}`;
    return `${def.terraformType}.${label(nodeId)}`;
  };

  const resolve = (ref: NodeRef): string => {
    const node = nodeOf(ref.__ref);
    if (!node) return 'null';
    return `${address(ref.__ref)}.${ref.attr}`;
  };

  const ancestors = (node: GraphNode): GraphNode[] => {
    const chain: GraphNode[] = [];
    const seen = new Set<string>([node.id]);
    let current = node.parentId ? nodeOf(node.parentId) : undefined;
    while (current && !seen.has(current.id)) {
      chain.push(current);
      seen.add(current.id);
      current = current.parentId ? nodeOf(current.parentId) : undefined;
    }
    return chain;
  };

  const ancestorOf = (node: GraphNode, defId: string) =>
    ancestors(node).find((candidate) => candidate.defId === defId);

  return {
    design,
    pack,
    defOf,
    nodeOf,
    label,
    address,
    resolve,
    ancestors,
    ancestorOf,
    variables: new Map(),
  };
}

/* -------------------------------------------------------------------------- */
/* Values                                                                     */
/* -------------------------------------------------------------------------- */

const isBlank = (value: JsonValue | undefined): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);

/** Converts a stored field value into something the HCL writer understands. */
function toHcl(value: JsonValue, field: FieldDef, ctx: GenerationContext): HclValue {
  if (isNodeRef(value)) return expr(ctx.resolve(value));
  if (field.raw && typeof value === 'string') return expr(value);
  if (field.type === 'number' && typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (field.type === 'boolean' && typeof value === 'string') return value === 'true';
  return value as HclValue;
}

/** Secrets never land in the generated code; they become input variables. */
function sensitiveRef(ctx: GenerationContext, node: GraphNode, field: FieldDef): Expr {
  const name = toSymbol(`${node.name}_${field.key}`);
  ctx.variables.set(name, {
    type: 'string',
    description: `${field.label} for ${node.name}.`,
    sensitive: true,
  });
  return expr(`var.${name}`);
}

/* -------------------------------------------------------------------------- */
/* Connection rules                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Turns drawn edges into arguments. Returns a per-node map of extra arguments
 * so that an edge on the canvas is genuinely the same thing as a reference in
 * the code.
 */
export function connectionArguments(ctx: GenerationContext): Map<string, Record<string, HclValue>> {
  const extra = new Map<string, Record<string, HclValue>>();

  const put = (nodeId: string, key: string, value: HclValue, list: boolean) => {
    const bucket = extra.get(nodeId) ?? {};
    if (list) {
      const current = Array.isArray(bucket[key]) ? (bucket[key] as HclValue[]) : [];
      bucket[key] = [...current, value];
    } else {
      bucket[key] = value;
    }
    extra.set(nodeId, bucket);
  };

  for (const edge of ctx.design.edges) {
    const source = ctx.nodeOf(edge.source);
    const target = ctx.nodeOf(edge.target);
    if (!source || !target) continue;

    // A user may draw an edge either way round, so try both endpoints as the
    // rule's owner and use whichever declares the relationship.
    for (const [owner, other] of [
      [source, target],
      [target, source],
    ] as const) {
      const rules = ctx.defOf(owner.defId)?.connections ?? [];
      const rule = rules.find(
        (candidate) => candidate.to.includes(other.defId) || candidate.to.includes('*'),
      );
      if (!rule?.applies) continue;

      const { on, key, attr = 'id', list = false } = rule.applies;
      // The argument lands on one end; the reference points at the other.
      const holder = on === 'source' ? owner : other;
      const referenced = on === 'source' ? other : owner;
      put(holder.id, key, expr(`${ctx.address(referenced.id)}.${attr}`), list);
      break;
    }
  }

  return extra;
}

/* -------------------------------------------------------------------------- */
/* Node emission                                                              */
/* -------------------------------------------------------------------------- */

function visible(field: FieldDef, values: Record<string, JsonValue>): boolean {
  const condition = field.showIf;
  if (!condition) return true;
  const actual = values[condition.key];
  if (condition.eq !== undefined) return actual === condition.eq;
  if (condition.neq !== undefined) return actual !== condition.neq;
  if (condition.oneOf) return condition.oneOf.includes(actual as JsonValue);
  return true;
}

export function emitNode(
  ctx: GenerationContext,
  node: GraphNode,
  connectionArgs: Record<string, HclValue> = {},
): string {
  const def = ctx.defOf(node.defId);
  if (!def) return `# Unknown resource definition: ${node.defId}`;

  const label = ctx.label(node.id);

  const emitContext: EmitContext = {
    node,
    def,
    address: ctx.address(node.id),
    label,
    design: ctx.design,
    addressOf: ctx.address,
    resolve: ctx.resolve,
    ancestor: (defId) => ctx.ancestorOf(node, defId),
  };

  if (def.emit) return def.emit(emitContext);

  const root =
    def.kind === 'module'
      ? block('module', label)
      : def.kind === 'data'
        ? block('data', def.terraformType, label)
        : block('resource', def.terraformType, label);

  if (def.kind === 'module') {
    root.attr('source', def.terraformType);
    root.attr('version', def.moduleVersion);
  }

  // The resource's own name.
  if (def.nameKey !== false) root.attr(def.nameKey ?? 'name', node.name);

  // Arguments pulled from ancestors on the canvas (resource group, VNet, …).
  for (const rule of def.inherits ?? []) {
    if (rule.onlyIfUnset !== false && !isBlank(node.values[rule.key])) continue;
    const ancestor = ctx.ancestorOf(node, rule.fromDef);
    if (!ancestor) continue;
    root.attr(rule.key, expr(`${ctx.address(ancestor.id)}.${rule.attr}`));
  }

  // Schema fields, with nested-block fields collected for a second pass.
  const blocks = new Map<string, Record<string, HclValue>>();
  for (const field of def.fields) {
    if (field.emit === false) continue;
    if (!visible(field, node.values)) continue;

    // An empty field may still borrow its value from another one.
    const own = node.values[field.key];
    const value = isBlank(own) && field.mirrors ? node.values[field.mirrors] : own;
    if (isBlank(value)) continue;

    const rendered = field.sensitive
      ? sensitiveRef(ctx, node, field)
      : toHcl(value as JsonValue, field, ctx);

    if (field.block) {
      blocks.set(field.block, { ...(blocks.get(field.block) ?? {}), [field.key]: rendered });
    } else {
      root.attr(field.key, rendered);
    }
  }

  // Arguments computed by the definition itself.
  for (const [key, value] of Object.entries(def.derived?.(emitContext) ?? {})) {
    root.attr(key, value as HclValue);
  }

  // Arguments contributed by drawn edges.
  for (const [key, value] of Object.entries(connectionArgs)) root.attr(key, value);

  const tags = Object.fromEntries(
    Object.entries(node.tags).filter(([key]) => key.trim().length > 0),
  );
  if (Object.keys(tags).length > 0) root.attr('tags', tags as HclValue);

  for (const [name, values] of blocks) {
    const nested = block(name);
    nested.attrs(values);
    root.block(nested);
  }

  const main = root.render();
  const companions = def.companions?.(emitContext) ?? [];
  return joinBlocks([main, ...companions]);
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                   */
/* -------------------------------------------------------------------------- */

/** Containers before their contents, then stable by category and name. */
function orderNodes(ctx: GenerationContext): GraphNode[] {
  const order = new Map(ctx.pack.categories.map((category, index) => [category.id, index]));
  return [...ctx.design.nodes].sort((a, b) => {
    const depth = ctx.ancestors(a).length - ctx.ancestors(b).length;
    if (depth !== 0) return depth;
    const defA = ctx.defOf(a.defId);
    const defB = ctx.defOf(b.defId);
    const category =
      (order.get(defA?.category ?? '') ?? 99) - (order.get(defB?.category ?? '') ?? 99);
    if (category !== 0) return category;
    const type = (defA?.terraformType ?? '').localeCompare(defB?.terraformType ?? '');
    if (type !== 0) return type;
    return a.name.localeCompare(b.name);
  });
}

/* -------------------------------------------------------------------------- */
/* Files                                                                      */
/* -------------------------------------------------------------------------- */

function providerFile(pack: ProviderPack, options: GenerateOptions): string {
  const terraform = block('terraform');
  terraform.attr('required_version', '>= 1.5.0');

  const required = pack.requiredProviders ?? {};
  if (Object.keys(required).length > 0) {
    const providers = block('required_providers');
    for (const [name, spec] of Object.entries(required)) {
      providers.attr(name, { source: spec.source, version: spec.version });
    }
    terraform.block(providers);
  }

  const backend = options.backend;
  if (backend && backend.type !== 'none') {
    const backendBlock = block('backend', backend.type);
    for (const [key, value] of Object.entries(backend.config ?? {})) backendBlock.attr(key, value);
    terraform.block(backendBlock);
  }

  return joinBlocks([terraform.render(), pack.providerBlock ?? '']);
}

function variablesFile(ctx: GenerationContext): string {
  const blocks: string[] = [];
  for (const [name, spec] of [...ctx.variables].sort(([a], [b]) => a.localeCompare(b))) {
    const variable = block('variable', name);
    variable.attr('type', expr(spec.type));
    variable.attr('description', spec.description);
    if (spec.default !== undefined) variable.attr('default', spec.default);
    if (spec.sensitive) variable.attr('sensitive', true);
    blocks.push(variable.render());
  }
  return joinBlocks(blocks);
}

function outputsFile(ctx: GenerationContext): string {
  const blocks: string[] = [];
  for (const node of ctx.design.nodes) {
    const def = ctx.defOf(node.defId);
    if (!def || def.kind === 'data' || def.container) continue;
    const output = block('output', `${toSymbol(node.name)}_id`);
    output.attr('description', `Resource id of ${node.name} (${def.label}).`);
    output.attr('value', expr(`${ctx.address(node.id)}.id`));
    blocks.push(output.render());
  }
  return joinBlocks(blocks);
}

/**
 * Generates a complete Terraform module from a design.
 */
export function generate(
  design: Design,
  pack: ProviderPack,
  options: GenerateOptions = {},
): GenerateResult {
  const ctx = createContext(design, pack);
  const connections = connectionArguments(ctx);

  const grouped = new Map<string, string[]>();
  for (const node of orderNodes(ctx)) {
    const def = ctx.defOf(node.defId);
    if (!def) continue;
    const rendered = emitNode(ctx, node, connections.get(node.id));
    const bucket = grouped.get(def.category) ?? [];
    bucket.push(`# ${def.label} — ${node.name}\n${rendered}`);
    grouped.set(def.category, bucket);
  }

  const sections: string[] = [];
  for (const category of pack.categories) {
    const bucket = grouped.get(category.id);
    if (!bucket || bucket.length === 0) continue;
    const banner = `#${'-'.repeat(76)}\n# ${category.label}\n#${'-'.repeat(76)}`;
    sections.push(`${banner}\n\n${bucket.join('\n\n')}`);
  }
  for (const [category, bucket] of grouped) {
    if (pack.categories.some((entry) => entry.id === category)) continue;
    sections.push(bucket.join('\n\n'));
  }

  const main = sections.join('\n\n');
  const variables = variablesFile(ctx);
  const outputs = outputsFile(ctx);

  const files: GeneratedFile[] = [];
  if (options.includeProvider !== false) {
    files.push({ path: 'providers.tf', contents: `${providerFile(pack, options)}\n` });
  }
  files.push({ path: 'main.tf', contents: main.length > 0 ? `${main}\n` : '# No resources yet.\n' });
  if (variables.length > 0) files.push({ path: 'variables.tf', contents: `${variables}\n` });
  if (outputs.length > 0) files.push({ path: 'outputs.tf', contents: `${outputs}\n` });

  return {
    files,
    combined: files.map((file) => `# ${file.path}\n\n${file.contents}`).join('\n'),
  };
}

/** Renders a single resource, for the properties-panel preview. */
export function generateOne(design: Design, pack: ProviderPack, nodeId: string): string {
  const ctx = createContext(design, pack);
  const node = ctx.nodeOf(nodeId);
  if (!node) return '';
  const def = ctx.defOf(node.defId);
  const connections = connectionArguments(ctx);
  const body = emitNode(ctx, node, connections.get(node.id));
  return def ? `# ${def.label}\n${body}\n` : `${body}\n`;
}
