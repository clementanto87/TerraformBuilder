import { block, expr } from '@/core/hcl';
import type { EmitContext, ResourceDef } from '@/core/types';
import { INHERIT_RESOURCE_GROUP, RESOURCE_GROUP, SUBNET, placementFields } from './common';

const VM_SIZES = [
  { label: 'Standard_B1s (1 vCPU, 1 GB RAM)', value: 'Standard_B1s' },
  { label: 'Standard_B2s (2 vCPU, 4 GB RAM)', value: 'Standard_B2s' },
  { label: 'Standard_D2s_v5 (2 vCPU, 8 GB RAM)', value: 'Standard_D2s_v5' },
  { label: 'Standard_D4s_v5 (4 vCPU, 16 GB RAM)', value: 'Standard_D4s_v5' },
  { label: 'Standard_D8s_v5 (8 vCPU, 32 GB RAM)', value: 'Standard_D8s_v5' },
  { label: 'Standard_E4s_v5 (4 vCPU, 32 GB RAM)', value: 'Standard_E4s_v5' },
  { label: 'Standard_F4s_v2 (4 vCPU, 8 GB RAM)', value: 'Standard_F4s_v2' },
];

/**
 * A virtual machine needs a network interface, and a network interface needs a
 * subnet. Rather than making the user draw both, the VM emits its own NIC and
 * points at the subnet it was dropped into.
 */
function networkInterface(ctx: EmitContext): string[] {
  const subnet = ctx.ancestor(SUBNET);
  const group = ctx.ancestor(RESOURCE_GROUP);

  const nic = block('resource', 'azurerm_network_interface', ctx.label);
  nic.attr('name', `${ctx.node.name}-nic`);
  if (group) {
    nic.attr('location', expr(`${ctx.addressOf(group.id)}.location`));
    nic.attr('resource_group_name', expr(`${ctx.addressOf(group.id)}.name`));
  }

  const ipConfiguration = block('ip_configuration');
  ipConfiguration.attr('name', 'internal');
  ipConfiguration.attr(
    'subnet_id',
    subnet
      ? expr(`${ctx.addressOf(subnet.id)}.id`)
      : expr('# TODO: place this machine inside a subnet on the canvas'),
  );
  ipConfiguration.attr('private_ip_address_allocation', 'Dynamic');
  nic.block(ipConfiguration);

  return [nic.render()];
}

export const linuxVirtualMachine: ResourceDef = {
  id: 'azurerm_linux_virtual_machine',
  kind: 'resource',
  provider: 'azurerm',
  category: 'compute',
  label: 'Virtual Machine',
  summary: 'A Linux VM, with its network interface generated alongside it.',
  terraformType: 'azurerm_linux_virtual_machine',
  icon: 'vm',
  accent: '#2563eb',
  namePrefix: 'vm',
  inherits: INHERIT_RESOURCE_GROUP,
  derived: (ctx) => ({
    network_interface_ids: expr(`[azurerm_network_interface.${ctx.label}.id]`),
  }),
  companions: networkInterface,
  fields: [
    { key: 'size', label: 'Size', type: 'select', required: true, default: 'Standard_B2s', options: VM_SIZES },
    {
      key: 'admin_username',
      label: 'Admin username',
      type: 'string',
      required: true,
      default: 'azureuser',
      pattern: '^[a-z_][a-z0-9_-]{0,31}$',
      patternMessage: 'Use a lowercase Linux username.',
    },
    {
      key: 'authentication_type',
      label: 'Authentication type',
      type: 'select',
      default: 'ssh',
      emit: false,
      options: [
        { label: 'SSH public key', value: 'ssh' },
        { label: 'Password', value: 'password' },
      ],
    },
    {
      key: 'username',
      label: 'SSH username',
      type: 'string',
      block: 'admin_ssh_key',
      mirrors: 'admin_username',
      showIf: { key: 'authentication_type', eq: 'ssh' },
      help: 'Follows the admin username unless you set it explicitly.',
    },
    {
      key: 'public_key',
      label: 'SSH public key',
      type: 'textarea',
      block: 'admin_ssh_key',
      required: true,
      placeholder: 'ssh-rsa AAAAB3NzaC1yc2E...',
      showIf: { key: 'authentication_type', eq: 'ssh' },
    },
    {
      key: 'admin_password',
      label: 'Admin password',
      type: 'password',
      required: true,
      sensitive: true,
      showIf: { key: 'authentication_type', eq: 'password' },
      help: 'Stored as a sensitive Terraform variable, never written into the code.',
    },
    {
      key: 'disable_password_authentication',
      label: 'Disable password authentication',
      type: 'boolean',
      default: false,
      advanced: true,
      showIf: { key: 'authentication_type', eq: 'password' },
    },
    {
      key: 'caching',
      label: 'OS disk caching',
      type: 'select',
      block: 'os_disk',
      default: 'ReadWrite',
      advanced: true,
      options: [
        { label: 'ReadWrite', value: 'ReadWrite' },
        { label: 'ReadOnly', value: 'ReadOnly' },
        { label: 'None', value: 'None' },
      ],
    },
    {
      key: 'storage_account_type',
      label: 'OS disk type',
      type: 'select',
      block: 'os_disk',
      default: 'Premium_LRS',
      advanced: true,
      options: [
        { label: 'Premium SSD (Premium_LRS)', value: 'Premium_LRS' },
        { label: 'Standard SSD (StandardSSD_LRS)', value: 'StandardSSD_LRS' },
        { label: 'Standard HDD (Standard_LRS)', value: 'Standard_LRS' },
      ],
    },
    { key: 'publisher', label: 'Image publisher', type: 'string', block: 'source_image_reference', default: 'Canonical', advanced: true },
    { key: 'offer', label: 'Image offer', type: 'string', block: 'source_image_reference', default: '0001-com-ubuntu-server-jammy', advanced: true },
    { key: 'sku', label: 'Image SKU', type: 'string', block: 'source_image_reference', default: '22_04-lts-gen2', advanced: true },
    { key: 'version', label: 'Image version', type: 'string', block: 'source_image_reference', default: 'latest', advanced: true },
    ...placementFields(),
  ],
  subtitle: (values) => (values.size ? String(values.size) : undefined),
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/linux_virtual_machine',
};

