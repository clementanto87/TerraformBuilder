# Terraform Builder

A visual designer for infrastructure. Drag resources onto a canvas, nest and
connect them, fill in a form — and the Terraform is generated behind the scenes
as you work. Point it at an existing `.tf` codebase and it draws the diagram
instead.

Everything runs in the browser. No backend, no credentials, no telemetry.

```bash
npm install
npm run dev
```

## What it does

**Design visually.** A searchable catalog of resources on the left, a canvas in
the middle, a properties form on the right, and the generated HCL underneath it.
Selecting a resource shows its own block; switching to Project shows the whole
module.

**Containment is a real relationship.** Dropping a subnet inside a virtual
network is how the subnet learns its `virtual_network_name`. Dropping a machine
inside that subnet is how its network interface finds a `subnet_id`. Nothing is
typed twice, and moving a resource rewrites the code.

**Links become references.** Drawing an edge from an App Service plan to a web
app emits `service_plan_id = azurerm_service_plan.<name>.id`. References are
stored as pointers rather than strings, so renaming a resource updates every
expression that mentions it.

**Import what you already have.** Drop `.tf` files into the import dialog and
the design is reconstructed — resources, modules, data sources, containment and
cross-references. Resource types the catalog does not ship are rebuilt from the
code itself, with field types inferred from the values present, so an
unfamiliar repository still renders and stays editable.

**Secrets stay out of the code.** Fields marked sensitive are emitted as
`var.<name>` with a `sensitive = true` declaration in `variables.tf`. A password
typed into the form never reaches the generated HCL.

**Export a repository, not a snippet.** The download produces `providers.tf`,
`main.tf`, `variables.tf`, `outputs.tf`, a `.gitignore`, a README, an
`azure-pipelines.yml`, and the design itself as JSON so the diagram can be
reopened later.

## Azure DevOps

The generated pipeline has three stages. **Validate** checks formatting and runs
`terraform validate`. **Plan** produces a plan and publishes it as a build
artifact. **Apply** downloads that exact artifact and applies it — so what a
reviewer approved is what reaches Azure, rather than a fresh plan computed after
the approval.

Approvals attach to an Azure DevOps environment rather than being encoded in the
YAML, which is where your existing gates already live.

Applying is the pipeline's job, not this tool's. Nothing here holds an Azure
credential or runs `terraform apply`, and the State tab explains the backend
configuration rather than pretending to read your state file.

## Adding resources, providers and your own modules

The engine in `src/core` does not know that Azure exists. A provider is data — a
`ProviderPack` of `ResourceDef`s — and the generic emitter, validator and form
renderer read it. Adding a resource means adding a definition, not editing the
editor.

```ts
export const storageAccount: ResourceDef = {
  id: 'azurerm_storage_account',
  kind: 'resource',
  provider: 'azurerm',
  category: 'storage',
  label: 'Storage Account',
  terraformType: 'azurerm_storage_account',
  icon: 'storage',
  accent: '#0d9488',
  namePrefix: 'st',
  // Region and resource group come from whatever it is nested inside.
  inherits: INHERIT_RESOURCE_GROUP,
  fields: [
    { key: 'account_tier', label: 'Performance tier', type: 'select', required: true,
      default: 'Standard', options: [{ label: 'Standard', value: 'Standard' }] },
  ],
};
```

The pieces a definition can use:

| Field | Purpose |
| --- | --- |
| `fields` | The properties form, the validation rules and the emitted arguments |
| `inherits` | Arguments pulled from an ancestor on the canvas |
| `connections` | What a drawn edge means in code |
| `container` | Which resources may be nested inside |
| `derived` / `companions` | Arguments and extra blocks computed from context |
| `emit` | Full control over the rendered block, for anything unusual |
| `validate` | Provider-specific rules beyond required/pattern/range |

For a team's own Terraform there is a **Custom Module** entry in the catalog:
point it at a registry address, a git URL or a relative path, add inputs, and it
emits a `module` block like any other resource. A module library can also be
registered as its own pack in `src/packs`.

Azure is the pack that ships today because it is what the first users needed.
AWS or GCP would be new data in `src/packs`, not changes to the engine.

## Project layout

```
src/core/      Provider-agnostic engine — no cloud named anywhere in here
  types.ts       Domain model
  hcl.ts         HCL2 writer, with terraform-fmt-compatible alignment
  generate.ts    Schema-driven emitter
  parse.ts       HCL2 parser
  import.ts      Existing Terraform -> canvas design
  validate.ts    Schema-driven validation
  layout.ts      Automatic arrangement
  export.ts      Module bundle and Azure Pipelines definition
src/packs/     Provider data (Azure today) and starter templates
src/components/ UI
src/store/     Application state
```

## Tests

```bash
npm test     # generator, parser, importer, validation
npm run smoke # drives a production build in a real browser
```

The unit tests cover the parts where correctness matters: HCL escaping,
containment inheritance, edge-to-reference translation, secret handling, and a
generate → import → regenerate round-trip that must come back byte-identical.

The smoke test runs against the built site and checks the things unit tests
cannot — that nested resources actually render inside their containers, that
editing a field rewrites the code, and that no console errors appear.

## Known limits

- The catalog covers common Azure resources, not the whole provider. Anything
  missing can be imported from your own Terraform or added as a definition.
- Complex resources (Application Gateway, Firewall) expose a useful subset of
  their arguments rather than every block.
- The State tab does not read live state, by design — see above.
