import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import ssh2 from 'ssh2';
import { Vm } from '../lib/ssh.mjs';
import { registerTools } from '../lib/tools.mjs';
import { startFakeVm } from './support/fake-vm.mjs';

const workspace = await mkdtemp(join(tmpdir(), 'agent-vm-mcp-'));
const keyPath = join(workspace, 'id_ed25519');
await writeFile(keyPath, ssh2.utils.generateKeyPairSync('ed25519').private, { mode: 0o600 });

const openSessions = [];
after(async () => {
  for (const session of openSessions) await session.teardown();
});

/** Stand up a fake VM, an MCP server wired to it, and a client talking to that server. */
async function harness({ onExec, files, overrides = {} } = {}) {
  const fakeVm = await startFakeVm({ onExec, files });
  const vm = new Vm({
    host: '127.0.0.1',
    port: fakeVm.port,
    user: 'root',
    privateKeyPath: keyPath,
    passphrase: undefined,
    expectedFingerprint: null,
    commandTimeoutMs: 5_000,
    maxOutputBytes: 100_000,
    ...overrides,
  });

  const server = new McpServer({ name: 'agent-vm-test', version: '0.0.0' });
  registerTools(server, vm);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const session = {
    fakeVm,
    vm,
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      return { isError: result.isError === true, text: result.content.map((part) => part.text).join('\n') };
    },
    async teardown() {
      vm.close();
      await client.close();
      await server.close();
      await fakeVm.close();
    },
  };
  openSessions.push(session);
  return session;
}

/** Echoes back whatever was asked, so tests can assert on the command the tools built. */
const echoExec = async (command) => ({ stdout: `ran: ${command}\n`, code: 0 });

test('every tool is advertised with a schema', async () => {
  const { vm } = await harness();
  const server = new McpServer({ name: 'x', version: '0' });
  registerTools(server, vm);
  const client = new Client({ name: 'y', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);

  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ['download_file', 'list_directory', 'read_remote_file', 'run_command', 'upload_file', 'vm_info', 'write_remote_file'],
  );
  const runCommand = tools.find((tool) => tool.name === 'run_command');
  assert.deepEqual(runCommand.inputSchema.required, ['command']);
  await client.close();
});

test('run_command reports stdout, stderr and the exit code', async () => {
  const { call } = await harness({
    onExec: async () => ({ stdout: 'plan: 3 to add\n', stderr: 'warning: deprecated\n', code: 2 }),
  });
  const { text, isError } = await call('run_command', { command: 'terraform plan' });
  assert.equal(isError, false);
  assert.match(text, /exit code: 2/);
  assert.match(text, /plan: 3 to add/);
  assert.match(text, /warning: deprecated/);
});

test('run_command applies cwd by prefixing a quoted cd', async () => {
  const { call } = await harness({ onExec: echoExec });
  const { text } = await call('run_command', { command: 'terraform init', cwd: "/home/az/my infra" });
  assert.match(text, /ran: cd '\/home\/az\/my infra' && terraform init/);
});

test('run_command forwards stdin', async () => {
  const { call } = await harness({
    onExec: (command, stream) =>
      new Promise((resolve) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => resolve({ stdout: `got: ${Buffer.concat(chunks)}`, code: 0 }));
      }),
  });
  const { text } = await call('run_command', { command: 'cat', stdin: 'yes\n' });
  assert.match(text, /got: yes/);
});

test('run_command kills a command that outlives its timeout', async () => {
  const { call } = await harness({ onExec: async () => null });
  const { text } = await call('run_command', { command: 'sleep 600', timeout_seconds: 1 });
  assert.match(text, /TIMED OUT/);
});

test('run_command truncates a flood of output', async () => {
  const { call } = await harness({
    onExec: async () => ({ stdout: 'x'.repeat(5000), code: 0 }),
    overrides: { maxOutputBytes: 200 },
  });
  const { text } = await call('run_command', { command: 'cat big.log' });
  assert.match(text, /4800 more bytes truncated/);
});

test('read_remote_file returns the contents and the size', async () => {
  const { call } = await harness({ files: { '/etc/hostname': 'agent-vm\n' } });
  const { text, isError } = await call('read_remote_file', { path: '/etc/hostname' });
  assert.equal(isError, false);
  assert.match(text, /\/etc\/hostname \(9 bytes\)/);
  assert.match(text, /agent-vm/);
});

