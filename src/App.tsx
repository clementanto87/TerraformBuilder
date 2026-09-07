import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';

import { Canvas } from './components/Canvas';
import { Catalog } from './components/Catalog';
import { CodePanel } from './components/CodePanel';
import { ExportDialog } from './components/ExportDialog';
import { Icon } from './components/Icon';
import { ImportDialog } from './components/ImportDialog';
import { Inspector } from './components/Inspector';
import { StatusBar } from './components/StatusBar';
import { DeployPage, SettingsPage, StatePage, TemplatesPage } from './components/pages';

import { validate } from './core/validate';
import { slugify } from './core/export';
import { useDesign } from './store/useDesign';
import type { Design } from './core/types';

type Tab = 'canvas' | 'templates' | 'deploy' | 'state' | 'settings';
type Theme = 'light' | 'dark';

const TABS: { id: Tab; label: string }[] = [
  { id: 'canvas', label: 'Canvas' },
  { id: 'templates', label: 'Templates' },
  { id: 'deploy', label: 'Deploy' },
  { id: 'state', label: 'State' },
  { id: 'settings', label: 'Settings' },
];

const THEME_KEY = 'terraform-builder:theme';

export default function App() {
  const [tab, setTab] = useState<Tab>('canvas');
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const design = useDesign((state) => state.design);
  const pack = useDesign((state) => state.pack);
  const setDesignName = useDesign((state) => state.setDesignName);
  const setRegion = useDesign((state) => state.setRegion);
  const loadDesign = useDesign((state) => state.loadDesign);
  const arrange = useDesign((state) => state.arrange);
  const undo = useDesign((state) => state.undo);
  const redo = useDesign((state) => state.redo);
  const canUndo = useDesign((state) => state.past.length > 0);
  const canRedo = useDesign((state) => state.future.length > 0);

  const openFile = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const issues = useMemo(() => validate(design, pack), [design, pack]);
  const errors = issues.filter((issue) => issue.level === 'error').length;

  // Undo and redo, without stealing the shortcut from a focused input.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (typing || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  /** Saves the design itself, so a diagram can be reopened and edited later. */
  const saveDesign = useCallback(() => {
    const blob = new Blob([JSON.stringify(design, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slugify(design.name)}.tfbuilder.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [design]);

  const openDesign = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Design;
      if (!Array.isArray(parsed.nodes)) throw new Error('Not a Terraform Builder design.');
      loadDesign(parsed);
      setTab('canvas');
    } catch (error) {
      window.alert(`Could not open that file: ${(error as Error).message}`);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand__mark">
            <Icon name="module" size={19} />
          </span>
          <div>
            <div className="brand__title">Terraform Builder</div>
            <div className="brand__subtitle">Design · Visualise · Generate</div>
          </div>
        </div>

        <nav className="tabs">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <span className="header__spacer" />

        <div className="header__actions">
          {tab === 'canvas' && (
            <>
              <select
                className="input"
                style={{ width: 158 }}
                value={design.region}
                aria-label="Default region"
                onChange={(event) => setRegion(event.target.value)}
              >
                {(pack.regions ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <span className="header__divider" />

              <button type="button" className="btn btn--ghost btn--icon" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
                <Icon name="undo" size={16} />
              </button>
              <button type="button" className="btn btn--ghost btn--icon" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
                <Icon name="redo" size={16} />
              </button>
              <button type="button" className="btn btn--ghost btn--icon" onClick={arrange} aria-label="Auto arrange" title="Auto arrange">
                <Icon name="grid" size={16} />
              </button>

              <span className="header__divider" />

              <button type="button" className="btn btn--ghost btn--icon" onClick={() => openFile.current?.click()} aria-label="Open design" title="Open a saved design">
                <Icon name="upload" size={16} />
              </button>
              <button type="button" className="btn btn--ghost btn--icon" onClick={saveDesign} aria-label="Save design" title="Save this design to a file">
                <Icon name="save" size={16} />
              </button>

              <span className="header__divider" />
            </>
          )}

          <button
            type="button"
            className="btn btn--ghost btn--icon"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
          </button>
        </div>
      </header>

      {tab === 'canvas' ? (
        <div className="workspace">
          <Catalog onImport={() => setImporting(true)} />

          <main className="canvas">
            <div className="canvas__bar">
              <div className="canvas__heading">
                <div className="canvas__name">
                  {renaming ? (
                    <input
                      className="input"
                      autoFocus
                      value={design.name}
                      onChange={(event) => setDesignName(event.target.value)}
                      onBlur={() => setRenaming(false)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === 'Escape') setRenaming(false);
                      }}
                    />
                  ) : (
                    <>
                      <h1>{design.name}</h1>
                      <button
                        type="button"
                        className="btn btn--ghost btn--icon"
                        aria-label="Rename design"
                        onClick={() => setRenaming(true)}
                      >
                        <Icon name="edit" size={15} />
                      </button>
                    </>
                  )}
                </div>
                <p className="canvas__hint">
                  Drag resources from the catalog, nest them to express containment, and the
                  Terraform writes itself.
                </p>
              </div>

              <div className="canvas__bar-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setIssuesOpen((current) => !current)}
                  title={errors > 0 ? `${errors} problems found` : 'No problems found'}
                >
                  <Icon name={errors > 0 ? 'alert' : 'check'} size={15} />
                  Validate
                </button>
                <button type="button" className="btn btn--primary" onClick={() => setExporting(true)}>
                  <Icon name="download" size={15} />
                  Download Terraform
                </button>
              </div>
            </div>

            <ReactFlowProvider>
              <Canvas issues={issues} />
            </ReactFlowProvider>
          </main>

          <div className="side">
            <Inspector issues={issues} />
            <CodePanel />
          </div>
        </div>
      ) : tab === 'templates' ? (
        <TemplatesPage onOpen={() => setTab('canvas')} />
      ) : tab === 'deploy' ? (
        <DeployPage />
      ) : tab === 'state' ? (
        <StatePage />
      ) : (
        <SettingsPage theme={theme} onThemeChange={setTheme} />
      )}

      <StatusBar issues={issues} open={issuesOpen} onOpenChange={setIssuesOpen} />

      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}

      <input
        ref={openFile}
        type="file"
        accept=".json"
        hidden
        onChange={(event) => {
          void openDesign(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </div>
  );
}
