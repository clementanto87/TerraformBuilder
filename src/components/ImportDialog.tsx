/**
 * Import existing Terraform.
 *
 * Files are parsed in the browser and turned into a design. Types the pack
 * does not ship are synthesised from the code itself, so an unfamiliar
 * repository still renders and stays editable.
 */

import { useRef, useState } from 'react';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { importTerraform, type ImportInput, type ImportResult } from '@/core/import';
import { useDesign } from '@/store/useDesign';

interface ImportDialogProps {
  onClose: () => void;
}

export function ImportDialog({ onClose }: ImportDialogProps) {
  const pack = useDesign((state) => state.pack);
  const loadDesign = useDesign((state) => state.loadDesign);

  const [text, setText] = useState('');
  const [files, setFiles] = useState<ImportInput[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const inputs: ImportInput[] =
    files.length > 0 ? files : text.trim() ? [{ path: 'main.tf', contents: text }] : [];

  const preview = () => {
    setError(null);
    try {
      const outcome = importTerraform(inputs, pack);
      if (outcome.design.nodes.length === 0) {
        setError('No resources, data sources or modules were found in that Terraform.');
        setResult(null);
        return;
      }
      setResult(outcome);
    } catch (failure) {
      setError((failure as Error).message);
      setResult(null);
    }
  };

  const apply = () => {
    if (!result) return;
    loadDesign(result.design, result.discovered);
    onClose();
  };

  const readFiles = async (list: FileList | null) => {
    if (!list) return;
    const accepted = [...list].filter((file) => /\.(tf|tf\.json|hcl)$/i.test(file.name));
    const read = await Promise.all(
      accepted.map(async (file) => ({ path: file.name, contents: await file.text() })),
    );
    setFiles(read);
    setResult(null);
    setError(read.length === 0 ? 'Those files did not look like Terraform (.tf).' : null);
  };

  return (
    <Modal
      title="Import Terraform"
      icon="upload"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          {result ? (
            <button type="button" className="btn btn--primary" onClick={apply}>
              <Icon name="check" size={15} />
              Open {result.design.nodes.length} resources
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={preview} disabled={inputs.length === 0}>
              Analyse
            </button>
          )}
        </>
      }
    >
      <p className="card__text" style={{ marginBottom: 14 }}>
        Drop <code className="inline">.tf</code> files here, or paste a configuration. Everything is
        parsed locally in your browser — nothing is uploaded.
      </p>

      <div
        className={dragging ? 'dropzone dropzone--active' : 'dropzone'}
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void readFiles(event.dataTransfer.files);
        }}
      >
        <Icon name="upload" size={24} />
        <div>
          {files.length > 0
            ? `${files.length} file${files.length === 1 ? '' : 's'} ready`
            : 'Drop .tf files or click to browse'}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept=".tf,.hcl,.json"
        multiple
        hidden
        onChange={(event) => void readFiles(event.target.files)}
      />

      {files.length > 0 && (
        <div className="file-list">
          {files.map((file) => (
            <div className="file-list__item" key={file.path}>
              <Icon name="code" size={14} />
              {file.path}
              <span className="file-list__size">{file.contents.length} bytes</span>
            </div>
          ))}
        </div>
      )}

      {files.length === 0 && (
        <>
          <div className="field__label" style={{ margin: '16px 0 6px' }}>
            Or paste Terraform
          </div>
          <textarea
            className="input"
            style={{ minHeight: 168 }}
            value={text}
            spellCheck={false}
            placeholder={'resource "azurerm_resource_group" "main" {\n  name     = "rg-platform"\n  location = "westeurope"\n}'}
            onChange={(event) => {
              setText(event.target.value);
              setResult(null);
            }}
          />
        </>
      )}

      {error && (
        <div className="note note--error" style={{ marginTop: 14 }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 14 }}>
          <div className="note note--ok">
            Found {result.stats.resources} resources, {result.stats.modules} modules,{' '}
            {result.stats.data} data sources and {result.stats.edges} references.
            {result.discovered.length > 0 && (
              <>
                {' '}
                {result.discovered.length} type
                {result.discovered.length === 1 ? ' was' : 's were'} not in the catalog and{' '}
                {result.discovered.length === 1 ? 'was' : 'were'} reconstructed from your code.
              </>
            )}
          </div>

          {result.warnings.length > 0 && (
            <div className="note note--warn" style={{ marginTop: 8 }}>
              {result.warnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          )}

          <div className="note" style={{ marginTop: 8 }}>
            This replaces the current design. Export it first if you want to keep it.
          </div>
        </div>
      )}
    </Modal>
  );
}
