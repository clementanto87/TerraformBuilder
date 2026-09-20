/**
 * A throwaway SSH server used by the tests: it accepts any key, answers `exec`
 * from a table of canned commands, and serves an in-memory filesystem over SFTP.
 * It exists so the tools can be exercised end to end without a real machine.
 */
import ssh2 from 'ssh2';

const { Server, utils } = ssh2;
const { STATUS_CODE, OPEN_MODE } = utils.sftp;

const DIR_MODE = 0o040755;
const FILE_MODE = 0o100644;

function attrsFor(entry) {
  return {
    mode: entry.directory ? DIR_MODE : FILE_MODE | (entry.mode ?? 0),
    uid: 1000,
    gid: 1000,
    size: entry.directory ? 4096 : entry.content.length,
    atime: 1_700_000_000,
    mtime: 1_700_000_000,
  };
}

function serveSftp(sftp, files) {
  const handles = new Map();
  let nextHandle = 0;

  const openHandle = (value) => {
    const id = nextHandle++;
    handles.set(id, value);
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(id, 0);
    return buffer;
  };
  const readHandle = (buffer) => handles.get(buffer.readUInt32BE(0));

  sftp.on('REALPATH', (reqid, path) => sftp.name(reqid, [{ filename: path, attrs: {} }]));

  sftp.on('OPEN', (reqid, filename, flags) => {
    const writing = flags & (OPEN_MODE.WRITE | OPEN_MODE.CREAT | OPEN_MODE.TRUNC);
    const existing = files.get(filename);
    if (!writing && !existing) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
    if (writing) files.set(filename, { content: Buffer.alloc(0), directory: false });
    sftp.handle(reqid, openHandle({ filename }));
  });

  sftp.on('WRITE', (reqid, handle, offset, data) => {
    const entry = files.get(readHandle(handle).filename);
    if (offset + data.length > entry.content.length) {
      const grown = Buffer.alloc(offset + data.length);
      entry.content.copy(grown);
      entry.content = grown;
    }
    data.copy(entry.content, offset);
    sftp.status(reqid, STATUS_CODE.OK);
  });

  sftp.on('READ', (reqid, handle, offset, length) => {
    const entry = files.get(readHandle(handle).filename);
    if (offset >= entry.content.length) return sftp.status(reqid, STATUS_CODE.EOF);
    sftp.data(reqid, entry.content.subarray(offset, offset + length));
  });

  sftp.on('FSTAT', (reqid, handle) => sftp.attrs(reqid, attrsFor(files.get(readHandle(handle).filename))));
  sftp.on('FSETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK));

  for (const event of ['STAT', 'LSTAT']) {
    sftp.on(event, (reqid, path) => {
      const entry = files.get(path);
      return entry ? sftp.attrs(reqid, attrsFor(entry)) : sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
    });
  }

  sftp.on('SETSTAT', (reqid, path, attrs) => {
    const entry = files.get(path);
    if (!entry) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
    if (attrs.mode !== undefined) entry.mode = attrs.mode & 0o777;
    sftp.status(reqid, STATUS_CODE.OK);
  });

  sftp.on('OPENDIR', (reqid, path) => {
    const entry = files.get(path);
    if (!entry?.directory) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
    sftp.handle(reqid, openHandle({ filename: path, listed: false }));
  });

  sftp.on('READDIR', (reqid, handle) => {
    const state = readHandle(handle);
    if (state.listed) return sftp.status(reqid, STATUS_CODE.EOF);
    state.listed = true;
    const prefix = state.filename.endsWith('/') ? state.filename : `${state.filename}/`;
    const names = [...files.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map(([path, entry]) => ({
        filename: path.slice(prefix.length),
        longname: path.slice(prefix.length),
        attrs: attrsFor(entry),
      }));
    sftp.name(reqid, names);
  });

  sftp.on('MKDIR', (reqid, path) => {
    files.set(path, { content: Buffer.alloc(0), directory: true });
    sftp.status(reqid, STATUS_CODE.OK);
  });

  sftp.on('CLOSE', (reqid, handle) => {
    handles.delete(handle.readUInt32BE(0));
    sftp.status(reqid, STATUS_CODE.OK);
  });
}

/**
 * @param {object} options
 * @param {(command: string, stream: object) => Promise<{stdout?: string, stderr?: string, code?: number}|null>} options.onExec
 *   Return null to leave the channel open (used to test timeouts).
 * @param {Record<string, string|{directory: true}>} options.files Initial SFTP contents, keyed by absolute path.
 */
export async function startFakeVm({ onExec = async () => ({ code: 0 }), files = {} } = {}) {
  const hostKey = utils.generateKeyPairSync('ed25519');
  const contents = new Map(
    Object.entries(files).map(([path, value]) => [
      path,
      typeof value === 'string'
        ? { content: Buffer.from(value, 'utf8'), directory: false }
        : { content: Buffer.alloc(0), directory: true },
    ]),
  );

  const server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    client.on('authentication', (ctx) => ctx.accept());
    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        const session = acceptSession();
        session.on('exec', async (acceptExec, rejectExec, info) => {
          const stream = acceptExec();
          const result = await onExec(info.command, stream);
          if (!result) return; // leave it hanging on purpose
          if (result.stdout) stream.write(result.stdout);
          if (result.stderr) stream.stderr.write(result.stderr);
          stream.exit(result.code ?? 0);
          stream.end();
        });
        session.on('sftp', (acceptSftp) => serveSftp(acceptSftp(), contents));
      });
    });
    client.on('error', () => {});
  });

  const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

  return {
    port,
    files: contents,
    read: (path) => contents.get(path)?.content.toString('utf8'),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
