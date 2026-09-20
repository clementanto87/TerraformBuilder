#!/usr/bin/env node
/**
 * agent-vm-mcp — an MCP server that gives an assistant a shell on a remote VM over SSH.
 *
 * Configuration comes from the environment; see README.md.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigError, loadConfig } from './lib/config.mjs';
import { Vm } from './lib/ssh.mjs';
import { registerTools } from './lib/tools.mjs';

const server = new McpServer(
  { name: 'agent-vm', version: '0.1.0' },
  {
    instructions:
      'Tools for working on a remote VM over SSH. run_command runs one shell command per call (no shared ' +
      'state between calls — pass cwd instead of cd), write_remote_file and read_remote_file move text ' +
      'without shell quoting, and upload_file/download_file move whole files. Call vm_info when something ' +
      'behaves unexpectedly: it reports the OS, disk, sudo and installed tooling.',
  },
);

let vm = null;

try {
  const config = loadConfig();
  vm = new Vm(config);
  registerTools(server, vm);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  // Stay up and explain the problem through the protocol — a server that exits here
  // usually surfaces to the user as nothing more than "connection closed".
  const message = `This MCP server is not configured yet.\n\n${error.message}`;
  process.stderr.write(`agent-vm-mcp: ${error.message}\n`);
  server.registerTool(
    'vm_info',
    { title: 'VM info', description: 'Reports why the VM connection is not configured.', inputSchema: {} },
    async () => ({ content: [{ type: 'text', text: message }], isError: true }),
  );
}

const shutdown = () => {
  vm?.close();
  server.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await server.connect(new StdioServerTransport());
