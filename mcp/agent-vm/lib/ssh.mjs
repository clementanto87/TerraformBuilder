import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
// ssh2 is CommonJS; a default import is the portable way to reach its exports.
import ssh2 from 'ssh2';

const { Client } = ssh2;

export class SshError extends Error {}

/** OpenSSH-style fingerprint of a host key, as `ssh-keygen -lf` prints it. */
export function fingerprintOf(hostKey) {
  return `SHA256:${createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '')}`;
}

/** Wrap a string so a POSIX shell sees it as one literal argument. */
export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

/** Collects stream output up to a byte budget, remembering what it dropped. */
export function createCollector(maxBytes) {
  const chunks = [];
  let kept = 0;
  let total = 0;
  return {
    push(chunk) {
      total += chunk.length;
      if (kept >= maxBytes) return;
      const room = maxBytes - kept;
      chunks.push(chunk.length <= room ? chunk : chunk.subarray(0, room));
      kept += Math.min(chunk.length, room);
    },
    result() {
      const text = Buffer.concat(chunks).toString('utf8');
      const dropped = total - kept;
      return dropped > 0
        ? { text: `${text}\n[... ${dropped} more bytes truncated ...]`, truncated: true, bytes: total }
        : { text, truncated: false, bytes: total };
    },
  };
}

function describeConnectError(error, config) {
  const code = error?.code ?? '';
  const message = error?.message ?? String(error);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `Cannot resolve ${config.host}. Check AGENT_VM_HOST.`;
  }
  if (code === 'ECONNREFUSED') {
    return `${config.host}:${config.port} refused the connection. Is sshd running and the port right?`;
  }
  if (code === 'ETIMEDOUT' || /timed out/i.test(message)) {
    return (
      `Timed out reaching ${config.host}:${config.port}. This is almost always a firewall: check the cloud ` +
      `provider's own rules (a Hetzner Cloud Firewall, an Azure NSG, an AWS security group) and the VM's ` +
      `local ufw, and allow inbound TCP ${config.port} from your address.`
    );
  }
  if (/All configured authentication methods failed/i.test(message)) {
    return (
      `${config.user}@${config.host} rejected the key at ${config.privateKeyPath}. ` +
      `Check AGENT_VM_USER (Hetzner images log in as "root", Azure images as "azureuser") and that this ` +
      `key's public half is in ` +
      `~/.ssh/authorized_keys on the VM.`
    );
  }
  if (/Cannot parse privateKey|Encrypted private key detected/i.test(message)) {
    return `Could not read the private key at ${config.privateKeyPath}: ${message}. If it is passphrase-protected, set AGENT_VM_SSH_KEY_PASSPHRASE.`;
  }
  return `SSH connection to ${config.host}:${config.port} failed: ${message}`;
}

/**
 * One lazily-opened, reused SSH connection to the VM.
 * The connection is opened on first use and re-opened after a drop.
 */
export class Vm {
  #config;
  #client = null;
  #opening = null;
  #fingerprint = null;

  constructor(config) {
    this.#config = config;
  }

  get config() {
    return this.#config;
  }

  /** Host key fingerprint seen on the current connection, or null before connecting. */
  get fingerprint() {
    return this.#fingerprint;
  }

  async #privateKey() {
    try {
      return await readFile(this.#config.privateKeyPath);
    } catch (error) {
      throw new SshError(
        `Cannot read the SSH key at ${this.#config.privateKeyPath} (${error.code}). ` +
          'Point AGENT_VM_SSH_KEY at the private key file and make sure it is readable (chmod 600).',
      );
    }
  }

  async connect() {
    if (this.#client) return this.#client;
    this.#opening ??= this.#open().finally(() => {
      this.#opening = null;
    });
    return this.#opening;
  }

  async #open() {
    const config = this.#config;
    const privateKey = await this.#privateKey();
    const client = new Client();

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        client.end();
        reject(error instanceof SshError ? error : new SshError(describeConnectError(error, config)));
      };

      client.on('ready', () => {
        if (settled) return;
        settled = true;
        this.#client = client;
        resolve(client);
      });
      client.on('error', fail);
      client.on('close', () => {
        if (this.#client === client) this.#client = null;
        fail(new SshError(`Connection to ${config.host} closed before it was ready.`));
      });

      client.connect({
        host: config.host,
        port: config.port,
        username: config.user,
        privateKey,
        passphrase: config.passphrase,
        readyTimeout: 20_000,
        keepaliveInterval: 15_000,
        hostVerifier: (hostKey, accept) => {
          const seen = fingerprintOf(hostKey);
          this.#fingerprint = seen;
          if (!config.expectedFingerprint) return accept(true);
          if (seen === config.expectedFingerprint) return accept(true);
          fail(
            new SshError(
              `Host key mismatch for ${config.host}: expected ${config.expectedFingerprint}, got ${seen}. ` +
                'Either the VM was rebuilt (update AGENT_VM_HOST_FINGERPRINT) or you are not talking to the machine you think you are.',
            ),
          );
          return accept(false);
        },
      });
    });
  }

  /**
   * Run a command through a login-less shell on the VM.
   * @returns {Promise<{code: number|null, signal: string|null, stdout: object, stderr: object, timedOut: boolean, command: string}>}
   */
  async exec(command, { cwd, timeoutMs = this.#config.commandTimeoutMs, stdin } = {}) {
    const client = await this.connect();
    const full = cwd ? `cd ${shellQuote(cwd)} && ${command}` : command;

    return new Promise((resolve, reject) => {
      client.exec(full, (error, stream) => {
        if (error) return reject(new SshError(`Could not start the command: ${error.message}`));

        const stdout = createCollector(this.#config.maxOutputBytes);
        const stderr = createCollector(this.#config.maxOutputBytes);
        let timedOut = false;

        const timer = setTimeout(() => {
          timedOut = true;
          try {
            stream.signal('KILL');
          } catch {
            // Some servers refuse signal requests; closing the channel is the fallback.
          }
          stream.close();
        }, timeoutMs);

        stream.on('data', (chunk) => stdout.push(chunk));
        stream.stderr.on('data', (chunk) => stderr.push(chunk));
        stream.on('error', (streamError) => {
          clearTimeout(timer);
          reject(new SshError(`Command channel failed: ${streamError.message}`));
        });
        stream.on('close', (code, signal) => {
          clearTimeout(timer);
          resolve({
            command: full,
            code: code ?? null,
            signal: signal ?? null,
            timedOut,
            stdout: stdout.result(),
            stderr: stderr.result(),
          });
        });

        stream.end(stdin ?? undefined);
      });
    });
  }

  /** Run `fn` against an SFTP session, promisified. */
  async withSftp(fn) {
    const client = await this.connect();
    const sftp = await new Promise((resolve, reject) => {
      client.sftp((error, session) =>
        error ? reject(new SshError(`Could not open an SFTP session: ${error.message}`)) : resolve(session),
      );
    });
    try {
      return await fn(sftp, (method, ...args) =>
        new Promise((resolve, reject) => {
          sftp[method](...args, (error, value) => (error ? reject(error) : resolve(value)));
        }),
      );
    } finally {
      sftp.end();
    }
  }

  close() {
    this.#client?.end();
    this.#client = null;
  }
}
