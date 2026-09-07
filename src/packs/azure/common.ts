/**
 * Shared building blocks for the Azure pack. Everything here is plain data —
 * the engine reads it, it never reads the engine.
 */

import type { FieldDef, InheritRule, SelectOption } from '@/core/types';

export const RESOURCE_GROUP = 'azurerm_resource_group';
export const VIRTUAL_NETWORK = 'azurerm_virtual_network';
export const SUBNET = 'azurerm_subnet';

export const REGIONS: SelectOption[] = [
  { label: 'West Europe', value: 'westeurope' },
  { label: 'North Europe', value: 'northeurope' },
  { label: 'UK South', value: 'uksouth' },
  { label: 'UK West', value: 'ukwest' },
  { label: 'East US', value: 'eastus' },
  { label: 'East US 2', value: 'eastus2' },
  { label: 'West US 2', value: 'westus2' },
  { label: 'West US 3', value: 'westus3' },
  { label: 'Central US', value: 'centralus' },
  { label: 'Canada Central', value: 'canadacentral' },
  { label: 'Brazil South', value: 'brazilsouth' },
  { label: 'Sweden Central', value: 'swedencentral' },
  { label: 'Switzerland North', value: 'switzerlandnorth' },
  { label: 'Germany West Central', value: 'germanywestcentral' },
  { label: 'France Central', value: 'francecentral' },
  { label: 'Norway East', value: 'norwayeast' },
  { label: 'UAE North', value: 'uaenorth' },
  { label: 'South Africa North', value: 'southafricanorth' },
  { label: 'Central India', value: 'centralindia' },
  { label: 'South India', value: 'southindia' },
  { label: 'Southeast Asia', value: 'southeastasia' },
  { label: 'East Asia', value: 'eastasia' },
  { label: 'Japan East', value: 'japaneast' },
  { label: 'Korea Central', value: 'koreacentral' },
  { label: 'Australia East', value: 'australiaeast' },
  { label: 'Australia Southeast', value: 'australiasoutheast' },
];

/** Region and resource group both come from the enclosing resource group. */
export const INHERIT_RESOURCE_GROUP: InheritRule[] = [
  { key: 'resource_group_name', fromDef: RESOURCE_GROUP, attr: 'name' },
  { key: 'location', fromDef: RESOURCE_GROUP, attr: 'location' },
];

export const resourceGroupField = (): FieldDef => ({
  key: 'resource_group_name',
  label: 'Resource group',
  type: 'string',
  required: true,
  advanced: true,
  help: 'Taken from the resource group this sits inside on the canvas. Set it only to override.',
});

export const locationField = (): FieldDef => ({
  key: 'location',
  label: 'Region',
  type: 'select',
  options: REGIONS,
  required: true,
  advanced: true,
  help: 'Taken from the parent resource group unless set here.',
});

/** The pair every regional Azure resource needs. */
export const placementFields = (): FieldDef[] => [resourceGroupField(), locationField()];

export const tagsHelp = 'Tags are managed on the Tags tab and merged into the generated block.';

/** Azure resource-name rules that are worth catching before `terraform plan`. */
export const NAME_PATTERNS = {
  storageAccount: '^[a-z0-9]{3,24}$',
  dnsLabel: '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$',
  general: '^[A-Za-z0-9][A-Za-z0-9._-]{0,78}[A-Za-z0-9_]$',
} as const;

export const CIDR_PATTERN = '^(\\d{1,3}\\.){3}\\d{1,3}/\\d{1,2}$';
