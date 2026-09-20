# agent-vm MCP server

An MCP server that gives an assistant a shell on a remote VM over SSH. It was
written against `agent-vm` in `rg-agent-sandbox-we` (Ubuntu 24.04, West Europe),
but nothing in it is Azure-specific — point it at any host you can SSH into.

Seven tools:

| Tool | What it does |
| --- | --- |
| `vm_info` | Connectivity check: OS, kernel, uptime, CPU, memory, free disk, sudo, and whether `terraform`, `az`, `docker`, `git` are installed |
| `run_command` | One shell command per call, with `cwd`, `stdin` and a timeout; returns exit code, stdout, stderr |
| `read_remote_file` | Read a text file, truncating instead of refusing when it is large |
| `write_remote_file` | Create or overwrite a file — no heredoc quoting to get wrong |
| `list_directory` | Entries with type, size and modified time |
| `upload_file` | Local → VM over SFTP |
| `download_file` | VM → local over SFTP |

## Setup

```bash
cd mcp/agent-vm
npm install
```

You need the private key whose public half is in `~/.ssh/authorized_keys` on the
VM — the `.pem` Azure handed you when the VM was created, or any key you have
since added.

Register the server with Claude Code:

```bash
claude mcp add agent-vm \
  --env AGENT_VM_HOST=52.143.63.207 \
  --env AGENT_VM_USER=azureuser \
  --env AGENT_VM_SSH_KEY=~/.ssh/agent-vm.pem \
  -- node /absolute/path/to/TerraformBuilder/mcp/agent-vm/server.mjs
```

Or commit a project-scoped `.mcp.json` at the repository root — `mcp.json.example`
in this directory is that file, with the paths left for you to fill in.

Check it came up with `/mcp` in Claude Code, then ask it to run `vm_info`.

### Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `AGENT_VM_HOST` | yes | — | Public IP or DNS name, e.g. `52.143.63.207` |
| `AGENT_VM_USER` | yes | — | Login user; Azure Ubuntu images normally use `azureuser` |
| `AGENT_VM_SSH_KEY` | yes | — | Path to the **private** key file; `~` is expanded |
| `AGENT_VM_PORT` | no | `22` | |
| `AGENT_VM_SSH_KEY_PASSPHRASE` | no | — | If the key is encrypted |
| `AGENT_VM_HOST_FINGERPRINT` | no | — | `SHA256:…`; pins the host key and refuses anything else |
| `AGENT_VM_COMMAND_TIMEOUT_MS` | no | `120000` | Per-command default; `run_command` can override per call |
| `AGENT_VM_MAX_OUTPUT_BYTES` | no | `100000` | Cap per stream, so one runaway command cannot flood the context |

Misconfiguration does not crash the server: it starts anyway and every call
answers with what is missing, which is easier to read than a client that just
says the connection closed.

## Pinning the host key

Without `AGENT_VM_HOST_FINGERPRINT` the server accepts whatever host key the
machine presents on first contact — convenient, but it means a machine that has
taken over that IP would be trusted too. `vm_info` prints the fingerprint it
saw; to pin it, copy that value into the env block, or read it independently:

```bash
ssh-keyscan -t ed25519 52.143.63.207 | ssh-keygen -lf - # prints "256 SHA256:… "
```

A rebuilt VM gets a new host key, so expect to update the pin after a redeploy.

## If it cannot connect

The error messages name the likely cause. The two common ones on Azure:

- **Timed out** — the network security group is not allowing inbound TCP 22 from
  your address. `agent-vm`'s NSG is on the `agent-vmVMNic`/subnet in the portal.
- **All configured authentication methods failed** — usually the wrong
  `AGENT_VM_USER`, or a key that was never added to the VM. Azure Ubuntu images
  default to `azureuser`, not `root` or your local username.

## Using it with Terraform Builder

Terraform Builder exports a repository (`providers.tf`, `main.tf`,
`variables.tf`, `outputs.tf`, the pipeline, the design JSON). With this server
in place, that export can go straight onto the VM and run there:

1. `upload_file` the exported zip, or `write_remote_file` each `.tf` file into
   `/home/azureuser/infra`.
2. `run_command` with `cwd: /home/azureuser/infra` for `terraform init` and
   `terraform plan -no-color`.
3. `download_file` the plan output if you want it back locally.

The VM holds the Azure credentials (a managed identity, or `az login`), so the
browser app still never sees one. Plans that take longer than the timeout should
be started detached and polled:

```
nohup terraform apply -auto-approve -no-color > apply.log 2>&1 &
```

then `run_command` with `tail -n 50 apply.log`.

## Notes on safety

`run_command` is a general shell — it can do anything the login user can, `sudo`
included if the account allows it. The guard rails are your MCP client's
permission prompts and the VM's own user permissions, not this server. Keep it
pointed at a sandbox VM, and give the login user only the access it needs.

Nothing secret is stored here: the key stays on your machine at the path you
configure, and the server reads it at connect time.

## Development

```bash
npm test
```

The suite stands up a real SSH server in-process (`test/support/fake-vm.mjs`),
with an in-memory SFTP filesystem, and drives the tools through an actual MCP
client — so the tests cover the protocol, the SSH plumbing and the tool output,
without touching a real VM.
