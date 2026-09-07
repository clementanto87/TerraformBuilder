/**
 * The status bar: validity at a glance, with the full issue list one click
 * away. Clicking an issue selects the resource it belongs to.
 */

import { useEffect, useRef } from 'react';
import { Icon } from './Icon';
import { useDesign } from '@/store/useDesign';
import type { ValidationIssue } from '@/core/types';

interface StatusBarProps {
  issues: ValidationIssue[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StatusBar({ issues, open, onOpenChange }: StatusBarProps) {
  const design = useDesign((state) => state.design);
  const select = useDesign((state) => state.select);
  const panel = useRef<HTMLDivElement>(null);

  // The list floats over the catalog, so it has to be dismissable both ways or
  // it blocks whatever is underneath it.
  useEffect(() => {
    if (!open) return undefined;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as globalThis.Node;
      if (panel.current?.contains(target)) return;
      // Leave the toggle alone; its own handler closes the list.
      if ((target as HTMLElement).closest?.('.status')) return;
      onOpenChange(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, onOpenChange]);

  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');

  const state = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'ok';
  const label =
    state === 'error'
      ? `${errors.length} problem${errors.length === 1 ? '' : 's'}`
      : state === 'warn'
        ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`
        : 'Infrastructure valid';

  return (
    <>
      {open && issues.length > 0 && (
        <div className="issues" ref={panel}>
          {issues.map((issue, index) => (
            <button
              type="button"
              key={index}
              className={`issues__item issues__item--${issue.level}`}
              onClick={() => {
                if (issue.nodeId) select(issue.nodeId);
                onOpenChange(false);
              }}
            >
              <Icon name={issue.level === 'error' ? 'alert' : 'help'} size={14} />
              {issue.message}
            </button>
          ))}
        </div>
      )}

      <footer className="status">
        <button
          type="button"
          className={`btn btn--ghost status__pill status__pill--${state}`}
          onClick={() => onOpenChange(!open)}
          disabled={issues.length === 0}
        >
          <Icon name={state === 'ok' ? 'check' : 'alert'} size={15} />
          {label}
        </button>

        <span className="status__divider" />
        <span>
          {design.nodes.length} resource{design.nodes.length === 1 ? '' : 's'}
        </span>
        <span className="status__divider" />
        <span>
          {design.edges.length} connection{design.edges.length === 1 ? '' : 's'}
        </span>

        <span className="status__spacer" />
        <span className="status__brand">
          <Icon name="module" size={14} />
          Generates HCL for Terraform 1.5+
        </span>
      </footer>
    </>
  );
}
