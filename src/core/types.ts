/**
 * Provider-agnostic domain model.
 *
 * Nothing in this file (or anywhere else in `src/core`) knows that Azure
 * exists. A cloud is described entirely by data — a `ProviderPack` full of
 * `ResourceDef`s — which the generic engine renders, validates and emits.
 * Adding a provider, or importing a team's own Terraform modules, means
 * contributing data, never editing the engine.
 */

/** Anything that survives a round-trip through JSON / localStorage. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * A stored pointer from one node to another. Kept as data (not as a rendered
 * HCL string) so that renaming a resource updates every expression that
 * refers to it.
 */
export type NodeRef = {
  __ref: string;
  attr: string;
};

export const isNodeRef = (value: unknown): value is NodeRef =>
  typeof value === 'object' && value !== null && '__ref' in value;

export const nodeRef = (id: string, attr = 'id'): NodeRef => ({ __ref: id, attr });

/* -------------------------------------------------------------------------- */
/* Field schema                                                               */
/* -------------------------------------------------------------------------- */

export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'textarea'
  | 'cidr'
  | 'keyvalue'
  | 'list'
  | 'reference'
  | 'password';

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

/** Conditional visibility, evaluated against the node's own values. */
export interface ShowIf {
  key: string;
  eq?: JsonValue;
  neq?: JsonValue;
  oneOf?: JsonValue[];
}

export interface FieldDef {
  /** The Terraform argument name. Also the key in `GraphNode.values`. */
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  default?: JsonValue;
  options?: SelectOption[];
  placeholder?: string;
  help?: string;
  /** Tucked behind the "Advanced settings" disclosure in the properties panel. */
  advanced?: boolean;
  /** Emit inside a nested block of this name rather than at the top level. */
  block?: string;
  showIf?: ShowIf;
  pattern?: string;
  patternMessage?: string;
  min?: number;
  max?: number;
  /** For `reference` fields: which resource definitions may be pointed at. */
  refTypes?: string[];
  refAttr?: string;
  /** UI-only field that never reaches the generated code. */
  emit?: false;
  /** Rendered as a masked input and routed through a variable on export. */
  sensitive?: boolean;
  /** Emit the value verbatim as an HCL expression instead of quoting it. */
  raw?: boolean;
  /**
   * Falls back to another field's value when this one is empty. Lets a nested
   * block reuse a top-level argument (an SSH block's `username` following
   * `admin_username`) without asking for it twice.
   */
  mirrors?: string;
}

/* -------------------------------------------------------------------------- */
/* Resource schema                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Pulls an argument off an ancestor on the canvas. This is how a subnet learns
 * its virtual network's name, or how anything learns its resource group,
 * without the engine hard-coding either concept.
 */
export interface InheritRule {
  /** Argument to emit on this resource. */
  key: string;
  /** Definition id of the ancestor to search for, nearest first. */
  fromDef: string;
  /** Attribute to read off that ancestor. */
  attr: string;
  /** Skip when the user has already set the argument by hand. Default true. */
  onlyIfUnset?: boolean;
}

export interface ContainerDef {
  /** Definition ids that may be dropped inside. `['*']` accepts anything. */
  accepts: string[];
  minWidth?: number;
  minHeight?: number;
  padding?: number;
}

/** What a drawn edge means in the generated code. */
export interface ConnectionRule {
  /** Definition ids this resource may connect to. */
  to: string[];
  label?: string;
  /**
   * Writes the connection into an argument. `on: 'target'` means the argument
   * lands on the resource at the far end of the edge instead of this one.
   */
  applies?: {
    on: 'source' | 'target';
    key: string;
    attr?: string;
    /** Append to a list argument rather than overwriting a scalar. */
    list?: boolean;
  };
}

export interface EmitContext {
  node: GraphNode;
  def: ResourceDef;
  /** Terraform address of this resource, e.g. `azurerm_subnet.web`. */
  address: string;
  design: Design;
  /** Terraform address of any node on the canvas. */
  addressOf: (nodeId: string) => string;
  /** This resource's Terraform local label. */
  label: string;
  /** Resolves a stored `NodeRef` to a Terraform expression. */
  resolve: (ref: NodeRef) => string;
  /** Nearest ancestor matching a definition id. */
  ancestor: (defId: string) => GraphNode | undefined;
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  nodeId?: string;
  field?: string;
  message: string;
}

export interface ResourceDef {
  /** Stable catalog id. For real resources this equals `terraformType`. */
  id: string;
  kind: 'resource' | 'data' | 'module';
  provider: string;
  category: string;
  label: string;
  summary?: string;
  /** `azurerm_subnet`, or the module source when `kind === 'module'`. */
  terraformType: string;
  moduleVersion?: string;
  icon: string;
  accent: string;
  /** Seeds the auto-generated resource name, e.g. `vm` -> `vm-1`. */
  namePrefix: string;
  /**
   * Argument that carries the resource's display name. `GraphNode.name` is the
   * single source of truth: it becomes both this argument and the Terraform
   * local label. `false` for resources that take no name at all.
   */
  nameKey?: string | false;
  container?: ContainerDef;
  inherits?: InheritRule[];
  fields: FieldDef[];
  connections?: ConnectionRule[];
  /** Second line shown on the canvas card. */
  subtitle?: (values: Record<string, JsonValue>) => string | undefined;
  /**
   * Arguments computed from context rather than typed by hand — wiring a
   * virtual machine to the network interface its own `companions` emit, say.
   * Merged in after schema fields.
   */
  derived?: (ctx: EmitContext) => Record<string, unknown>;
  /** Escape hatch: render the whole block yourself. */
  emit?: (ctx: EmitContext) => string;
  /** Extra top-level blocks this resource drags in (NICs, associations…). */
  companions?: (ctx: EmitContext) => string[];
  /** Definition-specific checks beyond required/pattern/range. */
  validate?: (node: GraphNode, design: Design) => ValidationIssue[];
  /** Hidden from the catalog; created implicitly by other resources. */
  hidden?: boolean;
  docs?: string;
}

export interface CategoryDef {
  id: string;
  label: string;
  icon: string;
}

export interface ProviderPack {
  id: string;
  label: string;
  description?: string;
  /** Rendered into `terraform { required_providers { … } }`. */
  requiredProviders?: Record<string, { source: string; version: string }>;
  providerBlock?: string;
  categories: CategoryDef[];
  resources: ResourceDef[];
  regions?: SelectOption[];
  defaultRegion?: string;
  /** Argument name carrying a resource's region, if the provider has one. */
  regionKey?: string;
  /** Definition id created automatically for a new design, if any. */
  rootResource?: string;
}

/* -------------------------------------------------------------------------- */
/* Graph                                                                      */
/* -------------------------------------------------------------------------- */

export interface GraphNode {
  id: string;
  defId: string;
  /** Terraform local name — the second label in `resource "type" "name"`. */
  name: string;
  values: Record<string, JsonValue>;
  tags: Record<string, string>;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  parentId?: string | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface Design {
  version: number;
  name: string;
  packId: string;
  region: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const emptyDesign = (packId: string, region: string): Design => ({
  version: 1,
  name: 'Untitled infrastructure',
  packId,
  region,
  nodes: [],
  edges: [],
});
