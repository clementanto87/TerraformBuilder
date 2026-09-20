---
name: mcc
description: >-
  MCC is "my cloud computer" — the user's Hetzner Cloud VM (hetzner-agent-vm).
  Connect to it over
  SSH through the agent-vm MCP server and work on it: run commands, read and
  write files, upload and download, run Terraform, tail logs, check what is
  installed. Use this whenever the user says "mcc" or "my cloud computer", or
  asks to connect to, log into, SSH into or check on "my cloud machine", "the
  VM", "my VM", "the cloud VM", "the sandbox" or "the box"; whenever they want
  something run, installed, deployed, copied or debugged over there rather than
  locally; and whenever they ask for a Terraform plan or apply to happen
  somewhere other than their laptop, even if they never name the machine.
---

# mcc — my cloud computer

"My cloud computer" is the user's Hetzner Cloud VM, `hetzner-agent-vm` at
49.13.196.104 — a 2 vCPU / 4 GB CX22 in Nuremberg running Ubuntu 24.04, logged
into as `root`. It is reached through the agent-vm MCP server in this repository
(`mcp/agent-vm/`), which holds an SSH connection to it, so work happens on that
machine rather than in this session's container. When the user says "my cloud
computer", this is what they mean.

It is a small box: 4 GB of RAM and 2 cores, shared with whatever Docker
containers are already running. Parallel builds and test suites are the things
most likely to end in an OOM kill, so prefer one job at a time and check
`free -h` before starting something heavy.

| Tool | Use it for |
| --- | --- |
| `vm_info` | Connectivity check and what the machine is: OS, uptime, CPU, memory, free disk, sudo, installed tooling |
| `run_command` | One shell command, with `cwd`, `stdin` and `timeout_seconds`; returns exit code, stdout, stderr |
| `read_remote_file` / `write_remote_file` | Text in and out, no shell quoting involved |
| `list_directory` | Entries with type, size, modified time |
| `upload_file` / `download_file` | Whole files over SFTP, both directions |

The connection details live in `.mcp.json` at the repository root; the private
key stays on the user's machine at the path `AGENT_VM_SSH_KEY` names.

## Where this works

These instructions travel anywhere the skill is installed. The connection does
not. The agent-vm tools are a local process holding the user's private key, so
they exist only in a session running on a machine that has that key and a route
to port 22 — in practice, the user's own computer.

So when the tools are absent — a phone, a cloud session, a borrowed machine —
say so in one line instead of improvising: nothing available here can reach the
VM. Then offer what still helps from where you are:

- Write or fix the Terraform in the repo, ready to run the moment they are back
  at a machine that can connect.
- Hand them the exact commands to paste, rather than a description of them.
- Point at the Hetzner Cloud console (console.hetzner.cloud, which works from a
  phone browser) for anything that is control-plane rather than shell — powering
  the server back on, opening a firewall rule, or using the web console when SSH
  itself is what is broken.

Reaching the machine from a phone would mean running an MCP server on the VM
itself and exposing it over HTTPS as a remote connector. That is a real change
with real exposure, not a setting to flip; raise it as an option rather than
attempting it.

## Start with vm_info

Call `vm_info` before the first real command of a session. It costs one round
trip and it answers the questions that otherwise turn into a confusing failure
three commands later: is the box reachable, is there disk left, does this login
have passwordless sudo, is `terraform` even installed. Mention anything
surprising to the user — a nearly full disk or a missing tool — before working
around it.

Skip it only when the user is clearly mid-flow and a previous call in this
session already succeeded.

## How run_command behaves

Each call is a fresh, non-interactive shell. Three consequences worth keeping
in mind:

**Nothing carries over between calls.** A `cd` in one call is gone by the next,
and so is an exported variable. Pass `cwd` instead of prefixing `cd`, and set
variables inline (`FOO=bar command`) or write them to a file.

**Anything that waits for input hangs until the timeout.** Prefer the
non-interactive flags — `apt-get install -y`, `terraform apply -auto-approve`,
`ssh-keygen -N ''` — or feed the answer through `stdin`.

