/**
 * Schema-driven form controls.
 *
 * The properties panel never hard-codes a form. It walks a resource's
 * `fields` and renders each one from its `type`, which is why a new resource —
 * or a whole new provider — needs no UI work at all.
 */

import { useId } from 'react';
import { Icon } from './Icon';
import { isNodeRef, type FieldDef, type GraphNode, type JsonValue, type NodeRef } from '@/core/types';
import { nodeRef } from '@/core/types';

interface FieldProps {
  field: FieldDef;
  value: JsonValue | undefined;
  error?: string;
  /** Candidate targets for `reference` fields. */
  references?: GraphNode[];
  onChange: (value: JsonValue | undefined) => void;
}

const asString = (value: JsonValue | undefined): string =>
  value === undefined || value === null ? '' : String(value);

export function Field({ field, value, error, references = [], onChange }: FieldProps) {
  const id = useId();
  const stacked = field.type === 'textarea' || field.type === 'list' || field.type === 'keyvalue';

  return (
    <div className={stacked ? 'field field--stacked' : 'field'}>
      <label className="field__label" htmlFor={id}>
        {field.label}
        {field.required && <span className="field__required">*</span>}
      </label>

      <Control id={id} field={field} value={value} references={references} onChange={onChange} invalid={Boolean(error)} />

      {error ? (
        <div className="field__error">{error}</div>
      ) : (
        field.help && <div className="field__help">{field.help}</div>
      )}
    </div>
  );
}

interface ControlProps extends Omit<FieldProps, 'error'> {
  id: string;
  invalid: boolean;
}

function Control({ id, field, value, references = [], onChange, invalid }: ControlProps) {
  switch (field.type) {
    case 'boolean':
      return (
        <button
          type="button"
          id={id}
          className="switch"
          role="switch"
          aria-checked={value === true}
          aria-label={field.label}
          onClick={() => onChange(value === true ? false : true)}
        />
      );

    case 'select':
      return (
        <select
          id={id}
          className="input"
          value={asString(value)}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.value || undefined)}
        >
          <option value="">Not set</option>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );

    case 'multiselect': {
      const selected = Array.isArray(value) ? value.map(String) : [];
      return (
        <div>
          {(field.options ?? []).map((option) => (
            <label className="radio" key={option.value} style={{ display: 'flex', marginBottom: 4 }}>
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selected, option.value]
                    : selected.filter((entry) => entry !== option.value);
                  onChange(next.length > 0 ? next : undefined);
                }}
              />
              {option.label}
            </label>
          ))}
        </div>
      );
    }

    case 'textarea':
      return (
        <textarea
          id={id}
          className="input"
          value={asString(value)}
          placeholder={field.placeholder}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.value || undefined)}
        />
      );

    case 'number':
      return (
        <input
          id={id}
          className="input"
          type="number"
          value={asString(value)}
          min={field.min}
          max={field.max}
          placeholder={field.placeholder}
          aria-invalid={invalid}
          onChange={(event) =>
            onChange(event.target.value === '' ? undefined : Number(event.target.value))
          }
        />
      );

    case 'password':
      return (
        <input
          id={id}
          className="input"
          type="password"
          value={asString(value)}
          placeholder={field.placeholder}
          autoComplete="new-password"
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.value || undefined)}
        />
      );

    case 'list':
      return <ListEditor id={id} value={value} placeholder={field.placeholder} onChange={onChange} />;

    case 'keyvalue':
      return <KeyValueEditor value={value} onChange={onChange} />;

    case 'reference':
      return (
        <select
          id={id}
          className="input"
          value={isNodeRef(value) ? (value as NodeRef).__ref : ''}
          aria-invalid={invalid}
          onChange={(event) =>
            onChange(
              event.target.value
                ? (nodeRef(event.target.value, field.refAttr ?? 'id') as unknown as JsonValue)
                : undefined,
            )
          }
        >
          <option value="">Not set</option>
          {references.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      );

    default:
      return (
        <input
          id={id}
          className="input"
          type="text"
          value={asString(value)}
          placeholder={field.placeholder}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.value || undefined)}
        />
      );
  }
}

/** Edits a list of strings — address prefixes, DNS servers and the like. */
function ListEditor({
  id,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  value: JsonValue | undefined;
  placeholder?: string;
  onChange: (value: JsonValue | undefined) => void;
}) {
  const items = Array.isArray(value) ? value.map(String) : [];

  const update = (next: string[]) => {
    const cleaned = next.filter((entry, index) => entry.trim() !== '' || index === next.length - 1);
    onChange(cleaned.length > 0 ? cleaned : undefined);
  };

  return (
    <div>
      {items.map((item, index) => (
        <div key={index} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input
            id={index === 0 ? id : undefined}
            className="input"
            value={item}
            placeholder={placeholder}
            onChange={(event) => {
              const next = [...items];
              next[index] = event.target.value;
              update(next);
            }}
          />
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            aria-label="Remove entry"
            onClick={() => update(items.filter((_, position) => position !== index))}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="btn btn--ghost" onClick={() => onChange([...items, ''])}>
        <Icon name="plus" size={14} />
        Add
      </button>
    </div>
  );
}

/** Edits an arbitrary string map — tags, module inputs. */
export function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder = 'key',
  valuePlaceholder = 'value',
}: {
  value: JsonValue | undefined;
  onChange: (value: JsonValue | undefined) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const entries =
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value as Record<string, JsonValue>).map(
          ([key, entry]) => [key, String(entry)] as [string, string],
        )
      : [];

  const commit = (next: [string, string][]) => {
    const record: Record<string, JsonValue> = {};
    for (const [key, entry] of next) {
      if (key.trim()) record[key] = entry;
    }
    onChange(Object.keys(record).length > 0 ? record : undefined);
  };

  return (
    <div>
      {entries.map(([key, entry], index) => (
        <div className="tag-row" key={index}>
          <input
            className="input"
            value={key}
            placeholder={keyPlaceholder}
            onChange={(event) => {
              const next = [...entries];
              next[index] = [event.target.value, entry];
              commit(next);
            }}
          />
          <input
            className="input"
            value={entry}
            placeholder={valuePlaceholder}
            onChange={(event) => {
              const next = [...entries];
              next[index] = [key, event.target.value];
              commit(next);
            }}
          />
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            aria-label={`Remove ${key || 'entry'}`}
            onClick={() => commit(entries.filter((_, position) => position !== index))}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn--ghost"
        onClick={() => {
          const record: Record<string, JsonValue> = {};
          for (const [key, entry] of entries) record[key] = entry;
          // A blank key is a placeholder row until the user types into it.
          record[''] = '';
          onChange(record);
        }}
      >
        <Icon name="plus" size={14} />
        Add entry
      </button>
    </div>
  );
}
