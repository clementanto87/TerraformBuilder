import type { ResourceDef } from '@/core/types';
import {
  CIDR_PATTERN,
  INHERIT_RESOURCE_GROUP,
  NAME_PATTERNS,
  RESOURCE_GROUP,
  SUBNET,
  VIRTUAL_NETWORK,
  placementFields,
} from './common';

export const resourceGroup: ResourceDef = {
  id: RESOURCE_GROUP,
  kind: 'resource',
  provider: 'azurerm',
  category: 'foundation',
  label: 'Resource Group',
  summary: 'The container every other Azure resource lives in.',
  terraformType: 'azurerm_resource_group',
  icon: 'group',
  accent: '#0f6cbd',
  namePrefix: 'rg',
  container: { accepts: ['*'], minWidth: 420, minHeight: 220 },
  fields: [
    {
      key: 'location',
      label: 'Region',
      type: 'select',
      required: true,
      help: 'Every resource inside inherits this region unless it overrides it.',
    },
  ],
  subtitle: (values) => (values.location ? String(values.location) : undefined),
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/resource_group',
};

export const virtualNetwork: ResourceDef = {
  id: VIRTUAL_NETWORK,
  kind: 'resource',
  provider: 'azurerm',
  category: 'networking',
  label: 'Virtual Network',
  summary: 'Private address space that subnets carve up.',
  terraformType: 'azurerm_virtual_network',
  icon: 'vnet',
  accent: '#2563eb',
  namePrefix: 'vnet',
  container: { accepts: [SUBNET], minWidth: 460, minHeight: 220 },
  inherits: INHERIT_RESOURCE_GROUP,
  fields: [
    {
      key: 'address_space',
      label: 'Address space',
      type: 'list',
      required: true,
      default: ['10.0.0.0/16'],
      placeholder: '10.0.0.0/16',
      help: 'One or more CIDR ranges for the network.',
    },
    {
      key: 'dns_servers',
      label: 'Custom DNS servers',
      type: 'list',
      advanced: true,
      help: 'Leave empty to use Azure-provided DNS.',
    },
    ...placementFields(),
  ],
  subtitle: (values) => {
    const space = values.address_space;
    return Array.isArray(space) && space.length > 0 ? String(space[0]) : undefined;
  },
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/virtual_network',
};

export const subnet: ResourceDef = {
  id: SUBNET,
  kind: 'resource',
  provider: 'azurerm',
  category: 'networking',
  label: 'Subnet',
  summary: 'A range inside a virtual network that resources attach to.',
  terraformType: 'azurerm_subnet',
  icon: 'subnet',
  accent: '#3b82f6',
  namePrefix: 'snet',
  container: {
    accepts: [
      'azurerm_linux_virtual_machine',
      'azurerm_windows_virtual_machine',
      'azurerm_linux_virtual_machine_scale_set',
      'azurerm_service_plan',
      'azurerm_linux_web_app',
      'azurerm_storage_account',
      'azurerm_mssql_server',
      'azurerm_kubernetes_cluster',
      'azurerm_private_endpoint',
      'azurerm_container_app',
      'azurerm_linux_function_app',
      'azurerm_mysql_flexible_server',
      'azurerm_cosmosdb_account',
    ],
    minWidth: 300,
    minHeight: 170,
  },
  inherits: [
    { key: 'resource_group_name', fromDef: RESOURCE_GROUP, attr: 'name' },
    { key: 'virtual_network_name', fromDef: VIRTUAL_NETWORK, attr: 'name' },
  ],
  fields: [
    {
      key: 'address_prefixes',
      label: 'Address prefixes',
      type: 'list',
      required: true,
      default: ['10.0.1.0/24'],
      placeholder: '10.0.1.0/24',
    },
    {
      key: 'service_endpoints',
      label: 'Service endpoints',
      type: 'multiselect',
      advanced: true,
      options: [
        { label: 'Storage', value: 'Microsoft.Storage' },
        { label: 'SQL', value: 'Microsoft.Sql' },
        { label: 'Key Vault', value: 'Microsoft.KeyVault' },
        { label: 'Cosmos DB', value: 'Microsoft.AzureCosmosDB' },
        { label: 'Container Registry', value: 'Microsoft.ContainerRegistry' },
      ],
    },
    {
      key: 'private_endpoint_network_policies',
      label: 'Private endpoint network policies',
      type: 'select',
      advanced: true,
      options: [
        { label: 'Disabled', value: 'Disabled' },
        { label: 'Enabled', value: 'Enabled' },
      ],
    },
    {
      key: 'resource_group_name',
      label: 'Resource group',
      type: 'string',
      required: true,
      advanced: true,
      help: 'Inherited from the enclosing resource group.',
    },
    {
      key: 'virtual_network_name',
      label: 'Virtual network',
      type: 'string',
      required: true,
      advanced: true,
      help: 'Inherited from the virtual network this sits inside.',
    },
  ],
  subtitle: (values) => {
    const prefixes = values.address_prefixes;
    return Array.isArray(prefixes) && prefixes.length > 0 ? String(prefixes[0]) : undefined;
  },
  validate: (node) => {
    const prefixes = node.values.address_prefixes;
    if (!Array.isArray(prefixes)) return [];
    return prefixes
      .filter((prefix) => typeof prefix === 'string' && !new RegExp(CIDR_PATTERN).test(prefix))
      .map((prefix) => ({
        level: 'error' as const,
        nodeId: node.id,
        field: 'address_prefixes',
        message: `${node.name}: "${String(prefix)}" is not a valid CIDR range.`,
      }));
  },
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/subnet',
};

