import { describe, expect, it } from 'vitest';
import { load } from 'js-yaml';
import {
  azurePipeline,
  buildBundle,
  defaultBackend,
  defaultPipelineOptions,
  slugify,
  type ExportOptions,
} from '../export';
import { azurePack } from '@/packs';
import { templates } from '@/packs/templates';

const options = (): ExportOptions => ({
  backend: defaultBackend(),
  pipeline: defaultPipelineOptions(),
  includePipeline: true,
  includeReadme: true,
});

const design = () => templates.find((entry) => entry.id === 'three-tier')!.build();

describe('buildBundle', () => {
  it('produces a repository layout, not a snippet', () => {
    const files = buildBundle(design(), azurePack, options()).map((file) => file.path);
    expect(files).toEqual(
      expect.arrayContaining([
        'providers.tf',
        'main.tf',
        'outputs.tf',
        'azure-pipelines.yml',
        'README.md',
        '.gitignore',
        '.terraform-builder.json',
      ]),
    );
    // Nothing sensitive is set in this template, so there is nothing to declare.
    expect(files).not.toContain('variables.tf');
  });

  it('adds variables.tf only once something sensitive is set', () => {
    const withSecret = design();
    const server = withSecret.nodes.find((node) => node.defId === 'azurerm_mssql_server')!;
    server.values.administrator_login_password = 'correct horse battery staple';

    const bundle = buildBundle(withSecret, azurePack, options());
    const variables = bundle.find((file) => file.path === 'variables.tf');
    expect(variables?.contents).toContain('sensitive   = true');

    // And the secret itself never reaches the code.
    for (const file of bundle) {
      if (file.path === '.terraform-builder.json') continue;
      expect(file.contents).not.toContain('correct horse battery staple');
    }
  });

  it('carries the design itself so the diagram can be reopened', () => {
    const bundle = buildBundle(design(), azurePack, options());
    const saved = bundle.find((file) => file.path === '.terraform-builder.json')!;
    const parsed = JSON.parse(saved.contents);
    expect(parsed.nodes).toHaveLength(design().nodes.length);
  });

  it('omits the pipeline when it is not wanted', () => {
    const files = buildBundle(design(), azurePack, { ...options(), includePipeline: false });
    expect(files.some((file) => file.path === 'azure-pipelines.yml')).toBe(false);
  });

  it('ignores state files and tfvars in .gitignore', () => {
    const bundle = buildBundle(design(), azurePack, options());
    const ignore = bundle.find((file) => file.path === '.gitignore')!.contents;
    expect(ignore).toContain('*.tfstate');
    expect(ignore).toContain('*.tfvars');
  });
});

describe('azurePipeline', () => {
  const yaml = () => azurePipeline(defaultPipelineOptions(), defaultBackend());

  it('is valid YAML', () => {
    expect(() => load(yaml())).not.toThrow();
  });

  it('defines validate, plan and apply in that order', () => {
    const parsed = load(yaml()) as { stages: { stage: string }[] };
    expect(parsed.stages.map((stage) => stage.stage)).toEqual(['validate', 'plan', 'apply']);
  });

  it('applies the plan that was reviewed, not a fresh one', () => {
    const parsed = load(yaml()) as {
      stages: { stage: string; jobs: Record<string, unknown>[] }[];
    };
    const plan = parsed.stages.find((stage) => stage.stage === 'plan')!;
    const apply = parsed.stages.find((stage) => stage.stage === 'apply')!;

    // The plan is published as an artifact...
    expect(JSON.stringify(plan)).toContain('"artifact":"tfplan"');
    // ...and the apply consumes that same artifact rather than re-planning.
    const applyText = JSON.stringify(apply);
    expect(applyText).toContain('tfplan');
    expect(applyText).toContain('"command":"apply"');
    expect(applyText).not.toContain('"command":"plan"');
  });

  it('gates the apply on an environment and the default branch', () => {
    const parsed = load(yaml()) as {
      stages: { stage: string; condition?: string; jobs: { environment?: string }[] }[];
    };
    const apply = parsed.stages.find((stage) => stage.stage === 'apply')!;
    expect(apply.jobs[0].environment).toBe('production');
    expect(apply.condition).toContain("refs/heads/main");
  });

  it('threads backend settings through every init', () => {
    const text = yaml();
    const inits = text.split('displayName: Terraform init').length - 1;
    expect(inits).toBe(3);
    expect(text).toContain("backendAzureRmContainerName: 'tfstate'");
    expect(text).toContain("backendServiceArm: 'azure-terraform'");
  });

  it('reflects custom pipeline options', () => {
    const text = azurePipeline(
      { ...defaultPipelineOptions(), serviceConnection: 'acme-arm', environment: 'prod-eu', defaultBranch: 'trunk' },
      defaultBackend(),
    );
    expect(text).toContain("backendServiceArm: 'acme-arm'");
    expect(text).toContain("environment: 'prod-eu'");
    expect(text).toContain('refs/heads/trunk');
    expect(() => load(text)).not.toThrow();
  });
});

describe('slugify', () => {
  it('makes a safe file name', () => {
    expect(slugify('My Azure Infrastructure')).toBe('my-azure-infrastructure');
    expect(slugify('  ***  ')).toBe('infrastructure');
  });
});
