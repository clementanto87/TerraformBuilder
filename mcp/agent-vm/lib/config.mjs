import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

export class ConfigError extends Error {}

const SETUP_HINT = `
Set these in the MCP server's env block (see mcp/agent-vm/README.md):

  AGENT_VM_HOST      public IP or DNS name of the VM   e.g. 49.13.196.104
  AGENT_VM_USER      the login user                    e.g. root
  AGENT_VM_SSH_KEY   path to the private key file      e.g. ~/.ssh/id_ed25519

Optional:

  AGENT_VM_PORT                 SSH port (default 22)
  AGENT_VM_SSH_KEY_PASSPHRASE   passphrase, if the key has one
  AGENT_VM_HOST_FINGERPRINT     expected host key, "SHA256:..." — pins the host
  AGENT_VM_COMMAND_TIMEOUT_MS   default per-command timeout (default 120000)
  AGENT_VM_MAX_OUTPUT_BYTES     output cap per stream (default 100000)
`.trim();

/** Expand a leading `~` and make the path absolute. */
export function expandHome(path, home = homedir()) {
  let expanded = path;
  if (path === '~') expanded = home;
  else if (path.startsWith('~/')) expanded = resolve(home, path.slice(2));
  return isAbsolute(expanded) ? expanded : resolve(expanded);
}

function positiveInt(env, name, fallback, { max } = {}) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || (max !== undefined && value > max)) {
    throw new ConfigError(`${name} must be an integer between 1 and ${max ?? 'infinity'}, got "${raw}".`);
  }
  return value;
}

/**
 * Read the server's configuration out of the environment.
 * @throws {ConfigError} when something required is missing or malformed.
 */
export function loadConfig(env = process.env) {
  const required = { AGENT_VM_HOST: env.AGENT_VM_HOST, AGENT_VM_USER: env.AGENT_VM_USER, AGENT_VM_SSH_KEY: env.AGENT_VM_SSH_KEY };
  const missing = Object.entries(required)
    .filter(([, value]) => !value || !value.trim())
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new ConfigError(`Missing required configuration: ${missing.join(', ')}.\n\n${SETUP_HINT}`);
  }

  const fingerprint = env.AGENT_VM_HOST_FINGERPRINT?.trim();
  if (fingerprint && !/^SHA256:[A-Za-z0-9+/]+=*$/.test(fingerprint)) {
    throw new ConfigError(
      `AGENT_VM_HOST_FINGERPRINT must look like "SHA256:<base64>", got "${fingerprint}".\n` +
        'Read it off the VM with: ssh-keyscan -t ed25519 <host> | ssh-keygen -lf -',
    );
  }

  return {
    host: required.AGENT_VM_HOST.trim(),
    port: positiveInt(env, 'AGENT_VM_PORT', 22, { max: 65535 }),
    user: required.AGENT_VM_USER.trim(),
    privateKeyPath: expandHome(required.AGENT_VM_SSH_KEY.trim()),
    passphrase: env.AGENT_VM_SSH_KEY_PASSPHRASE || undefined,
    expectedFingerprint: fingerprint || null,
    commandTimeoutMs: positiveInt(env, 'AGENT_VM_COMMAND_TIMEOUT_MS', 120_000),
    maxOutputBytes: positiveInt(env, 'AGENT_VM_MAX_OUTPUT_BYTES', 100_000),
  };
}
