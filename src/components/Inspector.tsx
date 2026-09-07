/**
 * The properties panel.
 *
 * Three tabs over the selected node: its schema fields, the edges it takes
 * part in, and its tags. Every control is generated from the resource
 * definition, so this component never mentions a specific resource type.
 */

import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import { Field, KeyValueEditor } from './fields';
import { useDesign } from '@/store/useDesign';
import type { FieldDef, GraphNode, JsonValue, ValidationIssue } from '@/core/types';

type Tab = 'properties' | 'connections' | 'tags';

interface InspectorProps {
  issues: ValidationIssue[];
}

export function Inspector({ issues }: InspectorProps) {
  const [tab, setTab] = useState<Tab>('properties');
  const design = useDesign((state) => state.design);
  const pack = useDesign((state) => state.pack);
  const selectedId = useDesign((state) => state.selectedId);

  const node = design.nodes.find((entry) => entry.id === selectedId);
  const def = pack.resources.find((entry) => entry.id === node?.defId);

  if (!node || !def) {
    return (
      <div className="inspector">
        <div className="inspector__tabs">
          <button type="button" className="inspector__tab" aria-selected>
            Properties
          </button>
        </div>
        <p className="inspector__empty">
          Select a resource on the canvas to configure it.
          <br />
          Its Terraform appears below as you type.
        </p>
      </div>
    );
  }

  return (
    <div className="inspector">
      <div className="inspector__tabs">
        {(['properties', 'connections', 'tags'] as Tab[]).map((entry) => (
          <button
            key={entry}
            type="button"
            className="inspector__tab"
            aria-selected={tab === entry}
            onClick={() => setTab(entry)}
          >
            {entry === 'properties' ? 'Properties' : entry === 'connections' ? 'Connections' : 'Tags'}
          </button>
        ))}
      </div>

      <div className="inspector__scroll">
        {tab === 'properties' && <Properties node={node} issues={issues} />}
        {tab === 'connections' && <Connections node={node} />}
        {tab === 'tags' && <Tags node={node} />}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Properties({ node, issues }: { node: GraphNode; issues: ValidationIssue[] }) {
  const pack = useDesign((state) => state.pack);
  const design = useDesign((state) => state.design);
  const setValue = useDesign((state) => state.setValue);
  const renameNode = useDesign((state) => state.renameNode);
  const removeNode = useDesign((state) => state.removeNode);
  const duplicateNode = useDesign((state) => state.duplicateNode);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const def = pack.resources.find((entry) => entry.id === node.defId)!;

  const errorsByField = useMemo(() => {
    const map = new Map<string, string>();
    for (const issue of issues) {
      if (issue.nodeId !== node.id || !issue.field || issue.level !== 'error') continue;
      if (!map.has(issue.field)) map.set(issue.field, issue.message);
    }
    return map;
  }, [issues, node.id]);

  /** Fields hidden by a `showIf` condition are not rendered at all. */
  const visible = (field: FieldDef): boolean => {
    const condition = field.showIf;
    if (!condition) return true;
    const actual = node.values[condition.key];
    if (condition.eq !== undefined) return actual === condition.eq;
    if (condition.neq !== undefined) return actual !== condition.neq;
    if (condition.oneOf) return condition.oneOf.includes(actual as JsonValue);
    return true;
  };

  const shown = def.fields.filter(visible);
  const basic = shown.filter((field) => !field.advanced);
  const advanced = shown.filter((field) => field.advanced);

  const renderField = (field: FieldDef) => {
    // A region field with no options of its own uses the provider's list.
    const options =
      field.options ?? (field.key === pack.regionKey ? pack.regions : undefined);

    const references = field.refTypes
      ? design.nodes.filter(
          (candidate) => candidate.id !== node.id && field.refTypes?.includes(candidate.defId),
        )
      : [];

    return (
      <Field
        key={field.key}
        field={options ? { ...field, options } : field}
        value={node.values[field.key]}
        error={errorsByField.get(field.key)}
        references={references}
        onChange={(value) => setValue(node.id, field.key, value)}
      />
    );
  };

  return (
    <>
      <div className="inspector__section">
        <div className="inspector__resource">
          <span className="inspector__resource-icon" style={{ background: def.accent }}>
            <Icon name={def.icon} size={18} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="inspector__resource-title">{def.label}</div>
            <div className="inspector__resource-sub">{def.terraformType}</div>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            title="Duplicate"
            aria-label="Duplicate resource"
            onClick={() => duplicateNode(node.id)}
          >
            <Icon name="copy" size={16} />
          </button>
          <button
            type="button"
            className="btn btn--danger btn--icon"
            title="Delete"
            aria-label="Delete resource"
            onClick={() => removeNode(node.id)}
          >
            <Icon name="trash" size={16} />
          </button>
        </div>
      </div>

      <div className="inspector__section">
        <div className="field">
          <label className="field__label" htmlFor="resource-name">
            Name<span className="field__required">*</span>
          </label>
          <input
            id="resource-name"
            className="input"
            value={node.name}
            aria-invalid={!node.name.trim()}
            onChange={(event) => renameNode(node.id, event.target.value)}
          />
          <div className="field__help">
            Used as the resource name and the Terraform label.
          </div>
        </div>

        {basic.map(renderField)}
      </div>

      {advanced.length > 0 && (
        <>
          <button
            type="button"
            className="disclosure"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((current) => !current)}
          >
            <Icon name="chevron" size={15} className="chevron" />
            Advanced Settings
            <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontWeight: 500 }}>
              {advanced.length}
            </span>
          </button>
          {showAdvanced && <div className="inspector__section">{advanced.map(renderField)}</div>}
        </>
      )}

      {def.docs && (
        <div className="inspector__section">
          <a
            className="btn btn--ghost"
            href={def.docs}
            target="_blank"
            rel="noreferrer noopener"
            style={{ textDecoration: 'none' }}
          >
            <Icon name="help" size={15} />
            Provider documentation
          </a>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function Connections({ node }: { node: GraphNode }) {
  const design = useDesign((state) => state.design);
  const pack = useDesign((state) => state.pack);
  const removeEdge = useDesign((state) => state.removeEdge);
  const select = useDesign((state) => state.select);

  const related = design.edges.filter(
    (edge) => edge.source === node.id || edge.target === node.id,
  );

  const parent = node.parentId ? design.nodes.find((entry) => entry.id === node.parentId) : undefined;
  const children = design.nodes.filter((entry) => entry.parentId === node.id);

  return (
    <div className="inspector__section">
      {parent && (
        <>
          <div className="field__label" style={{ marginBottom: 4 }}>
            Contained in
          </div>
          <div className="connection">
            <span className="connection__dir">Parent</span>
            <div className="connection__body">
              <div className="connection__name">{parent.name}</div>
              <div className="connection__type">
                {pack.resources.find((def) => def.id === parent.defId)?.terraformType}
              </div>
            </div>
            <button type="button" className="btn btn--ghost btn--icon" onClick={() => select(parent.id)} aria-label={`Select ${parent.name}`}>
              <Icon name="chevron" size={15} />
            </button>
          </div>
        </>
      )}

      {children.length > 0 && (
        <>
          <div className="field__label" style={{ margin: '14px 0 4px' }}>
            Contains ({children.length})
          </div>
          {children.map((child) => (
            <div className="connection" key={child.id}>
              <span className="connection__dir">Child</span>
              <div className="connection__body">
                <div className="connection__name">{child.name}</div>
                <div className="connection__type">
                  {pack.resources.find((def) => def.id === child.defId)?.terraformType}
                </div>
              </div>
              <button type="button" className="btn btn--ghost btn--icon" onClick={() => select(child.id)} aria-label={`Select ${child.name}`}>
                <Icon name="chevron" size={15} />
              </button>
            </div>
          ))}
        </>
      )}

      <div className="field__label" style={{ margin: '14px 0 4px' }}>
        Links ({related.length})
      </div>

      {related.length === 0 ? (
        <p className="card__text">
          Drag from the dot on one resource to another to link them. Links become references in
          the generated code.
        </p>
      ) : (
        related.map((edge) => {
          const otherId = edge.source === node.id ? edge.target : edge.source;
          const other = design.nodes.find((entry) => entry.id === otherId);
          if (!other) return null;
          return (
            <div className="connection" key={edge.id}>
              <span className="connection__dir">{edge.source === node.id ? 'Out' : 'In'}</span>
              <div className="connection__body">
                <div className="connection__name">{other.name}</div>
                <div className="connection__type">
                  {pack.resources.find((def) => def.id === other.defId)?.terraformType}
                </div>
              </div>
              <button
                type="button"
                className="btn btn--danger btn--icon"
                aria-label={`Remove link to ${other.name}`}
                onClick={() => removeEdge(edge.id)}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Tags({ node }: { node: GraphNode }) {
  const setTags = useDesign((state) => state.setTags);

  return (
    <div className="inspector__section">
      <p className="card__text" style={{ marginBottom: 12 }}>
        Tags are emitted as a <code className="inline">tags</code> block on this resource.
      </p>
      <KeyValueEditor
        value={node.tags as unknown as JsonValue}
        keyPlaceholder="environment"
        valuePlaceholder="production"
        onChange={(value) => {
          const record: Record<string, string> = {};
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const [key, entry] of Object.entries(value)) record[key] = String(entry);
          }
          setTags(node.id, record);
        }}
      />
    </div>
  );
}
