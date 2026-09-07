import type { CategoryDef, ProviderPack, ResourceDef } from '@/core/types';
import { REGIONS } from './common';
import { computeResources } from './compute';
import { databaseResources, securityResources, storageResources } from './data';
import { networkingResources, resourceGroup } from './networking';

const categories: CategoryDef[] = [
  { id: 'foundation', label: 'Foundation', icon: 'group' },
  { id: 'compute', label: 'Compute', icon: 'vm' },
  { id: 'networking', label: 'Networking', icon: 'vnet' },
  { id: 'storage', label: 'Storage', icon: 'storage' },
  { id: 'databases', label: 'Databases', icon: 'sql' },
  { id: 'security', label: 'Security & Monitoring', icon: 'vault' },
  { id: 'custom', label: 'Modules', icon: 'module' },
  { id: 'imported', label: 'Imported', icon: 'resource' },
];

/**
 * A blank module node. This is the seam for a team's own Terraform: point it
 * at a registry address or a relative path, add inputs, and it generates a
 * `module` block like any other resource.
 */
export const customModule: ResourceDef = {
  id: 'custom_module',
  kind: 'module',
  provider: 'terraform',
  category: 'custom',
  label: 'Custom Module',
  summary: 'Any Terraform module — a registry address, a git URL or a local path.',
  terraformType: './modules/example',
  icon: 'module',
  accent: '#5b3df5',
  namePrefix: 'module',
  nameKey: false,
  container: { accepts: ['*'], minWidth: 340, minHeight: 180 },
  fields: [
    {
      key: 'source',
      label: 'Module source',
      type: 'string',
      required: true,
      placeholder: './modules/network',
      help: 'A local path, a git URL, or a Terraform registry address.',
    },
    { key: 'version', label: 'Version', type: 'string', placeholder: '1.2.0', help: 'Registry modules only.' },
    {
      key: 'inputs',
      label: 'Input variables',
      type: 'keyvalue',
      help: 'Each entry becomes an argument on the module block.',
    },
  ],
  subtitle: (values) => (values.source ? String(values.source) : undefined),
  /**
   * Modules take arbitrary inputs, so the whole block is rendered here rather
   * than through the field schema.
   */
  emit: (ctx) => {
    const lines: string[] = [`module "${ctx.label}" {`];
    const source = String(ctx.node.values.source ?? ctx.def.terraformType);
    const version = ctx.node.values.version;
    const inputs = (ctx.node.values.inputs ?? {}) as Record<string, unknown>;

    const keys = Object.keys(inputs).filter((key) => key.trim().length > 0);
    const width = Math.max(6, ...keys.map((key) => key.length), version ? 7 : 0);
    lines.push(`  ${'source'.padEnd(width)} = "${source}"`);
    if (version) lines.push(`  ${'version'.padEnd(width)} = "${String(version)}"`);
    if (keys.length > 0) lines.push('');
    for (const key of keys) {
      const value = String(inputs[key] ?? '');
      // Bare expressions pass through; anything else is quoted.
      const looksLikeExpression = /^[a-z_][a-z0-9_]*\.[A-Za-z0-9_.\[\]"-]+$/.test(value) ||
        /^(true|false|\d+(\.\d+)?|\[.*\]|\{.*\})$/.test(value);
      lines.push(`  ${key.padEnd(width)} = ${looksLikeExpression ? value : `"${value}"`}`);
    }
    if (Object.keys(ctx.node.tags).length > 0) {
      lines.push('');
      lines.push(`  tags = {`);
      for (const [key, value] of Object.entries(ctx.node.tags)) {
        if (!key.trim()) continue;
        lines.push(`    ${key} = "${value}"`);
      }
      lines.push('  }');
    }
    lines.push('}');
    return lines.join('\n');
  },
};

export const azurePack: ProviderPack = {
  id: 'azurerm',
  label: 'Microsoft Azure',
  description: 'Azure resources via the hashicorp/azurerm provider.',
  requiredProviders: {
    azurerm: { source: 'hashicorp/azurerm', version: '~> 3.100' },
  },
  providerBlock: ['provider "azurerm" {', '  features {}', '}'].join('\n'),
  categories,
  regions: REGIONS,
  defaultRegion: 'westeurope',
  regionKey: 'location',
  rootResource: resourceGroup.id,
  resources: [
    ...networkingResources,
    ...computeResources,
    ...storageResources,
    ...databaseResources,
    ...securityResources,
    customModule,
  ],
};
