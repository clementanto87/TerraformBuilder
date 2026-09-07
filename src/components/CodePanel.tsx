/**
 * Live Terraform output.
 *
 * The code is derived from the design on every render, so it is never stale
 * and there is nothing to "refresh". The toggle switches between the selected
 * resource and the whole project.
 */

import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import { highlightHcl } from './highlight';
import { generate, generateOne } from '@/core/generate';
import { useDesign } from '@/store/useDesign';

export function CodePanel() {
  const design = useDesign((state) => state.design);
  const pack = useDesign((state) => state.pack);
  const selectedId = useDesign((state) => state.selectedId);
  const [scope, setScope] = useState<'selected' | 'project'>('selected');
  const [copied, setCopied] = useState(false);

  const showSelected = scope === 'selected' && Boolean(selectedId);

  const code = useMemo(() => {
    if (showSelected && selectedId) return generateOne(design, pack, selectedId);
    const result = generate(design, pack, { includeProvider: false });
    return result.files.map((file) => file.contents).join('\n');
  }, [design, pack, selectedId, showSelected]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be denied; the code is selectable either way.
    }
  };

  return (
    <section className="code">
      <header className="code__header">
        <Icon name="code" size={16} />
        <span className="code__title">Terraform Code</span>

        <div className="code__toggle" style={{ marginLeft: 10 }}>
          <button
            type="button"
            aria-pressed={scope === 'selected'}
            onClick={() => setScope('selected')}
            disabled={!selectedId}
            title={selectedId ? undefined : 'Select a resource first'}
          >
            Selected
          </button>
          <button type="button" aria-pressed={scope === 'project'} onClick={() => setScope('project')}>
            Project
          </button>
        </div>

        <button type="button" className="btn btn--ghost" style={{ marginLeft: 'auto' }} onClick={copy}>
          <Icon name={copied ? 'check' : 'copy'} size={15} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </header>

      <div className="code__body">
        <pre>
          <code>
            {code.trim()
              ? highlightHcl(code)
              : '# Add a resource to the canvas to see its Terraform here.'}
          </code>
        </pre>
      </div>
    </section>
  );
}
