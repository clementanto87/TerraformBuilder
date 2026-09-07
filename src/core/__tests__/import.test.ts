import { describe, expect, it } from 'vitest';
import { generate } from '../generate';
import { importTerraform } from '../import';
import { azurePack } from '@/packs/azure';
import { withDiscovered } from '@/packs';

const SAMPLE = `
terraform {
  required_version = ">= 1.5.0"
}

resource "azurerm_resource_group" "main" {
  name     = "rg-platform"
  location = "westeurope"

  tags = {
    env   = "production"
    owner = "platform-team"
  }
}

resource "azurerm_virtual_network" "core" {
  name                = "vnet-core"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  address_space       = ["10.20.0.0/16"]
}

resource "azurerm_subnet" "web" {
  name                 = "snet-web"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.core.name
  address_prefixes     = ["10.20.1.0/24"]
}

resource "azurerm_storage_account" "logs" {
  name                     = "stplatformlogs"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "GRS"
}
`;

describe('importTerraform', () => {
  it('rebuilds nodes from an existing configuration', () => {
    const result = importTerraform([{ path: 'main.tf', contents: SAMPLE }], azurePack);

    expect(result.stats.resources).toBe(4);
    expect(result.warnings).toEqual([]);
    expect(result.design.nodes.map((node) => node.name).sort()).toEqual([
      'rg-platform',
      'snet-web',
      'stplatformlogs',
      'vnet-core',
    ]);
  });

  it('turns inherited references into containment instead of edges', () => {
    const { design } = importTerraform([{ path: 'main.tf', contents: SAMPLE }], azurePack);
    const byName = new Map(design.nodes.map((node) => [node.name, node]));

    const group = byName.get('rg-platform')!;
    const vnet = byName.get('vnet-core')!;
    const subnet = byName.get('snet-web')!;

    // The VNet sits inside the resource group; the subnet inside the VNet.
    expect(vnet.parentId).toBe(group.id);
    expect(subnet.parentId).toBe(vnet.id);

    // Those arguments are now implied by nesting, so they are not stored twice.
    expect(vnet.values.resource_group_name).toBeUndefined();
    expect(subnet.values.virtual_network_name).toBeUndefined();
  });

  it('keeps tags and typed values', () => {
    const { design } = importTerraform([{ path: 'main.tf', contents: SAMPLE }], azurePack);
    const group = design.nodes.find((node) => node.name === 'rg-platform')!;
    expect(group.tags).toEqual({ env: 'production', owner: 'platform-team' });

    const storage = design.nodes.find((node) => node.name === 'stplatformlogs')!;
    expect(storage.values.account_replication_type).toBe('GRS');
  });

  it('gives every imported node a position', () => {
    const { design } = importTerraform([{ path: 'main.tf', contents: SAMPLE }], azurePack);
    for (const node of design.nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
    }
  });

  it('round-trips: generated code re-imports to the same resources', () => {
    const first = importTerraform([{ path: 'main.tf', contents: SAMPLE }], azurePack);
    const generated = generate(first.design, azurePack).files.find((f) => f.path === 'main.tf')!;
    const second = importTerraform([{ path: 'main.tf', contents: generated.contents }], azurePack);

    expect(second.design.nodes.map((node) => node.name).sort()).toEqual(
      first.design.nodes.map((node) => node.name).sort(),
    );

    // And the second generation is byte-identical to the first.
    const regenerated = generate(second.design, azurePack).files.find((f) => f.path === 'main.tf')!;
    expect(regenerated.contents).toBe(generated.contents);
  });

  it('synthesises definitions for resource types the pack does not know', () => {
    const unknown = `
      resource "azurerm_signalr_service" "chat" {
        name                = "signalr-chat"
        resource_group_name = azurerm_resource_group.main.name
        sku_capacity        = 2
        public_access       = true
      }

      resource "azurerm_resource_group" "main" {
        name     = "rg-main"
        location = "uksouth"
      }
    `;

    const result = importTerraform([{ path: 'main.tf', contents: unknown }], azurePack);
    expect(result.discovered.map((def) => def.terraformType)).toContain('azurerm_signalr_service');

    const def = result.discovered.find((entry) => entry.terraformType === 'azurerm_signalr_service')!;
    expect(def.label).toBe('Signalr Service');
    // Field types are inferred from the values actually present.
    expect(def.fields.find((field) => field.key === 'sku_capacity')?.type).toBe('number');
    expect(def.fields.find((field) => field.key === 'public_access')?.type).toBe('boolean');

    // And an unknown type still regenerates as valid Terraform.
    const pack = withDiscovered(azurePack, result.discovered);
    const main = generate(result.design, pack).files.find((f) => f.path === 'main.tf')!.contents;
    expect(main).toContain('resource "azurerm_signalr_service" "signalr-chat" {');
    expect(main).toMatch(/sku_capacity\s+= 2/);
    expect(main).toMatch(/public_access\s+= true/);
  });

  it('imports modules and records their source', () => {
    const withModule = `
      module "network" {
        source  = "Azure/network/azurerm"
        version = "5.3.0"
        prefix  = "acme"
      }
    `;
    const result = importTerraform([{ path: 'main.tf', contents: withModule }], azurePack);
    expect(result.stats.modules).toBe(1);
    expect(result.discovered[0].kind).toBe('module');
    expect(result.discovered[0].terraformType).toBe('Azure/network/azurerm');
  });

  it('reports a syntax error without discarding the other files', () => {
    const result = importTerraform(
      [
        { path: 'broken.tf', contents: 'resource "azurerm_x" "y" { name = "z"' },
        { path: 'good.tf', contents: SAMPLE },
      ],
      azurePack,
    );
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('broken.tf');
    expect(result.stats.resources).toBe(4);
  });

  it('draws edges for references that are not containment', () => {
    const linked = `
      resource "azurerm_service_plan" "main" {
        name                = "asp-main"
        resource_group_name = "rg"
        location            = "uksouth"
        os_type             = "Linux"
        sku_name            = "P1v3"
      }

      resource "azurerm_linux_web_app" "site" {
        name                = "app-site"
        resource_group_name = "rg"
        location            = "uksouth"
        service_plan_id     = azurerm_service_plan.main.id
      }
    `;
    const { design } = importTerraform([{ path: 'main.tf', contents: linked }], azurePack);
    expect(design.edges).toHaveLength(1);

    const plan = design.nodes.find((node) => node.name === 'asp-main')!;
    const app = design.nodes.find((node) => node.name === 'app-site')!;
    expect(design.edges[0].source).toBe(plan.id);
    expect(design.edges[0].target).toBe(app.id);
    // Stored as a typed reference, so renaming the plan updates the app.
    expect(app.values.service_plan_id).toEqual({ __ref: plan.id, attr: 'id' });
  });
});
