import { constants as fsConstants } from 'node:fs';
import { access, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { shellQuote } from './ssh.mjs';

const MAX_DIRECTORY_ENTRIES = 500;

const text = (body) => ({ content: [{ type: 'text', text: body }] });
const failure = (body) => ({ content: [{ type: 'text', text: body }], isError: true });

function formatRun(result) {
  const lines = [];
  if (result.timedOut) {
    lines.push(`Command TIMED OUT and was killed. Raise timeout_seconds, or run it with nohup and poll the log.`);
  }
  lines.push(`exit code: ${result.code ?? `none (killed by ${result.signal ?? 'signal'})`}`);
  lines.push('', '--- stdout ---', result.stdout.text.length > 0 ? result.stdout.text : '(empty)');
  if (result.stderr.text.length > 0) lines.push('', '--- stderr ---', result.stderr.text);
  return lines.join('\n');
}

const INFO_SCRIPT = [
  'echo "hostname:  $(hostname)"',
  'echo "os:        $(. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME") ($(uname -r) $(uname -m))"',
  'echo "uptime:    $(uptime -p 2>/dev/null || uptime)"',
  'echo "user:      $(whoami) | sudo: $(sudo -n true 2>/dev/null && echo passwordless || echo "unavailable without a password")"',
  'echo "cpu:       $(nproc) vCPU"',
  'echo "memory:    $(free -h 2>/dev/null | awk \'/^Mem:/ {print $7 " available of " $2}\')"',
  'echo "disk /:    $(df -h / | awk \'NR==2 {print $4 " free of " $2}\')"',
  'for t in terraform az docker git python3 node; do printf "%s " "$(command -v $t >/dev/null 2>&1 && echo $t || true)"; done | sed "s/^/tooling:   /"',
  'echo',
].join('\n');

/** Turn thrown SFTP/SSH errors into a readable tool failure instead of a stack trace. */
function describeFailure(toolName, args, error) {
  const subject = args?.path ?? args?.remote_path ?? args?.local_path ?? 'the VM';
  const code = error?.code;
  if (code === 2) return failure(`${subject} does not exist on the VM.`);
  if (code === 3 || code === 'EACCES') {
    return failure(`Permission denied for ${subject}. Retry through run_command with sudo, or fix the ownership.`);
  }
  if (code === 4) return failure(`The VM refused the operation on ${subject} (SFTP failure). It may be a full disk or a read-only mount.`);
  return failure(`${toolName} failed: ${error?.message ?? error}`);
}

/**
 * Register every VM tool on an McpServer instance.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {import('./ssh.mjs').Vm} vm
 */
export function registerTools(server, vm) {
  const { host, user, port, commandTimeoutMs } = vm.config;
  const target = `${user}@${host}`;

  const register = (name, config, handler) =>
    server.registerTool(name, config, async (args) => {
      try {
        return await handler(args);
      } catch (error) {
        return describeFailure(name, args, error);
      }
    });

  register(
    'vm_info',
    {
      title: 'VM info',
      description:
        `Check connectivity to ${target} and report what the machine is: OS, kernel, uptime, CPU, memory, ` +
        'free disk, sudo availability and which common tools (terraform, az, docker, git) are installed. ' +
        'Use this first when a command fails unexpectedly.',
      inputSchema: {},
    },
    async () => {
      const result = await vm.exec(INFO_SCRIPT, { timeoutMs: 30_000 });
      const header = [
        `connected: ${target}:${port}`,
        `host key:  ${vm.fingerprint ?? 'unknown'}`,
        '',
      ].join('\n');
      return result.code === 0
        ? text(header + result.stdout.text)
        : failure(`${header}\nThe probe command failed.\n\n${formatRun(result)}`);
    },
  );

  register(
    'run_command',
    {
      title: 'Run a command on the VM',
      description:
        `Run a shell command on ${target} over SSH and return its exit code, stdout and stderr. ` +
        'Runs non-interactively: a command that waits for input will hit the timeout, so pass input via ' +
        '`stdin` or use flags like -y. Each call is a fresh shell, so `cd` does not carry over between ' +
        'calls — use `cwd` instead. Long jobs should be started detached (nohup ... > log 2>&1 &) and polled.',
      inputSchema: {
        command: z.string().min(1).describe('Shell command to run, e.g. "terraform plan -no-color"'),
        cwd: z.string().optional().describe('Absolute directory to run in, e.g. "/root/infra"'),
        stdin: z.string().optional().describe('Text piped to the command on stdin'),
        timeout_seconds: z
          .number()
          .int()
          .min(1)
          .max(3600)
          .optional()
          .describe(`Kill the command after this long (default ${Math.round(commandTimeoutMs / 1000)}s)`),
      },
    },
    async ({ command, cwd, stdin, timeout_seconds }) => {
      const result = await vm.exec(command, {
        cwd,
        stdin,
        timeoutMs: timeout_seconds ? timeout_seconds * 1000 : undefined,
      });
      return text(formatRun(result));
    },
  );

  register(
    'read_remote_file',
    {
      title: 'Read a file on the VM',
      description: `Read a text file from ${target}. Large files are truncated rather than refused.`,
      inputSchema: {
        path: z.string().min(1).describe('Absolute path of the file to read'),
        max_bytes: z.number().int().min(1).max(1_000_000).optional().describe('Read at most this many bytes (default 100000)'),
      },
    },
    async ({ path, max_bytes = 100_000 }) =>
      vm.withSftp(async (sftp, call) => {
        const stats = await call('stat', path);
        if (stats.isDirectory()) return failure(`${path} is a directory. Use list_directory.`);

        const end = Math.min(stats.size, max_bytes) - 1;
        const body = await new Promise((resolve, reject) => {
          if (stats.size === 0) return resolve('');
          const chunks = [];
          const stream = sftp.createReadStream(path, { start: 0, end });
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        });

        const note =
          stats.size > max_bytes ? `\n\n[... truncated: read ${max_bytes} of ${stats.size} bytes ...]` : '';
        return text(`${path} (${stats.size} bytes)\n\n${body}${note}`);
      }),
  );

  register(
    'write_remote_file',
    {
      title: 'Write a file on the VM',
      description:
        `Create or overwrite a text file on ${target} with the given content. Use this instead of ` +
        'heredocs through run_command — no quoting to get wrong.',
      inputSchema: {
        path: z.string().min(1).describe('Absolute path to write'),
        content: z.string().describe('Full contents of the file'),
        mode: z
          .string()
          .regex(/^[0-7]{3,4}$/)
          .optional()
          .describe('Octal permissions, e.g. "600" for a key or "755" for a script'),
        create_parents: z.boolean().optional().describe('Create missing parent directories (default true)'),
      },
    },
    async ({ path, content, mode, create_parents = true }) => {
      if (create_parents) {
        const mkdirResult = await vm.exec(`mkdir -p -- "$(dirname ${shellQuote(path)})"`, { timeoutMs: 15_000 });
        if (mkdirResult.code !== 0) {
          return failure(`Could not create the parent directory for ${path}:\n\n${formatRun(mkdirResult)}`);
        }
      }
      return vm.withSftp(async (sftp, call) => {
        await call('writeFile', path, content, { encoding: 'utf8' });
        if (mode) await call('chmod', path, Number.parseInt(mode, 8));
        return text(`Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${path}${mode ? ` (mode ${mode})` : ''}.`);
      });
    },
  );

  register(
    'list_directory',
    {
      title: 'List a directory on the VM',
      description: `List the entries of a directory on ${target} with type, size and modified time.`,
      inputSchema: {
        path: z.string().min(1).describe('Absolute directory path'),
        include_hidden: z.boolean().optional().describe('Include dotfiles (default false)'),
      },
    },
    async ({ path, include_hidden = false }) =>
      vm.withSftp(async (sftp, call) => {
        const entries = await call('readdir', path);
        const visible = entries
          .filter((entry) => include_hidden || !entry.filename.startsWith('.'))
          .sort((a, b) => a.filename.localeCompare(b.filename));

        if (visible.length === 0) return text(`${path} is empty.`);

        const shown = visible.slice(0, MAX_DIRECTORY_ENTRIES).map((entry) => {
          const kind = entry.attrs.isDirectory() ? 'dir ' : entry.attrs.isSymbolicLink() ? 'link' : 'file';
          const size = String(entry.attrs.size).padStart(10);
          const when = new Date(entry.attrs.mtime * 1000).toISOString().slice(0, 16).replace('T', ' ');
          return `${kind} ${size}  ${when}  ${entry.filename}`;
        });
        const omitted =
          visible.length > MAX_DIRECTORY_ENTRIES ? [`... and ${visible.length - MAX_DIRECTORY_ENTRIES} more`] : [];
        return text([`${path} — ${visible.length} entries`, '', ...shown, ...omitted].join('\n'));
      }),
  );

  register(
    'upload_file',
    {
      title: 'Upload a file to the VM',
      description: `Copy a file from this machine to ${target} over SFTP. Good for archives, binaries and keys.`,
      inputSchema: {
        local_path: z.string().min(1).describe('Absolute path of the local file'),
        remote_path: z.string().min(1).describe('Absolute destination path on the VM'),
        mode: z.string().regex(/^[0-7]{3,4}$/).optional().describe('Octal permissions to set on the uploaded file'),
      },
    },
    async ({ local_path, remote_path, mode }) => {
      let size;
      try {
        const stats = await stat(local_path);
        if (!stats.isFile()) return failure(`${local_path} is not a regular file.`);
        size = stats.size;
        await access(local_path, fsConstants.R_OK);
      } catch (error) {
        return failure(`Cannot read ${local_path}: ${error.code ?? error.message}`);
      }

      const mkdirResult = await vm.exec(`mkdir -p -- "$(dirname ${shellQuote(remote_path)})"`, { timeoutMs: 15_000 });
      if (mkdirResult.code !== 0) {
        return failure(`Could not create the parent directory for ${remote_path}:\n\n${formatRun(mkdirResult)}`);
      }

      return vm.withSftp(async (sftp, call) => {
        await call('fastPut', local_path, remote_path);
        if (mode) await call('chmod', remote_path, Number.parseInt(mode, 8));
        return text(`Uploaded ${size} bytes to ${host}:${remote_path}${mode ? ` (mode ${mode})` : ''}.`);
      });
    },
  );

  register(
    'download_file',
    {
      title: 'Download a file from the VM',
      description: `Copy a file from ${target} to this machine over SFTP.`,
      inputSchema: {
        remote_path: z.string().min(1).describe('Absolute path of the file on the VM'),
        local_path: z.string().min(1).describe('Absolute destination path on this machine'),
      },
    },
    async ({ remote_path, local_path }) => {
      await mkdir(dirname(local_path), { recursive: true });
      return vm.withSftp(async (sftp, call) => {
        const stats = await call('stat', remote_path);
        if (stats.isDirectory()) return failure(`${remote_path} is a directory. Tar it first, then download the archive.`);
        await call('fastGet', remote_path, local_path);
        return text(`Downloaded ${stats.size} bytes from ${host}:${remote_path} to ${local_path}.`);
      });
    },
  );
}
