import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, expandHome, loadConfig } from '../lib/config.mjs';
import { createCollector, fingerprintOf, shellQuote } from '../lib/ssh.mjs';

const base = { AGENT_VM_HOST: '10.0.0.4', AGENT_VM_USER: 'azureuser', AGENT_VM_SSH_KEY: '/keys/id_ed25519' };

test('loadConfig fills in defaults', () => {
  const config = loadConfig(base);
  assert.equal(config.port, 22);
  assert.equal(config.commandTimeoutMs, 120_000);
  assert.equal(config.maxOutputBytes, 100_000);
  assert.equal(config.expectedFingerprint, null);
  assert.equal(config.passphrase, undefined);
});

test('loadConfig names every missing variable at once', () => {
  assert.throws(() => loadConfig({ AGENT_VM_HOST: '10.0.0.4' }), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /AGENT_VM_USER, AGENT_VM_SSH_KEY/);
    return true;
  });
});

test('loadConfig treats blank values as missing', () => {
  assert.throws(() => loadConfig({ ...base, AGENT_VM_HOST: '   ' }), ConfigError);
});

test('loadConfig rejects a port that is not a port', () => {
  assert.throws(() => loadConfig({ ...base, AGENT_VM_PORT: '70000' }), ConfigError);
  assert.throws(() => loadConfig({ ...base, AGENT_VM_PORT: 'ssh' }), ConfigError);
  assert.equal(loadConfig({ ...base, AGENT_VM_PORT: '2222' }).port, 2222);
});

test('loadConfig rejects a fingerprint in the wrong shape', () => {
  assert.throws(() => loadConfig({ ...base, AGENT_VM_HOST_FINGERPRINT: 'ab:cd:ef' }), ConfigError);
  const pinned = loadConfig({ ...base, AGENT_VM_HOST_FINGERPRINT: 'SHA256:abcDEF123+/=' });
  assert.equal(pinned.expectedFingerprint, 'SHA256:abcDEF123+/=');
});

test('expandHome resolves ~ and relative paths', () => {
  assert.equal(expandHome('~/keys/vm.pem', '/home/ada'), '/home/ada/keys/vm.pem');
  assert.equal(expandHome('~', '/home/ada'), '/home/ada');
  assert.equal(expandHome('/etc/key'), '/etc/key');
  assert.match(expandHome('key.pem'), /^\/.*key\.pem$/);
});

test('shellQuote survives quotes and spaces', () => {
  assert.equal(shellQuote('/home/az/my dir'), `'/home/az/my dir'`);
  assert.equal(shellQuote(`it's`), `'it'\\''s'`);
});

test('fingerprintOf matches the ssh-keygen format', () => {
  const printed = fingerprintOf(Buffer.from('host key bytes'));
  assert.match(printed, /^SHA256:[A-Za-z0-9+/]+$/);
  assert.ok(!printed.endsWith('='));
});

test('createCollector keeps output under its budget and says what it dropped', () => {
  const collector = createCollector(10);
  collector.push(Buffer.from('12345'));
  collector.push(Buffer.from('67890abcde'));
  const { text, truncated, bytes } = collector.result();
  assert.equal(truncated, true);
  assert.equal(bytes, 15);
  assert.match(text, /^1234567890\n\[\.\.\. 5 more bytes truncated \.\.\.\]$/);
});

test('createCollector leaves small output alone', () => {
  const collector = createCollector(10);
  collector.push(Buffer.from('hello'));
  assert.deepEqual(collector.result(), { text: 'hello', truncated: false, bytes: 5 });
});