**Output is capped per stream** (100 KB by default) so one runaway command
cannot swallow the conversation. When you expect a flood, filter on the VM
(`| tail -n 50`, `grep`, `-no-color`) rather than pulling everything back and
reading the truncation notice.

For anything slower than the timeout — a long `apt` upgrade, `terraform apply`,
a build — start it detached and poll, so a timeout kills the poll rather than
the work:

```
nohup terraform apply -auto-approve -no-color > apply.log 2>&1 &
```

then `run_command` with `tail -n 50 apply.log` until it finishes. Tell the user
it is running rather than sitting in a silent poll loop.

## Writing files

Use `write_remote_file` in preference to a heredoc through `run_command`. HCL
and shell scripts are full of `$`, quotes and backticks that a heredoc will
happily mangle, and the failure shows up later as a confusing parse error.
Parent directories are created for you; pass `mode` for anything that has to be
executable (`755`) or private (`600`).

Use `upload_file` for archives and binaries, and for a whole Terraform Builder
export: zip it locally, upload once, unzip on the VM — far fewer round trips
than writing each file.

## Running Terraform there

This repository generates Terraform; the VM is where it can actually run,
because the VM is what holds the cloud credentials. Nothing in the browser app
ever does. The machine is at Hetzner while the Terraform targets Azure, so there
is no managed identity to lean on — authentication is whatever is on the box, an
`az login` for interactive work or a service principal's environment variables
for unattended runs. If `terraform plan` fails on authentication, that is the
first thing to check rather than the code.

A normal pass:

1. Get the code up — `upload_file` a zipped export, or `write_remote_file` each
   `.tf` file into a working directory such as `/root/infra`.
2. `run_command` with `cwd` set to that directory: `terraform init`, then
   `terraform plan -no-color -out=tfplan`.
3. Read the plan back to the user before applying. Applying real infrastructure
   is their call — ask, and only then apply the plan file you showed them
   (`terraform apply -no-color tfplan`), so what runs is what they approved.
4. `download_file` the plan or the log if they want it locally.

`-no-color` throughout: ANSI escapes make the output harder to read here and
add nothing.

## When the connection fails

The server's errors name the likely cause; these are the ones worth
recognising.

| What you see | What it usually is |
| --- | --- |
| Timed out reaching the host | A firewall is dropping it, at either of two layers: the Hetzner Cloud Firewall attached to the server, or `ufw` on the machine. The user fixes the first in the Hetzner console; you cannot fix either from here if SSH itself is down. |
| All configured authentication methods failed | Wrong `AGENT_VM_USER` (this machine logs in as `root`), or a key that was never added to `/root/.ssh/authorized_keys`. |
| Cannot read the SSH key … ENOENT | `AGENT_VM_SSH_KEY` points somewhere that does not exist on the user's machine. |
| Host key mismatch | The VM was rebuilt and got a new host key, or the IP now belongs to something else. Do not work around this — tell the user, and let them confirm before the pin is updated. |
| The tools are not available at all | The MCP server is not connected. Ask the user to check `/mcp`; setup is in `mcp/agent-vm/README.md`, and it needs `npm install` inside `mcp/agent-vm` first. |

A Hetzner server keeps its IPv4 address for as long as it exists, so a stale
address means the server was rebuilt rather than merely restarted — which the
host key mismatch above would also show. The machine also has IPv6
(2a01:4f8:1c16:8271::1), usable if v4 is ever the problem.

## Judgement

`run_command` is a real shell on a real machine with the login user's full
rights. Treat it the way you would treat someone's terminal: destructive or
outward-facing actions — deleting data, `terraform apply`, `terraform destroy`,
rebooting, changing firewall rules, installing something system-wide — get
confirmed first unless the user has already said to go ahead.

Secrets belong on the VM, not in this repository. If a command needs a
credential, write it into a file on the VM with `mode: "600"` or pass it through
`stdin` — never into a file under the repository, a commit, or the chat.
