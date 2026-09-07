import { describe, expect, it } from 'vitest';
import { generate } from '../generate';
import { validate } from '../validate';
import { nodeRef, type Design, type GraphNode } from '../types';
import { azurePack } from '@/packs/azure';

const node = (partial: Partial<GraphNode> & Pick<GraphNode, 'id' | 'defId' | 'name'>): GraphNode => ({
  values: {},
  tags: {},
  position: { x: 0, y: 0 },
  parentId: null,
  ...partial,
});

/** The infrastructure from the product mockup: RG > VNet > Subnet > VM. */
function mockupDesign(): Design {
  return {
    version: 1,
    name: 'My Azure Infrastructure',
    packId: 'azurerm',
    region: 'westeurope',
    nodes: [
      node({
        id: 'rg',
        defId: 'azurerm_resource_group',
        name: 'rg-main',
        values: { location: 'westeurope' },
      }),
      node({
        id: 'vnet',
        defId: 'azurerm_virtual_network',
        name: 'vnet-main',
        parentId: 'rg',
        values: { address_space: ['10.0.0.0/16'] },
      }),
      node({
        id: 'snet',
        defId: 'azurerm_subnet',
        name: 'snet-web',
        parentId: 'vnet',
        values: { address_prefixes: ['10.0.1.0/24'] },
      }),
      node({
        id: 'vm',
        defId: 'azurerm_linux_virtual_machine',
        name: 'web-01',
        parentId: 'snet',
        tags: { env: 'prod' },
        values: {
          size: 'Standard_B2s',
          admin_username: 'azureuser',
          authentication_type: 'ssh',
          public_key: 'ssh-rsa AAAAB3NzaC1yc2E',
          caching: 'ReadWrite',
          storage_account_type: 'Premium_LRS',
          publisher: 'Canonical',
          offer: '0001-com-ubuntu-server-jammy',
          sku: '22_04-lts-gen2',
          version: 'latest',
        },
      }),
    ],
    edges: [],
  };
}

