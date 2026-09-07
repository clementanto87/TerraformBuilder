import type { ResourceDef } from '@/core/types';
import { INHERIT_RESOURCE_GROUP, NAME_PATTERNS, placementFields } from './common';

/* -------------------------------- storage -------------------------------- */

export const storageAccount: ResourceDef = {
  id: 'azurerm_storage_account',
  kind: 'resource',
  provider: 'azurerm',
  category: 'storage',
  label: 'Storage Account',
  summary: 'Blobs, files, queues and tables.',
  terraformType: 'azurerm_storage_account',
  icon: 'storage',
  accent: '#0d9488',
  namePrefix: 'st',
  inherits: INHERIT_RESOURCE_GROUP,
  fields: [
    {
      key: 'account_tier',
      label: 'Performance tier',
      type: 'select',
      required: true,
      default: 'Standard',
      options: [
        { label: 'Standard', value: 'Standard' },
        { label: 'Premium', value: 'Premium' },
      ],
    },
    {
      key: 'account_replication_type',
      label: 'Replication',
      type: 'select',
      required: true,
      default: 'LRS',
      options: [
        { label: 'Locally redundant (LRS)', value: 'LRS' },
        { label: 'Zone redundant (ZRS)', value: 'ZRS' },
        { label: 'Geo redundant (GRS)', value: 'GRS' },
        { label: 'Geo-zone redundant (GZRS)', value: 'GZRS' },
        { label: 'Read-access geo redundant (RAGRS)', value: 'RAGRS' },
      ],
    },
    {
      key: 'account_kind',
      label: 'Account kind',
      type: 'select',
      advanced: true,
      default: 'StorageV2',
      options: [
        { label: 'StorageV2', value: 'StorageV2' },
        { label: 'BlobStorage', value: 'BlobStorage' },
        { label: 'FileStorage', value: 'FileStorage' },
      ],
    },
    {
      key: 'min_tls_version',
      label: 'Minimum TLS version',
      type: 'select',
      advanced: true,
      default: 'TLS1_2',
      options: [
        { label: 'TLS 1.2', value: 'TLS1_2' },
        { label: 'TLS 1.1', value: 'TLS1_1' },
      ],
    },
    {
      key: 'public_network_access_enabled',
      label: 'Public network access',
      type: 'boolean',
      advanced: true,
      default: true,
    },
    ...placementFields(),
  ],
  subtitle: (values) => `${String(values.account_tier ?? '')}_${String(values.account_replication_type ?? '')}`,
  validate: (node) => {
    if (new RegExp(NAME_PATTERNS.storageAccount).test(node.name)) return [];
    return [
      {
        level: 'error' as const,
        nodeId: node.id,
        field: 'name',
        message: `${node.name}: storage account names must be 3–24 lowercase letters and digits, with no hyphens.`,
      },
    ];
  },
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/storage_account',
};

const storageChild = (
  id: string,
  label: string,
  icon: string,
  containerKey: string,
): ResourceDef => ({
  id,
  kind: 'resource',
  provider: 'azurerm',
  category: 'storage',
  label,
  summary: `A ${label.toLowerCase()} inside a storage account.`,
  terraformType: id,
  icon,
  accent: '#14b8a6',
  namePrefix: label.toLowerCase().replace(/\s+/g, ''),
  connections: [
    {
      to: ['azurerm_storage_account'],
      label: 'stored in',
      applies: { on: 'source', key: containerKey, attr: containerKey.endsWith('_id') ? 'id' : 'name' },
    },
  ],
  fields: [
    {
      key: containerKey,
      label: 'Storage account',
      type: 'reference',
      required: true,
      refTypes: ['azurerm_storage_account'],
      refAttr: containerKey.endsWith('_id') ? 'id' : 'name',
    },
  ],
});

export const blobContainer: ResourceDef = {
  ...storageChild('azurerm_storage_container', 'Blob Container', 'blob', 'storage_account_name'),
  fields: [
    {
      key: 'storage_account_name',
      label: 'Storage account',
      type: 'reference',
      required: true,
      refTypes: ['azurerm_storage_account'],
      refAttr: 'name',
    },
    {
      key: 'container_access_type',
      label: 'Access level',
      type: 'select',
      default: 'private',
      options: [
        { label: 'Private', value: 'private' },
        { label: 'Blob', value: 'blob' },
        { label: 'Container', value: 'container' },
      ],
    },
  ],
};

