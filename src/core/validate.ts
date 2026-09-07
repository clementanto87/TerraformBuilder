/**
 * Schema-driven validation. Like the emitter, it reads `ResourceDef` data and
 * knows nothing about any particular provider.
 */

import { connectionArguments, createContext } from './generate';
import {
  isNodeRef,
  type Design,
  type FieldDef,
  type GraphNode,
  type JsonValue,
  type ProviderPack,
  type ResourceDef,
  type ValidationIssue,
} from './types';

const isBlank = (value: JsonValue | undefined): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

function visible(field: FieldDef, values: Record<string, JsonValue>): boolean {
  const condition = field.showIf;
  if (!condition) return true;
  const actual = values[condition.key];
  if (condition.eq !== undefined) return actual === condition.eq;
  if (condition.neq !== undefined) return actual !== condition.neq;
  if (condition.oneOf) return condition.oneOf.includes(actual as JsonValue);
  return true;
}

function checkField(node: GraphNode, field: FieldDef): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const value = node.values[field.key];

  if (field.required && isBlank(value)) {
    issues.push({
      level: 'error',
      nodeId: node.id,
      field: field.key,
      message: `${node.name}: ${field.label} is required.`,
    });
    return issues;
  }

  if (isBlank(value) || isNodeRef(value)) return issues;

  if (field.pattern && typeof value === 'string') {
    if (!new RegExp(field.pattern).test(value)) {
      issues.push({
        level: 'error',
        nodeId: node.id,
        field: field.key,
        message: `${node.name}: ${field.patternMessage ?? `${field.label} is not in the expected format.`}`,
      });
    }
  }

  if (typeof value === 'number') {
    if (field.min !== undefined && value < field.min) {
      issues.push({
        level: 'error',
        nodeId: node.id,
        field: field.key,
        message: `${node.name}: ${field.label} must be at least ${field.min}.`,
      });
    }
    if (field.max !== undefined && value > field.max) {
      issues.push({
        level: 'error',
        nodeId: node.id,
        field: field.key,
        message: `${node.name}: ${field.label} must be at most ${field.max}.`,
      });
    }
  }

  return issues;
}

function checkContainment(
  node: GraphNode,
  def: ResourceDef,
  parent: GraphNode | undefined,
  parentDef: ResourceDef | undefined,
): ValidationIssue[] {
  if (!parent || !parentDef) return [];
  const accepts = parentDef.container?.accepts;
  if (!accepts) {
    return [
      {
        level: 'error',
        nodeId: node.id,
        message: `${parent.name} (${parentDef.label}) cannot contain other resources.`,
      },
    ];
  }
  if (accepts.includes('*') || accepts.includes(def.id)) return [];
  return [
    {
      level: 'error',
      nodeId: node.id,
      message: `${def.label} cannot be placed inside ${parentDef.label}.`,
    },
  ];
}

export function validate(design: Design, pack: ProviderPack): ValidationIssue[] {
  const ctx = createContext(design, pack);
  const fromEdges = connectionArguments(ctx);
  const issues: ValidationIssue[] = [];

  for (const node of design.nodes) {
    const def = ctx.defOf(node.defId);
    if (!def) {
      issues.push({
        level: 'error',
        nodeId: node.id,
        message: `${node.name}: unknown resource type "${node.defId}".`,
      });
      continue;
    }

    if (!node.name.trim()) {
      issues.push({ level: 'error', nodeId: node.id, message: 'A resource name is required.' });
    }

    // Arguments already supplied by an ancestor on the canvas, or by an edge
    // the user drew, are not theirs to fill in by hand.
    const supplied = new Set([
      ...(def.inherits ?? [])
        .filter((rule) => ctx.ancestorOf(node, rule.fromDef))
        .map((rule) => rule.key),
      ...Object.keys(fromEdges.get(node.id) ?? {}),
    ]);

    for (const field of def.fields) {
      if (!visible(field, node.values)) continue;
      if (supplied.has(field.key) && isBlank(node.values[field.key])) continue;
      issues.push(...checkField(node, field));
    }

    const parent = node.parentId ? ctx.nodeOf(node.parentId) : undefined;
    issues.push(...checkContainment(node, def, parent, parent && ctx.defOf(parent.defId)));

    // Inherited arguments are only satisfiable when the ancestor is present.
    for (const rule of def.inherits ?? []) {
      if (!isBlank(node.values[rule.key])) continue;
      if (ctx.ancestorOf(node, rule.fromDef)) continue;
      const required = def.fields.find((field) => field.key === rule.key)?.required;
      issues.push({
        level: required ? 'error' : 'warning',
        nodeId: node.id,
        field: rule.key,
        message: `${node.name}: no parent ${ctx.defOf(rule.fromDef)?.label ?? rule.fromDef} on the canvas to supply ${rule.key}.`,
      });
    }

    issues.push(...(def.validate?.(node, design) ?? []));
  }

  // Duplicate Terraform addresses would fail at `terraform validate`.
  const addresses = new Map<string, string[]>();
  for (const node of design.nodes) {
    const def = ctx.defOf(node.defId);
    if (!def) continue;
    const address = `${def.terraformType}.${node.name.trim().toLowerCase()}`;
    addresses.set(address, [...(addresses.get(address) ?? []), node.id]);
  }
  for (const [address, ids] of addresses) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      issues.push({
        level: 'warning',
        nodeId: id,
        message: `Duplicate name: ${ids.length} resources share the address ${address}. Names will be suffixed on export.`,
      });
    }
  }

  return issues;
}

export const errorCount = (issues: ValidationIssue[]): number =>
  issues.filter((issue) => issue.level === 'error').length;