export const scaleSet: ResourceDef = {
  id: 'azurerm_linux_virtual_machine_scale_set',
  kind: 'resource',
  provider: 'azurerm',
  category: 'compute',
  label: 'VM Scale Set',
  summary: 'A managed, autoscaling pool of identical machines.',
  terraformType: 'azurerm_linux_virtual_machine_scale_set',
  icon: 'scaleset',
  accent: '#1d4ed8',
  namePrefix: 'vmss',
  inherits: INHERIT_RESOURCE_GROUP,
  fields: [
    { key: 'sku', label: 'Size', type: 'select', required: true, default: 'Standard_B2s', options: VM_SIZES },
    { key: 'instances', label: 'Instance count', type: 'number', required: true, default: 2, min: 0, max: 1000 },
    {
      key: 'admin_username',
      label: 'Admin username',
      type: 'string',
      required: true,
      default: 'azureuser',
    },
    {
      key: 'upgrade_mode',
      label: 'Upgrade mode',
      type: 'select',
      advanced: true,
      default: 'Manual',
      options: [
        { label: 'Manual', value: 'Manual' },
        { label: 'Automatic', value: 'Automatic' },
        { label: 'Rolling', value: 'Rolling' },
      ],
    },
    ...placementFields(),
  ],
  subtitle: (values) => `${String(values.sku ?? '')} × ${String(values.instances ?? 0)}`,
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/linux_virtual_machine_scale_set',
};

export const servicePlan: ResourceDef = {
  id: 'azurerm_service_plan',
  kind: 'resource',
  provider: 'azurerm',
  category: 'compute',
  label: 'App Service Plan',
  summary: 'The compute tier that web and function apps run on.',
  terraformType: 'azurerm_service_plan',
  icon: 'plan',
  accent: '#0284c7',
  namePrefix: 'asp',
  inherits: INHERIT_RESOURCE_GROUP,
  fields: [
    {
      key: 'os_type',
      label: 'Operating system',
      type: 'select',
      required: true,
      default: 'Linux',
      options: [
        { label: 'Linux', value: 'Linux' },
        { label: 'Windows', value: 'Windows' },
      ],
    },
    {
      key: 'sku_name',
      label: 'SKU',
      type: 'select',
      required: true,
      default: 'P1v3',
      options: [
        { label: 'B1 (Basic)', value: 'B1' },
        { label: 'S1 (Standard)', value: 'S1' },
        { label: 'P1v3 (Premium v3)', value: 'P1v3' },
        { label: 'P2v3 (Premium v3)', value: 'P2v3' },
        { label: 'Y1 (Consumption)', value: 'Y1' },
      ],
    },
    ...placementFields(),
  ],
  subtitle: (values) => `${String(values.os_type ?? '')} | ${String(values.sku_name ?? '')}`,
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/service_plan',
};

