/**
 * Export the design as a Terraform module plus the pipeline that runs it.
 */

import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { Icon } from './Icon';
import {
  buildBundle,
  defaultBackend,
  defaultPipelineOptions,
  downloadZip,
  type ExportOptions,
} from '@/core/export';
import { useDesign } from '@/store/useDesign';

interface ExportDialogProps {
  onClose: () => void;
}

export function ExportDialog({ onClose }: ExportDialogProps) {
  const design = useDesign((state) => state.design);
  const pack = useDesign((state) => state.pack);

  const [options, setOptions] = useState<ExportOptions>(() => ({
    backend: defaultBackend(),
    pipeline: defaultPipelineOptions(),
    includePipeline: true,
    includeReadme: true,
  }));
  const [busy, setBusy] = useState(false);

  const files = useMemo(() => buildBundle(design, pack, options), [design, pack, options]);

  const setBackend = (key: string, value: string) =>
    setOptions((current) => ({
      ...current,
      backend: { ...current.backend, config: { ...current.backend.config, [key]: value } },
    }));

  const setPipeline = (key: keyof ExportOptions['pipeline'], value: string) =>
    setOptions((current) => ({
      ...current,
      pipeline: { ...current.pipeline, [key]: value },
    }));

  const download = async () => {
    setBusy(true);
    try {
      await downloadZip(files, design.name);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Download Terraform"
      icon="download"
      width={760}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void download()} disabled={busy}>
            <Icon name="download" size={15} />
            {busy ? 'Preparing…' : `Download ${files.length} files`}
          </button>
        </>
      }
    >
      <div className="card">
        <h3 className="card__title">
          <Icon name="layers" size={16} />
          Remote state
        </h3>
        <p className="card__text" style={{ marginBottom: 10 }}>
          Terraform keeps state in an Azure storage account. Create it before the first run — a
          backend cannot bootstrap itself.
        </p>
        <div className="field">
          <label className="field__label">Resource group</label>
          <input
            className="input"
            value={options.backend.config?.resource_group_name ?? ''}
            onChange={(event) => setBackend('resource_group_name', event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label">Storage account</label>
          <input
            className="input"
            value={options.backend.config?.storage_account_name ?? ''}
            onChange={(event) => setBackend('storage_account_name', event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label">Container</label>
          <input
            className="input"
            value={options.backend.config?.container_name ?? ''}
            onChange={(event) => setBackend('container_name', event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label">State key</label>
          <input
            className="input"
            value={options.backend.config?.key ?? ''}
            onChange={(event) => setBackend('key', event.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <h3 className="card__title">
          <Icon name="play" size={16} />
          Azure Pipelines
        </h3>
        <div className="field">
          <label className="field__label">Include pipeline</label>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={options.includePipeline}
            aria-label="Include pipeline"
            onClick={() =>
              setOptions((current) => ({ ...current, includePipeline: !current.includePipeline }))
            }
          />
        </div>

        {options.includePipeline && (
          <>
            <div className="field">
              <label className="field__label">Service connection</label>
              <input
                className="input"
                value={options.pipeline.serviceConnection}
                onChange={(event) => setPipeline('serviceConnection', event.target.value)}
              />
              <div className="field__help">The ARM service connection the pipeline authenticates with.</div>
            </div>
            <div className="field">
              <label className="field__label">Environment</label>
              <input
                className="input"
                value={options.pipeline.environment}
                onChange={(event) => setPipeline('environment', event.target.value)}
              />
              <div className="field__help">Approvals attach to this environment, gating the apply stage.</div>
            </div>
            <div className="field">
              <label className="field__label">Working directory</label>
              <input
                className="input"
                value={options.pipeline.workingDirectory}
                onChange={(event) => setPipeline('workingDirectory', event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field__label">Default branch</label>
              <input
                className="input"
                value={options.pipeline.defaultBranch}
                onChange={(event) => setPipeline('defaultBranch', event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field__label">Terraform version</label>
              <input
                className="input"
                value={options.pipeline.terraformVersion}
                onChange={(event) => setPipeline('terraformVersion', event.target.value)}
              />
            </div>
          </>
        )}
      </div>

      <div className="field__label">Contents</div>
      <div className="file-list">
        {files.map((file) => (
          <div className="file-list__item" key={file.path}>
            <Icon name={file.path.endsWith('.yml') ? 'play' : 'code'} size={14} />
            {file.path}
            <span className="file-list__size">{file.contents.split('\n').length} lines</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