export const networkSecurityGroup: ResourceDef = {
  id: 'azurerm_network_security_group',
  kind: 'resource',
  provider: 'azurerm',
  category: 'networking',
  label: 'Network Security Group',
  summary: 'Allow and deny rules applied to subnets or interfaces.',
  terraformType: 'azurerm_network_security_group',
  icon: 'shield',
  accent: '#7c3aed',
  namePrefix: 'nsg',
  inherits: INHERIT_RESOURCE_GROUP,
  connections: [
    {
      to: [SUBNET],
      label: 'protects',
      applies: { on: 'source', key: 'subnet_id', attr: 'id' },
    },
  ],
  fields: [...placementFields()],
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/network_security_group',
};

export const publicIp: ResourceDef = {
  id: 'azurerm_public_ip',
  kind: 'resource',
  provider: 'azurerm',
  category: 'networking',
  label: 'Public IP',
  summary: 'A routable address for internet-facing resources.',
  terraformType: 'azurerm_public_ip',
  icon: 'globe',
  accent: '#0ea5e9',
  namePrefix: 'pip',
  inherits: INHERIT_RESOURCE_GROUP,
  fields: [
    {
      key: 'allocation_method',
      label: 'Allocation',
      type: 'select',
      required: true,
      default: 'Static',
      options: [
        { label: 'Static', value: 'Static' },
        { label: 'Dynamic', value: 'Dynamic' },
      ],
    },
    {
      key: 'sku',
      label: 'SKU',
      type: 'select',
      default: 'Standard',
      options: [
        { label: 'Standard', value: 'Standard' },
        { label: 'Basic', value: 'Basic' },
      ],
    },
    {
      key: 'domain_name_label',
      label: 'DNS label',
      type: 'string',
      advanced: true,
      pattern: NAME_PATTERNS.dnsLabel,
      patternMessage: 'Use lowercase letters, digits and hyphens.',
      help: 'Produces <label>.<region>.cloudapp.azure.com.',
    },
    ...placementFields(),
  ],
  subtitle: (values) => (values.sku ? `${String(values.sku)} · ${String(values.allocation_method ?? '')}`.trim() : undefined),
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/public_ip',
};

export const loadBalancer: ResourceDef = {
  id: 'azurerm_lb',
  kind: 'resource',
  provider: 'azurerm',
  category: 'networking',
  label: 'Load Balancer',
  summary: 'Layer 4 distribution across a backend pool.',
  terraformType: 'azurerm_lb',
  icon: 'balance',
  accent: '#0891b2',
  namePrefix: 'lb',
  inherits: INHERIT_RESOURCE_GROUP,
  connections: [
    {
      to: ['azurerm_linux_virtual_machine', 'azurerm_linux_virtual_machine_scale_set'],
      label: 'balances',
    },
  ],
  fields: [
    {
      key: 'sku',
      label: 'SKU',
      type: 'select',
      default: 'Standard',
      options: [
        { label: 'Standard', value: 'Standard' },
        { label: 'Basic', value: 'Basic' },
        { label: 'Gateway', value: 'Gateway' },
      ],
    },
    {
      key: 'name',
      label: 'Frontend configuration name',
      type: 'string',
      block: 'frontend_ip_configuration',
      default: 'frontend',
      advanced: true,
    },
    ...placementFields(),
  ],
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/lb',
};

