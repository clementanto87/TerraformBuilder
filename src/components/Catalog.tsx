/**
 * The resource catalog.
 *
 * Entries are drag sources; the canvas is the drop target. Everything shown
 * here comes from the active pack's `resources`, so a new provider or an
 * imported module library appears without touching this component.
 */

import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import { useDesign } from '@/store/useDesign';
import type { ResourceDef } from '@/core/types';

export const DRAG_TYPE = 'application/x-terraform-resource';

interface CatalogProps {
  onImport: () => void;
}

export function Catalog({ onImport }: CatalogProps) {
  const pack = useDesign((state) => state.pack);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const search = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const visible = pack.resources.filter((def) => {
      if (def.hidden) return false;
      if (!search) return true;
      return (
        def.label.toLowerCase().includes(search) ||
        def.terraformType.toLowerCase().includes(search) ||
        (def.summary ?? '').toLowerCase().includes(search)
      );
    });

    return pack.categories
      .map((category) => ({
        category,
        items: visible.filter((def) => def.category === category.id),
      }))
      .filter((group) => group.items.length > 0);
  }, [pack, search]);

  const total = groups.reduce((count, group) => count + group.items.length, 0);

  return (
    <aside className="catalog">
      <div className="catalog__header">
        <h2 className="catalog__title">Resource Catalog</h2>
        <div className="catalog__search">
          <Icon name="search" size={15} />
          <input
            className="input"
            type="search"
            value={query}
            placeholder="Search resources..."
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search resources"
          />
        </div>
      </div>

      <div className="catalog__list">
        {!search && (
          <div className="catalog__all">
            <Icon name="layers" size={16} />
            All Resources
            <span style={{ marginLeft: 'auto', fontWeight: 500 }}>{total}</span>
          </div>
        )}

        {groups.map(({ category, items }) => {
          const open = search ? true : !collapsed[category.id];
          return (
            <div className="catalog__group" key={category.id}>
              <button
                type="button"
                className="catalog__group-header"
                aria-expanded={open}
                onClick={() =>
                  setCollapsed((current) => ({ ...current, [category.id]: !collapsed[category.id] }))
                }
              >
                <Icon name={category.icon} size={16} />
                {category.label}
                <Icon name="chevron" size={15} className="chevron" />
              </button>
              {open && items.map((def) => <CatalogItem key={def.id} def={def} />)}
            </div>
          );
        })}

        {groups.length === 0 && (
          <p className="catalog__empty">
            Nothing matches “{query}”.
            <br />
            Try a Terraform type such as <code className="inline">azurerm_subnet</code>.
          </p>
        )}
      </div>

      <div className="catalog__footer">
        <button type="button" className="btn" onClick={onImport}>
          <Icon name="upload" size={15} />
          Import Terraform
        </button>
      </div>
    </aside>
  );
}

function CatalogItem({ def }: { def: ResourceDef }) {
  const addNode = useDesign((state) => state.addNode);

  return (
    <button
      type="button"
      className="catalog__item"
      draggable
      title={`${def.summary ?? def.label}\n${def.terraformType}`}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, def.id);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      // Keyboard and click users get a sensible default placement.
      onClick={() => addNode(def.id, { x: 120, y: 120 })}
    >
      <span className="catalog__item-icon" style={{ background: def.accent }}>
        <Icon name={def.icon} size={14} />
      </span>
      {def.label}
    </button>
  );
}