export const fileShare = storageChild('azurerm_storage_share', 'File Share', 'share', 'storage_account_name');
export const queue = storageChild('azurerm_storage_queue', 'Queue', 'queue', 'storage_account_name');
export const table = storageChild('azurerm_storage_table', 'Table', 'table', 'storage_account_name');

/* ------------------------------- databases ------------------------------- */

export const sqlServer: ResourceDef = {
  id: 'azurerm_mssql_server',
  kind: 'resource',
  provider: 'azurerm',
  category: 'databases',
  label: 'SQL Server',
  summary: 'The logical server an Azure SQL database belongs to.',
  terraformType: 'azurerm_mssql_server',
  icon: 'sql',
  accent: '#be123c',
  namePrefix: 'sqlsrv',
  inherits: INHERIT_RESOURCE_GROUP,
  fields: [
    { key: 'version', label: 'Version', type: 'select', required: true, default: '12.0', options: [{ label: '12.0', value: '12.0' }] },
    { key: 'administrator_login', label: 'Admin login', type: 'string', required: true, default: 'sqladmin' },
    {
      key: 'administrator_login_password',
      label: 'Admin password',
      type: 'password',
      required: true,
      sensitive: true,
      help: 'Emitted as a sensitive variable, never as a literal.',
    },
    {
      key: 'minimum_tls_version',
      label: 'Minimum TLS version',
      type: 'select',
      advanced: true,
      default: '1.2',
      options: [{ label: '1.2', value: '1.2' }, { label: '1.1', value: '1.1' }],
    },
    ...placementFields(),
  ],
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/mssql_server',
};

export const sqlDatabase: ResourceDef = {
  id: 'azurerm_mssql_database',
  kind: 'resource',
  provider: 'azurerm',
  category: 'databases',
  label: 'Azure SQL Database',
  summary: 'A managed relational database.',
  terraformType: 'azurerm_mssql_database',
  icon: 'sql',
  accent: '#e11d48',
  namePrefix: 'sqldb',
  connections: [
    {
      to: ['azurerm_mssql_server'],
      label: 'hosted on',
      applies: { on: 'source', key: 'server_id', attr: 'id' },
    },
  ],
  fields: [
    {
      key: 'server_id',
      label: 'SQL server',
      type: 'reference',
      required: true,
      refTypes: ['azurerm_mssql_server'],
    },
    {
      key: 'sku_name',
      label: 'Service tier',
      type: 'select',
      required: true,
      default: 'S0',
      options: [
        { label: 'Basic', value: 'Basic' },
        { label: 'S0 (Standard)', value: 'S0' },
        { label: 'S1 (Standard)', value: 'S1' },
        { label: 'P1 (Premium)', value: 'P1' },
        { label: 'GP_Gen5_2 (General purpose)', value: 'GP_Gen5_2' },
      ],
    },
    {
      key: 'max_size_gb',
      label: 'Max size (GB)',
      type: 'number',
      advanced: true,
      default: 32,
      min: 1,
      max: 4096,
    },
    {
      key: 'zone_redundant',
      label: 'Zone redundant',
      type: 'boolean',
      advanced: true,
      default: false,
    },
  ],
  subtitle: (values) => (values.sku_name ? String(values.sku_name) : undefined),
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/mssql_database',
};

export const cosmosAccount: ResourceDef = {
  id: 'azurerm_cosmosdb_account',
  kind: 'resource',
  provider: 'azurerm',
  category: 'databases',
  label: 'Cosmos DB',
  summary: 'Globally distributed NoSQL database.',
  terraformType: 'azurerm_cosmosdb_account',
  icon: 'cosmos',
  accent: '#0891b2',
  namePrefix: 'cosmos',
  inherits: INHERIT_RESOURCE_GROUP,
  fields: [
    {
      key: 'offer_type',
      label: 'Offer type',
      type: 'select',
      required: true,
      default: 'Standard',
      options: [{ label: 'Standard', value: 'Standard' }],
    },
    {
      key: 'kind',
      label: 'API',
      type: 'select',
      required: true,
      default: 'GlobalDocumentDB',
      options: [
        { label: 'Core (SQL)', value: 'GlobalDocumentDB' },
        { label: 'MongoDB', value: 'MongoDB' },
      ],
    },
    {
      key: 'consistency_level',
      label: 'Consistency level',
      type: 'select',
      block: 'consistency_policy',
      required: true,
      default: 'Session',
      options: [
        { label: 'Session', value: 'Session' },
        { label: 'Eventual', value: 'Eventual' },
        { label: 'Bounded staleness', value: 'BoundedStaleness' },
        { label: 'Strong', value: 'Strong' },
        { label: 'Consistent prefix', value: 'ConsistentPrefix' },
      ],
    },
    {
      key: 'failover_priority',
      label: 'Failover priority',
      type: 'number',
      block: 'geo_location',
      default: 0,
      advanced: true,
    },
    ...placementFields(),
  ],
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/cosmosdb_account',
};

