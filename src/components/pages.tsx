/**
 * The non-canvas tabs.
 *
 * Deploy and State are deliberately honest: this app generates Terraform and
 * the pipeline that runs it, and never holds a credential or runs `apply`
 * itself. They show exactly what to commit and what to configure.
 */

import { useMemo } from 'react';
import { Icon } from './Icon';
import { highlightHcl } from './highlight';
import { autoLayout } from '@/core/layout';
import { azurePipeline, defaultBackend, defaultPipelineOptions } from '@/core/export';
import { generate } from '@/core/generate';
import { templates } from '@/packs/templates';
import { useDesign } from '@/store/useDesign';

/* -------------------------------------------------------------------------- */

export function TemplatesPage({ onOpen }: { onOpen: () => void }) {
  const loadDesign = useDesign((state) => state.loadDesign);
  const pack = useDesign((state) => state.pack);

  return (
    <div className="page">
      <div className="page__inner">
        <h2>Templates</h2>
        <p className="page__lead">
          Start from a working design instead of a blank canvas. Everything stays editable — a
          template is just a design someone already drew.
        </p>

        <div className="card-grid">
          {templates.map((template) => (
            <button
              type="button"
              className="template-card"
              key={template.id}
              onClick={() => {
                loadDesign(autoLayout(template.build(), pack));
                onOpen();
              }}
            >
              <div className="template-card__title">{template.title}</div>
              <div className="template-card__text">{template.description}</div>
              <div className="template-card__meta">{template.tags.join(' · ')}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function DeployPage() {
  const pipeline = useMemo(
    () => azurePipeline(defaultPipelineOptions(), defaultBackend()),
    [],
  );

  return (
    <div className="page">
      <div className="page__inner">
        <h2>Deploy</h2>
        <p className="page__lead">
          This tool generates Terraform and the Azure Pipelines definition that applies it. It does
          not run <code className="inline">terraform apply</code> itself and never asks for a
          credential — your pipeline already has one, and that is the right place for it.
        </p>

        <div className="card">
          <h3 className="card__title">
            <Icon name="play" size={16} />
            Getting from this canvas to a deployment
          </h3>
          <ol className="steps">
            <li>
              Use <strong>Download Terraform</strong> to get the module and{' '}
              <code className="inline">azure-pipelines.yml</code>.
            </li>
            <li>
              Commit the folder to your Azure Repos repository, typically under{' '}
              <code className="inline">infra/</code>.
            </li>
            <li>
              Create an ARM service connection with rights on the target subscription and on the
              state storage account.
            </li>
            <li>
              Create an Azure DevOps environment and attach approval checks to it. The apply stage
              is gated on that environment.
            </li>
            <li>
              Install the Terraform extension by Microsoft DevLabs, then create a pipeline pointing
              at the YAML file.
            </li>
          </ol>
        </div>

        <div className="card">
          <h3 className="card__title">
            <Icon name="check" size={16} />
            What the pipeline does
          </h3>
          <p className="card__text">
            Three stages. <strong>Validate</strong> checks formatting and runs{' '}
            <code className="inline">terraform validate</code>. <strong>Plan</strong> produces a
            plan and publishes it as a build artifact. <strong>Apply</strong> downloads that exact
            artifact and applies it, so what a reviewer approved is what reaches Azure — not a
            fresh plan computed after the approval.
          </p>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '15px 17px 0' }}>
            <h3 className="card__title">
              <Icon name="code" size={16} />
              azure-pipelines.yml
            </h3>
            <p className="card__text">
              Generated with the default settings. The download dialog lets you change the service
              connection, environment and paths.
            </p>
          </div>
          <div className="code__body" style={{ margin: 15, maxHeight: 400 }}>
            <pre>
              <code>{pipeline}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function StatePage() {
  const design = useDesign((state) => state.design);
  const pack = useDesign((state) => state.pack);

  const providers = useMemo(() => {
    const result = generate(design, pack, { backend: defaultBackend() });
    return result.files.find((file) => file.path === 'providers.tf')?.contents ?? '';
  }, [design, pack]);

  return (
    <div className="page">
      <div className="page__inner">
        <h2>State</h2>
        <p className="page__lead">
          Terraform state records what actually exists in Azure. It is written by whoever runs
          Terraform — your pipeline — and lives in a storage account, not in this browser.
        </p>

        <div className="card">
          <h3 className="card__title">
            <Icon name="alert" size={16} />
            Reading live state is not wired up
          </h3>
          <p className="card__text">
            Showing real resources here would mean this app holding Azure credentials and reaching
            your state file. That is a backend, and a meaningful security decision, so it is not
            something to add quietly. Until you ask for it, this tab explains the configuration
            rather than pretending to read it. Your pipeline logs and{' '}
            <code className="inline">terraform show</code> remain the source of truth.
          </p>
        </div>

        <div className="card">
          <h3 className="card__title">
            <Icon name="layers" size={16} />
            Before the first run
          </h3>
          <p className="card__text" style={{ marginBottom: 10 }}>
            The backend cannot create its own storage account. Create it once, out of band:
          </p>
          <div className="code__body" style={{ margin: 0 }}>
            <pre>
              <code>{`az group create --name rg-terraform-state --location westeurope

az storage account create \\
  --name sttfstate \\
  --resource-group rg-terraform-state \\
  --sku Standard_LRS \\
  --encryption-services blob \\
  --min-tls-version TLS1_2

az storage container create \\
  --name tfstate \\
  --account-name sttfstate`}</code>
            </pre>
          </div>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '15px 17px 0' }}>
            <h3 className="card__title">
              <Icon name="code" size={16} />
              providers.tf
            </h3>
          </div>
          <div className="code__body" style={{ margin: 15, maxHeight: 340 }}>
            <pre>
              <code>{highlightHcl(providers)}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

interface SettingsPageProps {
  theme: 'light' | 'dark';
  onThemeChange: (theme: 'light' | 'dark') => void;
}

export function SettingsPage({ theme, onThemeChange }: SettingsPageProps) {
  const pack = useDesign((state) => state.pack);
  const design = useDesign((state) => state.design);
  const region = useDesign((state) => state.design.region);
  const setRegion = useDesign((state) => state.setRegion);
  const reset = useDesign((state) => state.reset);

  return (
    <div className="page">
      <div className="page__inner">
        <h2>Settings</h2>
        <p className="page__lead">
          Designs are stored in this browser only. Export to a repository to share or keep them.
        </p>

        <div className="card">
          <h3 className="card__title">
            <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={16} />
            Appearance
          </h3>
          <div className="radio-row" style={{ marginTop: 8 }}>
            {(['light', 'dark'] as const).map((option) => (
              <label className="radio" key={option}>
                <input
                  type="radio"
                  name="theme"
                  checked={theme === option}
                  onChange={() => onThemeChange(option)}
                />
                {option === 'light' ? 'Light' : 'Dark'}
              </label>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="card__title">
            <Icon name="globe" size={16} />
            Default region
          </h3>
          <p className="card__text" style={{ marginBottom: 10 }}>
            Applied to new resource groups. Existing resources keep the region they were given.
          </p>
          <select className="input" value={region} onChange={(event) => setRegion(event.target.value)} style={{ maxWidth: 300 }}>
            {(pack.regions ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="card">
          <h3 className="card__title">
            <Icon name="layers" size={16} />
            Provider pack
          </h3>
          <p className="card__text">
            <strong>{pack.label}</strong> — {pack.resources.filter((def) => !def.hidden).length}{' '}
            resource types across {pack.categories.length} categories.
            {Object.entries(pack.requiredProviders ?? {}).map(([name, spec]) => (
              <span key={name}>
                {' '}
                Uses <code className="inline">{spec.source} {spec.version}</code>.
              </span>
            ))}
          </p>
          <p className="card__text" style={{ marginTop: 8 }}>
            Resource types are data, not code. A new provider — or your own module library — is
            added by contributing a pack, without changing the editor.
          </p>
        </div>

        <div className="card">
          <h3 className="card__title">
            <Icon name="trash" size={16} />
            Reset
          </h3>
          <p className="card__text" style={{ marginBottom: 10 }}>
            Clears the current design ({design.nodes.length} resources) from this browser. Export
            first if you want to keep it.
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (window.confirm('Delete the current design? This cannot be undone.')) reset();
            }}
          >
            Clear design
          </button>
        </div>
      </div>
    </div>
  );
}
