import { describe, expect, it } from 'vitest';
import { findReferences, parseHcl, toJson } from '../parse';

describe('parseHcl', () => {
  it('parses blocks, labels and scalar attributes', () => {
    const body = parseHcl(`
      resource "azurerm_resource_group" "main" {
        name     = "rg-platform"
        location = "westeurope"
        count    = 3
        enabled  = true
        nothing  = null
      }
    `);

    expect(body.blocks).toHaveLength(1);
    const [rg] = body.blocks;
    expect(rg.type).toBe('resource');
    expect(rg.labels).toEqual(['azurerm_resource_group', 'main']);
    expect(toJson(rg.body.attributes.name)).toBe('rg-platform');
    expect(toJson(rg.body.attributes.count)).toBe(3);
    expect(toJson(rg.body.attributes.enabled)).toBe(true);
    expect(toJson(rg.body.attributes.nothing)).toBe(null);
  });

  it('keeps references and interpolations as expressions', () => {
    const body = parseHcl(`
      resource "azurerm_subnet" "web" {
        virtual_network_name = azurerm_virtual_network.main.name
        name                 = "\${var.prefix}-web"
      }
    `);
    const subnet = body.blocks[0].body;
    expect(subnet.attributes.virtual_network_name).toEqual({
      kind: 'expr',
      source: 'azurerm_virtual_network.main.name',
    });
    expect(subnet.attributes.name.kind).toBe('expr');
  });

  it('parses lists, objects and nested blocks', () => {
    const body = parseHcl(`
      resource "azurerm_virtual_network" "main" {
        address_space = ["10.0.0.0/16", "10.1.0.0/16"]

        tags = {
          env   = "prod"
          "cost-center" = "1234"
        }

        subnet {
          name = "inner"
        }
      }
    `);
    const vnet = body.blocks[0].body;
    expect(toJson(vnet.attributes.address_space)).toEqual(['10.0.0.0/16', '10.1.0.0/16']);
    expect(toJson(vnet.attributes.tags)).toEqual({ env: 'prod', 'cost-center': '1234' });
    expect(vnet.blocks).toHaveLength(1);
    expect(vnet.blocks[0].type).toBe('subnet');
  });

  it('handles comments and heredocs', () => {
    const body = parseHcl(`
      # a leading comment
      resource "azurerm_x" "y" { // trailing
        /* block comment */
        script = <<-EOT
          line one
          line two
        EOT
        after = "kept"
      }
    `);
    const attrs = body.blocks[0].body.attributes;
    expect(toJson(attrs.script)).toBe('line one\nline two');
    expect(toJson(attrs.after)).toBe('kept');
  });

  it('parses several top-level blocks including modules and variables', () => {
    const body = parseHcl(`
      variable "location" {
        type    = string
        default = "westeurope"
      }

      module "network" {
        source = "./modules/network"
        vnet   = azurerm_virtual_network.main.id
      }

      resource "azurerm_storage_account" "logs" {
        name = "stlogs"
      }
    `);
    expect(body.blocks.map((entry) => entry.type)).toEqual(['variable', 'module', 'resource']);
  });

  it('finds references inside lists and nested expressions', () => {
    const body = parseHcl(`
      resource "azurerm_lb" "main" {
        subnets = [azurerm_subnet.web.id, azurerm_subnet.app.id]
        rg      = azurerm_resource_group.main.name
      }
    `);
    const attrs = body.blocks[0].body.attributes;
    const names = findReferences(attrs.subnets).map((ref) => `${ref.type}.${ref.name}`);
    expect(names).toEqual(['azurerm_subnet.web', 'azurerm_subnet.app']);
    expect(findReferences(attrs.rg)[0].attr).toBe('name');
  });
});
