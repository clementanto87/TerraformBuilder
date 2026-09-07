/**
 * Starter designs.
 *
 * Each one is an ordinary `Design`; loading a template is the same code path
 * as opening a saved design. Positions are left at the origin because the
 * layout engine arranges them on load.
 */

import type { Design, GraphNode, JsonValue } from '@/core/types';

interface TemplateDef {
  id: string;
  title: string;
  description: string;
  tags: string[];
  build: () => Design;
}

const node = (
  id: string,
  defId: string,
  name: string,
  values: Record<string, JsonValue> = {},
  parentId: string | null = null,
): GraphNode => ({
  id,
  defId,
  name,
  values,
  tags: {},
  position: { x: 0, y: 0 },
  parentId,
});

const design = (name: string, nodes: GraphNode[], edges: Design['edges'] = []): Design => ({
  version: 1,
  name,
  packId: 'azurerm',
  region: 'westeurope',
  nodes,
  edges,
});

export const templates: TemplateDef[] = [
  {
    id: 'web-app',
    title: 'Web app with SQL',
    description:
      'An App Service on a Premium plan, an Azure SQL database and a storage account, inside a single resource group.',
    tags: ['App Service', 'SQL', 'Storage'],
    build: () =>
      design('Web application', [
        node('rg', 'azurerm_resource_group', 'rg-webapp', { location: 'westeurope' }),
        node('plan', 'azurerm_service_plan', 'asp-webapp', { os_type: 'Linux', sku_name: 'P1v3' }, 'rg'),
        node('app', 'azurerm_linux_web_app', 'app-webapp', { https_only: true }, 'rg'),
        node('sqlsrv', 'azurerm_mssql_server', 'sqlsrv-webapp', {
          version: '12.0',
          administrator_login: 'sqladmin',
        }, 'rg'),
        node('sqldb', 'azurerm_mssql_database', 'sqldb-webapp', { sku_name: 'S0', max_size_gb: 32 }, 'rg'),
        node('st', 'azurerm_storage_account', 'stwebappassets', {
          account_tier: 'Standard',
          account_replication_type: 'LRS',
        }, 'rg'),
      ], [
        { id: 'e1', source: 'plan', target: 'app' },
        { id: 'e2', source: 'sqlsrv', target: 'sqldb' },
      ]),
  },
  {
    id: 'three-tier',
    title: 'Three-tier network',
    description:
      'An application gateway in front of web virtual machines, an application subnet and a SQL database behind them.',
    tags: ['VNet', 'App Gateway', 'VM', 'SQL'],
    build: () =>
      design('Three-tier infrastructure', [
        node('rg', 'azurerm_resource_group', 'rg-platform', { location: 'westeurope' }),
        node('vnet', 'azurerm_virtual_network', 'vnet-main', { address_space: ['10.0.0.0/16'] }, 'rg'),
        node('snetweb', 'azurerm_subnet', 'snet-web', { address_prefixes: ['10.0.1.0/24'] }, 'vnet'),
        node('snetapp', 'azurerm_subnet', 'snet-app', { address_prefixes: ['10.0.2.0/24'] }, 'vnet'),
        node('vm1', 'azurerm_linux_virtual_machine', 'web-01', {
          size: 'Standard_B2s',
          admin_username: 'azureuser',
          authentication_type: 'ssh',
          caching: 'ReadWrite',
          storage_account_type: 'Premium_LRS',
          publisher: 'Canonical',
          offer: '0001-com-ubuntu-server-jammy',
          sku: '22_04-lts-gen2',
          version: 'latest',
        }, 'snetweb'),
        node('vm2', 'azurerm_linux_virtual_machine', 'web-02', {
          size: 'Standard_B2s',
          admin_username: 'azureuser',
          authentication_type: 'ssh',
          caching: 'ReadWrite',
          storage_account_type: 'Premium_LRS',
          publisher: 'Canonical',
          offer: '0001-com-ubuntu-server-jammy',
          sku: '22_04-lts-gen2',
          version: 'latest',
        }, 'snetweb'),
        node('plan', 'azurerm_service_plan', 'asp-app', { os_type: 'Linux', sku_name: 'P1v3' }, 'snetapp'),
        node('st', 'azurerm_storage_account', 'stplatformmain', {
          account_tier: 'Standard',
          account_replication_type: 'LRS',
        }, 'snetapp'),
        node('appgw', 'azurerm_application_gateway', 'appgw-main', {
          name: 'Standard_v2',
          tier: 'Standard_v2',
          capacity: 2,
        }, 'rg'),
        node('sqlsrv', 'azurerm_mssql_server', 'sqlsrv-main', {
          version: '12.0',
          administrator_login: 'sqladmin',
        }, 'rg'),
        node('sqldb', 'azurerm_mssql_database', 'sqldb-main', { sku_name: 'S0' }, 'rg'),
      ], [
        { id: 'e1', source: 'appgw', target: 'vm1' },
        { id: 'e2', source: 'appgw', target: 'vm2' },
        { id: 'e3', source: 'sqlsrv', target: 'sqldb' },
      ]),
  },
  {
    id: 'aks',
    title: 'AKS platform',
    description:
      'A Kubernetes cluster on its own subnet, with a key vault for secrets and a Log Analytics workspace.',
    tags: ['AKS', 'Key Vault', 'Log Analytics'],
    build: () =>
      design('AKS platform', [
        node('rg', 'azurerm_resource_group', 'rg-aks', { location: 'westeurope' }),
        node('vnet', 'azurerm_virtual_network', 'vnet-aks', { address_space: ['10.10.0.0/16'] }, 'rg'),
        node('snet', 'azurerm_subnet', 'snet-nodes', { address_prefixes: ['10.10.0.0/20'] }, 'vnet'),
        node('aks', 'azurerm_kubernetes_cluster', 'aks-platform', {
          dns_prefix: 'aks-platform',
          name: 'default',
          node_count: 3,
          vm_size: 'Standard_D2s_v5',
          type: 'SystemAssigned',
        }, 'snet'),
        node('kv', 'azurerm_key_vault', 'kv-platform', {
          tenant_id: 'data.azurerm_client_config.current.tenant_id',
          sku_name: 'standard',
          soft_delete_retention_days: 7,
        }, 'rg'),
        node('log', 'azurerm_log_analytics_workspace', 'log-platform', {
          sku: 'PerGB2018',
          retention_in_days: 30,
        }, 'rg'),
      ]),
  },
  {
    id: 'module-stack',
    title: 'Module-based stack',
    description:
      'A skeleton that wires your own Terraform modules together — the shape most teams already have in their repository.',
    tags: ['Modules', 'Reusable'],
    build: () =>
      design('Module stack', [
        node('net', 'custom_module', 'network', {
          source: './modules/network',
          inputs: { address_space: '10.30.0.0/16', environment: 'production' },
        }),
        node('data', 'custom_module', 'data', {
          source: './modules/data',
          inputs: { sku: 'GP_Gen5_2' },
        }),
        node('apps', 'custom_module', 'apps', {
          source: './modules/apps',
          inputs: { subnet_id: 'module.network.app_subnet_id' },
        }),
      ], [
        { id: 'e1', source: 'net', target: 'apps' },
        { id: 'e2', source: 'data', target: 'apps' },
      ]),
  },
];