export const webApp: ResourceDef = {
  id: 'azurerm_linux_web_app',
  kind: 'resource',
  provider: 'azurerm',
  category: 'compute',
  label: 'App Service',
  summary: 'A managed web application.',
  terraformType: 'azurerm_linux_web_app',
  icon: 'app',
  accent: '#0ea5e9',
  namePrefix: 'app',
  inherits: INHERIT_RESOURCE_GROUP,
  connections: [
    {
      to: ['azurerm_service_plan'],
      label: 'runs on',
      applies: { on: 'source', key: 'service_plan_id', attr: 'id' },
    },
  ],
  fields: [
    {
      key: 'service_plan_id',
      label: 'App Service plan',
      type: 'reference',
      required: true,
      refTypes: ['azurerm_service_plan'],
      help: 'Connect this app to a plan on the canvas, or pick one here.',
    },
    {
      key: 'https_only',
      label: 'HTTPS only',
      type: 'boolean',
      default: true,
    },
    {
      key: 'always_on',
      label: 'Always on',
      type: 'boolean',
      block: 'site_config',
      default: true,
      advanced: true,
    },
    ...placementFields(),
  ],
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/linux_web_app',
};

export const functionApp: ResourceDef = {
  id: 'azurerm_linux_function_app',
  kind: 'resource',
  provider: 'azurerm',
  category: 'compute',
  label: 'Function App',
  summary: 'Event-driven, serverless compute.',
  terraformType: 'azurerm_linux_function_app',
  icon: 'function',
  accent: '#f59e0b',
  namePrefix: 'func',
  inherits: INHERIT_RESOURCE_GROUP,
  connections: [
    { to: ['azurerm_service_plan'], label: 'runs on', applies: { on: 'source', key: 'service_plan_id', attr: 'id' } },
    { to: ['azurerm_storage_account'], label: 'stores state in', applies: { on: 'source', key: 'storage_account_name', attr: 'name' } },
  ],
  fields: [
    {
      key: 'service_plan_id',
      label: 'App Service plan',
      type: 'reference',
      required: true,
      refTypes: ['azurerm_service_plan'],
    },
    {
      key: 'storage_account_name',
      label: 'Storage account',
      type: 'reference',
      required: true,
      refTypes: ['azurerm_storage_account'],
      refAttr: 'name',
    },
    ...placementFields(),
  ],
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/linux_function_app',
};

export const containerApp: ResourceDef = {
  id: 'azurerm_container_app',
  kind: 'resource',
  provider: 'azurerm',
  category: 'compute',
  label: 'Container App',
  summary: 'Serverless containers on a managed environment.',
  terraformType: 'azurerm_container_app',
  icon: 'container',
  accent: '#8b5cf6',
  namePrefix: 'ca',
  inherits: [{ key: 'resource_group_name', fromDef: RESOURCE_GROUP, attr: 'name' }],
  fields: [
    {
      key: 'revision_mode',
      label: 'Revision mode',
      type: 'select',
      required: true,
      default: 'Single',
      options: [
        { label: 'Single', value: 'Single' },
        { label: 'Multiple', value: 'Multiple' },
      ],
    },
    {
      key: 'container_app_environment_id',
      label: 'Environment id',
      type: 'string',
      required: true,
      raw: true,
      placeholder: 'azurerm_container_app_environment.main.id',
      help: 'An HCL expression pointing at a Container Apps environment.',
    },
    {
      key: 'resource_group_name',
      label: 'Resource group',
      type: 'string',
      required: true,
      advanced: true,
    },
  ],
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/container_app',
};

export const kubernetesCluster: ResourceDef = {
  id: 'azurerm_kubernetes_cluster',
  kind: 'resource',
  provider: 'azurerm',
  category: 'compute',
  label: 'AKS (Kubernetes)',
  summary: 'Managed Kubernetes control plane and node pool.',
  terraformType: 'azurerm_kubernetes_cluster',
  icon: 'kubernetes',
  accent: '#326ce5',
  namePrefix: 'aks',
  inherits: INHERIT_RESOURCE_GROUP,
  fields: [
    {
      key: 'dns_prefix',
      label: 'DNS prefix',
      type: 'string',
      required: true,
      pattern: '^[a-z0-9][a-z0-9-]{0,52}[a-z0-9]$',
      patternMessage: 'Lowercase letters, digits and hyphens only.',
    },
    { key: 'name', label: 'Node pool name', type: 'string', block: 'default_node_pool', required: true, default: 'default' },
    { key: 'node_count', label: 'Node count', type: 'number', block: 'default_node_pool', required: true, default: 2, min: 1, max: 1000 },
    { key: 'vm_size', label: 'Node size', type: 'select', block: 'default_node_pool', required: true, default: 'Standard_D2s_v5', options: VM_SIZES },
    { key: 'type', label: 'Identity type', type: 'string', block: 'identity', default: 'SystemAssigned', advanced: true },
    ...placementFields(),
  ],
  subtitle: (values) => `${String(values.node_count ?? '')} × ${String(values.vm_size ?? '')}`,
  docs: 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/kubernetes_cluster',
};

export const computeResources: ResourceDef[] = [
  linuxVirtualMachine,
  scaleSet,
  webApp,
  containerApp,
  kubernetesCluster,
  functionApp,
  servicePlan,
];
