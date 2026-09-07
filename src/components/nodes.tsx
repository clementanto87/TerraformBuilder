/**
 * Canvas node renderers.
 *
 * Two shapes cover everything: a card for leaf resources, and a framed region
 * for containers (resource groups, virtual networks, subnets, modules). Which
 * one a resource gets is decided by its definition, not by a hard-coded list.
 */

import type { CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Icon } from './Icon';
import { useDesign } from '@/store/useDesign';
import type { ResourceDef, GraphNode } from '@/core/types';

export interface NodePayload extends Record<string, unknown> {
  node: GraphNode;
  def: ResourceDef;
  errors: number;
}

export type ResourceFlowNode = Node<NodePayload, 'resource'>;
export type ContainerFlowNode = Node<NodePayload, 'container'>;

export function ResourceNode({ id, data, selected }: NodeProps<ResourceFlowNode>) {
  const removeNode = useDesign((state) => state.removeNode);
  const { node, def, errors } = data;
  const subtitle = def.subtitle?.(node.values);

  return (
    <div
      className={[
        'node',
        selected ? 'node--selected' : '',
        errors > 0 ? 'node--invalid' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ position: 'relative' }}
    >
      <Handle type="target" position={Position.Top} />

      <span className="node__icon" style={{ background: def.accent }}>
        <Icon name={def.icon} size={17} />
      </span>

      <div className="node__body">
        <div className="node__type">{def.label}</div>
        <div className="node__name">{node.name}</div>
        {subtitle && <div className="node__meta">{subtitle}</div>}
      </div>

      <button
        type="button"
        className="node__menu"
        title={`Delete ${node.name}`}
        aria-label={`Delete ${node.name}`}
        onClick={(event) => {
          event.stopPropagation();
          removeNode(id);
        }}
      >
        <Icon name="trash" size={14} />
      </button>

      {errors > 0 && (
        <span className="node__badge" title={`${errors} problem${errors === 1 ? '' : 's'}`}>
          {errors}
        </span>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function ContainerNode({ data, selected }: NodeProps<ContainerFlowNode>) {
  const { node, def, errors } = data;
  const subtitle = def.subtitle?.(node.values);

  return (
    <div
      className={[
        'container-node',
        selected ? 'container-node--selected' : '',
        errors > 0 ? 'container-node--invalid' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          position: 'relative',
          // A muted tint of the resource's own colour, so nested containers
          // stay distinguishable without a second background layer.
          '--accent-color': `${def.accent}66`,
        } as CSSProperties
      }
    >
      <Handle type="target" position={Position.Top} />

      <div className="container-node__header">
        <span className="container-node__icon" style={{ background: def.accent }}>
          <Icon name={def.icon} size={14} />
        </span>
        <div>
          <div className="container-node__title">{def.label}</div>
          <div className="container-node__subtitle">
            {node.name}
            {subtitle ? ` (${subtitle})` : ''}
          </div>
        </div>
      </div>

      {errors > 0 && <span className="node__badge">{errors}</span>}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export const nodeTypes = {
  resource: ResourceNode,
  container: ContainerNode,
};