test('read_remote_file truncates past max_bytes', async () => {
  const { call } = await harness({ files: { '/var/log/big.log': 'abcdefghij' } });
  const { text } = await call('read_remote_file', { path: '/var/log/big.log', max_bytes: 4 });
  assert.match(text, /^\/var\/log\/big\.log \(10 bytes\)\n\nabcd\n\n\[\.\.\. truncated: read 4 of 10 bytes \.\.\.\]$/);
});

test('read_remote_file explains a missing path instead of throwing', async () => {
  const { call } = await harness();
  const { text, isError } = await call('read_remote_file', { path: '/nope.txt' });
  assert.equal(isError, true);
  assert.match(text, /\/nope\.txt does not exist on the VM/);
});

test('write_remote_file creates parents and writes the bytes', async () => {
  const commands = [];
  const { call, fakeVm } = await harness({
    onExec: async (command) => {
      commands.push(command);
      return { code: 0 };
    },
  });
  const { text, isError } = await call('write_remote_file', {
    path: '/root/infra/main.tf',
    content: 'resource "azurerm_resource_group" "rg" {}\n',
    mode: '640',
  });
  assert.equal(isError, false);
  assert.match(text, /Wrote 42 bytes to \/root\/infra\/main\.tf \(mode 640\)/);
  assert.equal(fakeVm.read('/root/infra/main.tf'), 'resource "azurerm_resource_group" "rg" {}\n');
  assert.deepEqual(commands, [`mkdir -p -- "$(dirname '/root/infra/main.tf')"`]);
});

test('write_remote_file surfaces a failing mkdir', async () => {
  const { call } = await harness({ onExec: async () => ({ stderr: 'Permission denied\n', code: 1 }) });
  const { text, isError } = await call('write_remote_file', { path: '/root/secret.tf', content: 'x' });
  assert.equal(isError, true);
  assert.match(text, /Could not create the parent directory/);
  assert.match(text, /Permission denied/);
});

test('list_directory hides dotfiles unless asked', async () => {
  const files = {
    '/root': { directory: true },
    '/root/main.tf': 'x',
    '/root/.bashrc': 'y',
  };
  const { call } = await harness({ files });
  const plain = await call('list_directory', { path: '/root' });
  assert.match(plain.text, /1 entries/);
  assert.match(plain.text, /main\.tf/);
  assert.ok(!plain.text.includes('.bashrc'));

  const hidden = await call('list_directory', { path: '/root', include_hidden: true });
  assert.match(hidden.text, /\.bashrc/);
});

test('upload_file and download_file round-trip a file', async () => {
  const localSource = join(workspace, 'plan.tfplan');
  await writeFile(localSource, 'binary-ish plan');
  const { call, fakeVm } = await harness({ onExec: async () => ({ code: 0 }) });

  const upload = await call('upload_file', {
    local_path: localSource,
    remote_path: '/root/plan.tfplan',
    mode: '600',
  });
  assert.equal(upload.isError, false);
  assert.equal(fakeVm.read('/root/plan.tfplan'), 'binary-ish plan');

  const localTarget = join(workspace, 'nested', 'copy.tfplan');
  const download = await call('download_file', {
    remote_path: '/root/plan.tfplan',
    local_path: localTarget,
  });
  assert.equal(download.isError, false);
  assert.equal(await readFile(localTarget, 'utf8'), 'binary-ish plan');
});

test('upload_file refuses a local path it cannot read', async () => {
  const { call } = await harness();
  const { text, isError } = await call('upload_file', {
    local_path: join(workspace, 'missing.txt'),
    remote_path: '/tmp/missing.txt',
  });
  assert.equal(isError, true);
  assert.match(text, /Cannot read .*missing\.txt: ENOENT/);
});

test('vm_info reports the connection and the host key fingerprint', async () => {
  const { call } = await harness({ onExec: async () => ({ stdout: 'hostname:  agent-vm\n', code: 0 }) });
  const { text, isError } = await call('vm_info');
  assert.equal(isError, false);
  assert.match(text, /connected: root@127\.0\.0\.1:\d+/);
  assert.match(text, /host key:  SHA256:[A-Za-z0-9+/]+/);
  assert.match(text, /hostname:  agent-vm/);
});

test('a pinned host key that does not match refuses the connection', async () => {
  const { vm } = await harness({ overrides: { expectedFingerprint: 'SHA256:notthekeyyouarelookingfor' } });
  await assert.rejects(vm.exec('true'), /Host key mismatch/);
});