describe('generate', () => {
  it('emits a valid resource group', () => {
    const { files } = generate(mockupDesign(), azurePack);
    const main = files.find((file) => file.path === 'main.tf')?.contents ?? '';
    expect(main).toContain('resource "azurerm_resource_group" "rg-main" {');
    expect(main).toContain('name     = "rg-main"');
    expect(main).toContain('location = "westeurope"');
  });

  it('inherits resource group and virtual network through containment', () => {
    const { files } = generate(mockupDesign(), azurePack);
    const main = files.find((file) => file.path === 'main.tf')?.contents ?? '';

    // The subnet was never told its resource group or VNet — nesting supplied both.
    expect(main).toContain('resource_group_name  = azurerm_resource_group.rg-main.name');
    expect(main).toContain('virtual_network_name = azurerm_virtual_network.vnet-main.name');
    expect(main).toContain('address_prefixes     = ["10.0.1.0/24"]');
  });

  it('emits the VM with nested blocks, mirrored username and its own NIC', () => {
    const { files } = generate(mockupDesign(), azurePack);
    const main = files.find((file) => file.path === 'main.tf')?.contents ?? '';

    expect(main).toContain('resource "azurerm_linux_virtual_machine" "web-01" {');
    expect(main).toContain('size                  = "Standard_B2s"');
    expect(main).toContain('network_interface_ids = [azurerm_network_interface.web-01.id]');

    // `username` mirrors `admin_username` rather than being asked for twice.
    expect(main).toContain('admin_ssh_key {');
    expect(main).toContain('username   = "azureuser"');
    expect(main).toContain('public_key = "ssh-rsa AAAAB3NzaC1yc2E"');

    expect(main).toContain('os_disk {');
    expect(main).toContain('source_image_reference {');

    // The companion NIC wires itself to the enclosing subnet.
    expect(main).toContain('resource "azurerm_network_interface" "web-01" {');
    expect(main).toContain('subnet_id                     = azurerm_subnet.snet-web.id');
  });

  it('emits tags and omits fields hidden by showIf', () => {
    const { files } = generate(mockupDesign(), azurePack);
    const main = files.find((file) => file.path === 'main.tf')?.contents ?? '';
    expect(main).toMatch(/tags\s+= \{/);
    expect(main).toContain('env = "prod"');
    // Password auth is not selected, so nothing password-related is emitted.
    expect(main).not.toContain('admin_password');
    expect(main).not.toContain('disable_password_authentication');
    // `authentication_type` is a UI-only control.
    expect(main).not.toContain('authentication_type');
  });

  it('routes secrets through sensitive variables instead of the code', () => {
    const design = mockupDesign();
    design.nodes.push(
      node({
        id: 'sql',
        defId: 'azurerm_mssql_server',
        name: 'sqlsrv-main',
        parentId: 'rg',
        values: {
          version: '12.0',
          administrator_login: 'sqladmin',
          administrator_login_password: 'hunter2',
        },
      }),
    );

    const { files } = generate(design, azurePack);
    const main = files.find((file) => file.path === 'main.tf')?.contents ?? '';
    const variables = files.find((file) => file.path === 'variables.tf')?.contents ?? '';

    expect(main).not.toContain('hunter2');
    expect(main).toContain('administrator_login_password = var.sqlsrv_main_administrator_login_password');
    expect(main).not.toContain('var.sqlsrv-main');
    expect(variables).toContain('variable "sqlsrv_main_administrator_login_password"');
    expect(variables).toContain('sensitive   = true');
  });

  it('turns drawn edges into references', () => {
    const design = mockupDesign();
    design.nodes.push(
      node({ id: 'plan', defId: 'azurerm_service_plan', name: 'asp-main', parentId: 'rg', values: { os_type: 'Linux', sku_name: 'P1v3' } }),
      node({ id: 'app', defId: 'azurerm_linux_web_app', name: 'app-main', parentId: 'rg', values: {} }),
    );
    design.edges.push({ id: 'e1', source: 'plan', target: 'app' });

    const { files } = generate(design, azurePack);
    const main = files.find((file) => file.path === 'main.tf')?.contents ?? '';
    expect(main).toMatch(/service_plan_id\s+= azurerm_service_plan\.asp-main\.id/);
  });

  it('resolves stored references and follows renames', () => {
    const design = mockupDesign();
    design.nodes.push(
      node({ id: 'plan', defId: 'azurerm_service_plan', name: 'asp-main', parentId: 'rg', values: { os_type: 'Linux', sku_name: 'P1v3' } }),
      node({
        id: 'app',
        defId: 'azurerm_linux_web_app',
        name: 'app-main',
        parentId: 'rg',
        values: { service_plan_id: nodeRef('plan') },
      }),
    );

    const before = generate(design, azurePack).files.find((f) => f.path === 'main.tf')?.contents ?? '';
    expect(before).toMatch(/service_plan_id\s+= azurerm_service_plan\.asp-main\.id/);

    design.nodes.find((entry) => entry.id === 'plan')!.name = 'asp-renamed';
    const after = generate(design, azurePack).files.find((f) => f.path === 'main.tf')?.contents ?? '';
    expect(after).toMatch(/service_plan_id\s+= azurerm_service_plan\.asp-renamed\.id/);
  });

  it('emits provider, backend and outputs files', () => {
    const { files } = generate(mockupDesign(), azurePack, {
      backend: { type: 'azurerm', config: { resource_group_name: 'rg-tfstate', key: 'prod.tfstate' } },
    });

    const providers = files.find((file) => file.path === 'providers.tf')?.contents ?? '';
    expect(providers).toContain('required_version = ">= 1.5.0"');
    expect(providers).toContain('azurerm = {');
    expect(providers).toContain('backend "azurerm" {');
    expect(providers).toContain('backend "azurerm" {');
    expect(providers).toMatch(/key\s+= "prod\.tfstate"/);
    expect(providers).toContain('provider "azurerm" {');

    const outputs = files.find((file) => file.path === 'outputs.tf')?.contents ?? '';
    expect(outputs).toContain('output "web_01_id"');
  });

  it('renders a custom module block for user-supplied Terraform', () => {
    const design = mockupDesign();
    design.nodes.push(
      node({
        id: 'mod',
        defId: 'custom_module',
        name: 'network',
        values: {
          source: 'app.terraform.io/acme/network/azurerm',
          version: '2.1.0',
          inputs: { vnet_id: 'azurerm_virtual_network.vnet-main.id', enable_flow_logs: 'true', prefix: 'acme' },
        },
      }),
    );

    const main = generate(design, azurePack).files.find((f) => f.path === 'main.tf')?.contents ?? '';
    expect(main).toContain('module "network" {');
    expect(main).toContain('source           = "app.terraform.io/acme/network/azurerm"');
    expect(main).toContain('version          = "2.1.0"');
    expect(main).toContain('vnet_id          = azurerm_virtual_network.vnet-main.id');
    expect(main).toContain('enable_flow_logs = true');
    expect(main).toContain('prefix           = "acme"');
  });

  it('escapes strings that would otherwise open an interpolation', () => {
    const design = mockupDesign();
    design.nodes.find((entry) => entry.id === 'vm')!.tags = { note: 'cost ${var.x} "quoted"' };
    const main = generate(design, azurePack).files.find((f) => f.path === 'main.tf')?.contents ?? '';
    expect(main).toContain('note = "cost $${var.x} \\"quoted\\""');
  });

  it('suffixes duplicate names so the module still applies', () => {
    const design = mockupDesign();
    design.nodes.push(
      node({ id: 'vm2', defId: 'azurerm_linux_virtual_machine', name: 'web-01', parentId: 'snet', values: { size: 'Standard_B2s', admin_username: 'azureuser' } }),
    );
    const main = generate(design, azurePack).files.find((f) => f.path === 'main.tf')?.contents ?? '';
    expect(main).toContain('"azurerm_linux_virtual_machine" "web-01"');
    expect(main).toContain('"azurerm_linux_virtual_machine" "web-01_2"');
  });
});

describe('validate', () => {
  it('accepts the mockup design', () => {
    const issues = validate(mockupDesign(), azurePack).filter((issue) => issue.level === 'error');
    expect(issues).toEqual([]);
  });

  it('does not demand arguments that containment supplies', () => {
    const issues = validate(mockupDesign(), azurePack);
    expect(issues.map((issue) => issue.message).join()).not.toContain('Resource group is required');
  });

  it('flags a missing required field', () => {
    const design = mockupDesign();
    delete design.nodes.find((entry) => entry.id === 'vm')!.values.public_key;
    const issues = validate(design, azurePack);
    expect(issues.some((issue) => issue.field === 'public_key' && issue.level === 'error')).toBe(true);
  });

  it('flags a resource that has no parent to inherit from', () => {
    const design = mockupDesign();
    design.nodes.find((entry) => entry.id === 'vnet')!.parentId = null;
    const issues = validate(design, azurePack);
    expect(issues.some((issue) => issue.message.includes('no parent Resource Group'))).toBe(true);
  });

  it('enforces provider-specific naming rules', () => {
    const design = mockupDesign();
    design.nodes.push(
      node({ id: 'sa', defId: 'azurerm_storage_account', name: 'Invalid-Name', parentId: 'rg', values: { account_tier: 'Standard', account_replication_type: 'LRS' } }),
    );
    const issues = validate(design, azurePack);
    expect(issues.some((issue) => issue.message.includes('3–24 lowercase'))).toBe(true);
  });

  it('rejects a malformed CIDR range', () => {
    const design = mockupDesign();
    design.nodes.find((entry) => entry.id === 'snet')!.values.address_prefixes = ['not-a-cidr'];
    const issues = validate(design, azurePack);
    expect(issues.some((issue) => issue.message.includes('not a valid CIDR'))).toBe(true);
  });

  it('rejects a child placed in a container that will not take it', () => {
    const design = mockupDesign();
    design.nodes.find((entry) => entry.id === 'vnet')!.parentId = 'snet';
    const issues = validate(design, azurePack);
    expect(issues.some((issue) => issue.message.includes('cannot be placed inside'))).toBe(true);
  });
});

describe('validate and connections', () => {
  it('does not demand a field that a drawn edge already supplies', () => {
    const design: Design = {
      version: 1,
      name: 'edges',
      packId: 'azurerm',
      region: 'westeurope',
      nodes: [
        node({ id: 'rg', defId: 'azurerm_resource_group', name: 'rg-main', values: { location: 'westeurope' } }),
        node({
          id: 'srv',
          defId: 'azurerm_mssql_server',
          name: 'sqlsrv-main',
          parentId: 'rg',
          values: { version: '12.0', administrator_login: 'sqladmin', administrator_login_password: 'x' },
        }),
        node({ id: 'db', defId: 'azurerm_mssql_database', name: 'sqldb-main', values: { sku_name: 'S0' } }),
      ],
      edges: [{ id: 'e1', source: 'srv', target: 'db' }],
    };

    // `server_id` is never typed in; the edge provides it.
    const withEdge = validate(design, azurePack).filter((issue) => issue.level === 'error');
    expect(withEdge).toEqual([]);

    // Remove the edge and the requirement comes back.
    const withoutEdge = validate({ ...design, edges: [] }, azurePack);
    expect(withoutEdge.some((issue) => issue.field === 'server_id' && issue.level === 'error')).toBe(true);
  });
});