export const applicationGateway: ResourceDef = {
  id: 'azurerm_application_gateway',
  kind: 'resource',
  provider: 'azurerm',
  category: 'networking',
  label: 'Application Gateway',
  summary: 'Layer 7 routing, TLS termination and WAF.',
  terraformType: 'azurerm_application_gateway',
  icon: 'gateway',
  accent: '#16a34a',
  namePrefix: 'appgw',
  inherits: INHERIT_RESOURCE_GROUP,
  connections: [
    {
      to: ['azurerm_linux_virtual_machine', 'azurerm_linux_web_app', 'azurerm_linux_virtual_machine_scale_set'],
      label: 'routes to',
    },
  ],
  fields: [
    {
      key: 'name',
      label: 'SKU',
      type: 'select',
      block: 'sku',
      required: true,
      default: 'Standard_v2',
      options: [
        { label: 'Standard_v2', value: 'Standard_v2' },
        { label: 'WAF_v2', value: 'WAF_v2' },
      ],
    },
    {
      key: 'tier',
      label: 'Tier',
      type: 'select',
      block: 'sku',
      required: true,
      default: 'Standard_v2',
      options: [
        { label: 'Standard_v2', value: 'Standard_v2' },
        { label: 'WAF_v2', value: 'WAF_v2' },
      ],
    },
    {
      key: 'capacity',
      label: 'Instance count',
      type: 'number',
      block: 'sku',
      default: 2,
      min: 1,
      max: 125,
    },
    ...placementFields(),
  ],
  subtitle: (values) => (values.name ? String(values.name) : undefined),
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/application_gateway',
};

export const firewall: ResourceDef = {
  id: 'azurerm_firewall',
  kind: 'resource',
  provider: 'azurerm',
  category: 'networking',
  label: 'Azure Firewall',
  summary: 'Managed, stateful network firewall.',
  terraformType: 'azurerm_firewall',
  icon: 'shield',
  accent: '#dc2626',
  namePrefix: 'fw',
  inherits: INHERIT_RESOURCE_GROUP,
  fields: [
    {
      key: 'sku_name',
      label: 'SKU name',
      type: 'select',
      required: true,
      default: 'AZFW_VNet',
      options: [
        { label: 'Virtual network', value: 'AZFW_VNet' },
        { label: 'Virtual hub', value: 'AZFW_Hub' },
      ],
    },
    {
      key: 'sku_tier',
      label: 'SKU tier',
      type: 'select',
      required: true,
      default: 'Standard',
      options: [
        { label: 'Standard', value: 'Standard' },
        { label: 'Premium', value: 'Premium' },
        { label: 'Basic', value: 'Basic' },
      ],
    },
    {
      key: 'threat_intel_mode',
      label: 'Threat intelligence',
      type: 'select',
      advanced: true,
      options: [
        { label: 'Alert', value: 'Alert' },
        { label: 'Deny', value: 'Deny' },
        { label: 'Off', value: 'Off' },
      ],
    },
    ...placementFields(),
  ],
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/firewall',
};

export const dnsZone: ResourceDef = {
  id: 'azurerm_dns_zone',
  kind: 'resource',
  provider: 'azurerm',
  category: 'networking',
  label: 'DNS Zone',
  summary: 'Public DNS hosting for a domain.',
  terraformType: 'azurerm_dns_zone',
  icon: 'dns',
  accent: '#4f46e5',
  namePrefix: 'dns',
  inherits: [{ key: 'resource_group_name', fromDef: RESOURCE_GROUP, attr: 'name' }],
  fields: [
    {
      key: 'resource_group_name',
      label: 'Resource group',
      type: 'string',
      required: true,
      advanced: true,
    },
  ],
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/dns_zone',
};

export const privateEndpoint: ResourceDef = {
  id: 'azurerm_private_endpoint',
  kind: 'resource',
  provider: 'azurerm',
  category: 'networking',
  label: 'Private Endpoint',
  summary: 'Brings a PaaS service onto a private IP in your subnet.',
  terraformType: 'azurerm_private_endpoint',
  icon: 'link',
  accent: '#0d9488',
  namePrefix: 'pe',
  inherits: [
    ...INHERIT_RESOURCE_GROUP,
    { key: 'subnet_id', fromDef: SUBNET, attr: 'id' },
  ],
  connections: [
    {
      to: ['azurerm_storage_account', 'azurerm_mssql_server', 'azurerm_cosmosdb_account', 'azurerm_key_vault'],
      label: 'connects to',
      applies: { on: 'source', key: 'private_connection_resource_id', attr: 'id' },
    },
  ],
  fields: [
    {
      key: 'subnet_id',
      label: 'Subnet',
      type: 'string',
      required: true,
      advanced: true,
      help: 'Inherited from the subnet this sits inside.',
    },
    {
      key: 'name',
      label: 'Connection name',
      type: 'string',
      block: 'private_service_connection',
      default: 'primary',
      advanced: true,
    },
    {
      key: 'is_manual_connection',
      label: 'Manual approval',
      type: 'boolean',
      block: 'private_service_connection',
      default: false,
      advanced: true,
    },
    ...placementFields(),
  ],
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/private_endpoint',
};

export const networkingResources: ResourceDef[] = [
  resourceGroup,
  virtualNetwork,
  subnet,
  publicIp,
  loadBalancer,
  applicationGateway,
  firewall,
  dnsZone,
  privateEndpoint,
  networkSecurityGroup,
];