export const mysqlServer: ResourceDef = {
  id: 'azurerm_mysql_flexible_server',
  kind: 'resource',
  provider: 'azurerm',
  category: 'databases',
  label: 'MySQL Flexible Server',
  summary: 'Managed MySQL with flexible scaling.',
  terraformType: 'azurerm_mysql_flexible_server',
  icon: 'mysql',
  accent: '#0369a1',
  namePrefix: 'mysql',
  inherits: INHERIT_RESOURCE_GROUP,
  fields: [
    { key: 'administrator_login', label: 'Admin login', type: 'string', required: true, default: 'mysqladmin' },
    {
      key: 'administrator_password',
      label: 'Admin password',
      type: 'password',
      required: true,
      sensitive: true,
    },
    {
      key: 'sku_name',
      label: 'SKU',
      type: 'select',
      required: true,
      default: 'B_Standard_B1ms',
      options: [
        { label: 'Burstable B1ms', value: 'B_Standard_B1ms' },
        { label: 'General purpose D2ds v4', value: 'GP_Standard_D2ds_v4' },
        { label: 'Memory optimised E2ds v4', value: 'MO_Standard_E2ds_v4' },
      ],
    },
    {
      key: 'version',
      label: 'MySQL version',
      type: 'select',
      default: '8.0.21',
      options: [
        { label: '8.0.21', value: '8.0.21' },
        { label: '5.7', value: '5.7' },
      ],
    },
    ...placementFields(),
  ],
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/mysql_flexible_server',
};

/* -------------------------------- security ------------------------------- */

export const keyVault: ResourceDef = {
  id: 'azurerm_key_vault',
  kind: 'resource',
  provider: 'azurerm',
  category: 'security',
  label: 'Key Vault',
  summary: 'Secrets, keys and certificates.',
  terraformType: 'azurerm_key_vault',
  icon: 'vault',
  accent: '#9333ea',
  namePrefix: 'kv',
  inherits: INHERIT_RESOURCE_GROUP,
  fields: [
    {
      key: 'tenant_id',
      label: 'Tenant id',
      type: 'string',
      required: true,
      raw: true,
      default: 'data.azurerm_client_config.current.tenant_id',
      advanced: true,
      help: 'An HCL expression. Defaults to the tenant Terraform authenticates with.',
    },
    {
      key: 'sku_name',
      label: 'SKU',
      type: 'select',
      required: true,
      default: 'standard',
      options: [
        { label: 'Standard', value: 'standard' },
        { label: 'Premium', value: 'premium' },
      ],
    },
    {
      key: 'purge_protection_enabled',
      label: 'Purge protection',
      type: 'boolean',
      default: false,
      advanced: true,
    },
    {
      key: 'soft_delete_retention_days',
      label: 'Soft delete retention (days)',
      type: 'number',
      default: 7,
      min: 7,
      max: 90,
      advanced: true,
    },
    ...placementFields(),
  ],
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/key_vault',
};

export const logAnalytics: ResourceDef = {
  id: 'azurerm_log_analytics_workspace',
  kind: 'resource',
  provider: 'azurerm',
  category: 'security',
  label: 'Log Analytics',
  summary: 'Central workspace for logs and metrics.',
  terraformType: 'azurerm_log_analytics_workspace',
  icon: 'logs',
  accent: '#65a30d',
  namePrefix: 'log',
  inherits: INHERIT_RESOURCE_GROUP,
  fields: [
    {
      key: 'sku',
      label: 'SKU',
      type: 'select',
      default: 'PerGB2018',
      options: [{ label: 'Pay-as-you-go (PerGB2018)', value: 'PerGB2018' }],
    },
    { key: 'retention_in_days', label: 'Retention (days)', type: 'number', default: 30, min: 30, max: 730 },
    ...placementFields(),
  ],
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/log_analytics_workspace',
};

export const storageResources: ResourceDef[] = [storageAccount, blobContainer, fileShare, queue, table];
export const databaseResources: ResourceDef[] = [sqlDatabase, sqlServer, cosmosAccount, mysqlServer];
export const securityResources: ResourceDef[] = [keyVault, logAnalytics];
