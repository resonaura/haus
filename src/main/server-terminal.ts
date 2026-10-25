import { Client, type ClientChannel } from 'ssh2';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import type { ServerSshInput, ServerTerminalEvent, ServerTerminalOpen } from '../shared/terminal';
import type { ServerSshStore } from './server-ssh-store';

const exec = promisify(execFile);
const dimensions = (cols: unknown, rows: unknown) => {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    Number(cols) < 2 ||
    Number(cols) > 500 ||
    Number(rows) < 1 ||
    Number(rows) > 300
  )
    throw Error('Invalid terminal dimensions.');
  return { cols: Number(cols), rows: Number(rows) };
};
const validate = (value: ServerSshInput) => {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.serverId !== 'string' ||
    !/^[\w:.-]{1,160}$/.test(value.serverId) ||
    typeof value.host !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9.:%-]{0,252}$/.test(value.host) ||
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535 ||
    typeof value.username !== 'string' ||
    !/^\S{1,128}$/.test(value.username) ||
    [...value.username].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    !['native', 'wsl'].includes(value.environment) ||
    !['password', 'agent'].includes(value.auth) ||
    (value.password !== undefined &&
      (typeof value.password !== 'string' || value.password.length > 4096))
  )
    throw Error('Check the SSH host, port and username.');
  return {
    serverId: value.serverId,
    host: value.host,
    port: value.port,
    username: value.username,
    environment: value.environment,
    auth: value.auth,
    password: value.password,
    rememberPassword: value.rememberPassword === true,
  } satisfies ServerSshInput;
};
async function knownHostKeys(host: string, port: number) {
  try {
    const { stdout } = await exec('ssh-keygen', ['-F', port === 22 ? host : `[${host}]:${port}`], {
      timeout: 1500,
      maxBuffer: 65536,
      windowsHide: true,
    });
    return stdout
      .split('\n')
      .filter((line) => line && !line.startsWith('#'))
      .flatMap((line) => {
        const fields = line.trim().split(/\s+/);
        // Revoked and certificate-authority entries are not direct host-key pins.
        if (fields[0].startsWith('@') || fields.length < 3) return [];
        const key = Buffer.from(fields[2], 'base64');
        return key.length ? [createHash('sha256').update(key).digest('hex')] : [];
      });
  } catch {
    return [];
  }
}
interface TerminalSession {
  client: Client;
  stream?: ClientChannel;
  outstanding: number;
  closed: boolean;
}
export class ServerTerminals {
  private sessions = new Map<string, TerminalSession>();
  private opening = new Map<string, { cancelled: boolean }>();
  private offeredKeys = new Map<string, string>();
  constructor(
    private readonly store: ServerSshStore,
    private readonly publish: (event: ServerTerminalEvent) => void,
  ) {}
  profile(id: unknown) {
    if (typeof id !== 'string' || id.length > 160) throw Error('Invalid server.');
    return this.store.profile(id);
  }
  async open(request: ServerTerminalOpen) {
    if (!request || !/^[\da-f-]{36}$/i.test(request.sessionId))
      throw Error('Invalid terminal session.');
    this.close(request.sessionId);
    if (this.sessions.size + this.opening.size >= 4)
      throw Error('Close another terminal before opening a new connection.');
    const operation = { cancelled: false };
    this.opening.set(request.sessionId, operation);
    try {
      await this.connect(request, operation);
    } finally {
      if (this.opening.get(request.sessionId) === operation) this.opening.delete(request.sessionId);
    }
  }
  private async connect(request: ServerTerminalOpen, operation: { cancelled: boolean }) {
    const profile = validate(request.profile),
      size = dimensions(request.cols, request.rows);
    const saved = (await this.store.load())[profile.serverId];
    const sameEndpoint = saved?.host === profile.host && saved?.port === profile.port;
    const password =
      profile.password ??
      (sameEndpoint && saved.username === profile.username ? saved.password : undefined);
    if (profile.auth === 'password' && !password) throw Error('Enter the SSH password.');
    if (profile.auth === 'agent' && !process.env.SSH_AUTH_SOCK)
      throw Error('No system SSH agent is available.');
    const offeredId = `${profile.serverId}\0${profile.host}\0${profile.port}`;
    const offered = this.offeredKeys.get(offeredId);
    if (request.trustFingerprint && request.trustFingerprint !== offered)
      throw Error('The SSH host key must be verified again.');
    const fingerprints =
      sameEndpoint && saved.fingerprints?.length
        ? saved.fingerprints
        : await knownHostKeys(profile.host, profile.port);
    if (operation.cancelled) return;
    const client = new Client();
    const state: TerminalSession = { client, outstanding: 0, closed: false };
    const id = request.sessionId;
    this.sessions.set(id, state);
    const closeCurrent = () => {
      if (this.sessions.get(id) === state) this.close(id);
    };
    let pendingKey = false;
    let verifiedHash: string | undefined;
    this.publish({ sessionId: id, type: 'status', state: 'connecting' });
    client.once('error', (error) => {
      if (!state.closed && !pendingKey)
        this.publish({
          sessionId: id,
          type: 'status',
          state: 'disconnected',
          message:
            error.level === 'client-authentication'
              ? 'SSH authentication failed. Check your credentials.'
              : 'The SSH connection was interrupted. Reconnect when the server is available.',
        });
      closeCurrent();
    });
    client.once('close', () => {
      if (!state.closed && !pendingKey)
        this.publish({ sessionId: id, type: 'status', state: 'disconnected' });
      closeCurrent();
    });
    client.once('ready', () => {
      if (state.closed) return;
      client.setNoDelay(true);
      if (verifiedHash)
        void this.store.save({ ...profile, password }, [verifiedHash]).catch(() => {});
      const onShell = (error: Error | undefined, channel: ClientChannel) => {
        if (state.closed) {
          channel?.close();
          return;
        }
        if (error) {
          this.publish({
            sessionId: id,
            type: 'status',
            state: 'disconnected',
            message: 'The SSH server could not open a terminal.',
          });
          closeCurrent();
          return;
        }
        state.stream = channel;
        const stdout = new StringDecoder('utf8'),
          stderr = new StringDecoder('utf8');
        const output = (decoder: StringDecoder) => (chunk: Buffer) => {
          if (state.closed) return;
          state.outstanding += chunk.length;
          this.publish({
            sessionId: id,
            type: 'data',
            data: decoder.write(chunk),
            bytes: chunk.length,
          });
          if (state.outstanding >= 256 * 1024) {
            channel.pause();
            channel.stderr.pause();
          }
        };
        channel.on('data', output(stdout));
        channel.stderr.on('data', output(stderr));
        channel.once('exit', (code: number | null) => {
          if (!state.closed) this.publish({ sessionId: id, type: 'exit', code });
        });
        channel.once('close', () => {
          if (state.closed) return;
          const rest = stdout.end() + stderr.end();
          if (rest) this.publish({ sessionId: id, type: 'data', data: rest, bytes: 0 });
          closeCurrent();
          if (this.sessions.get(id) === undefined)
            this.publish({ sessionId: id, type: 'status', state: 'disconnected' });
        });
        channel.once('error', closeCurrent);
        this.publish({ sessionId: id, type: 'status', state: 'connected' });
      };
      const pty = { term: 'xterm-256color', ...size };
      if (profile.environment === 'wsl') client.exec('wsl.exe --', { pty }, onShell);
      else client.shell(pty, onShell);
    });
    try {
      client.connect({
        host: profile.host,
        port: profile.port,
        username: profile.username,
        ...(profile.auth === 'agent' ? { agent: process.env.SSH_AUTH_SOCK } : { password }),
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        readyTimeout: 15000,
        hostHash: 'sha256',
        hostVerifier: (hash: string) => {
          const fingerprint = `SHA256:${Buffer.from(hash, 'hex').toString('base64').replace(/=+$/, '')}`;
          if (!fingerprints.includes(hash) && request.trustFingerprint !== fingerprint) {
            pendingKey = true;
            this.offeredKeys.set(offeredId, fingerprint);
            this.publish({
              sessionId: id,
              type: 'host-key',
              fingerprint,
              changed: fingerprints.length > 0,
            });
            return false;
          }
          verifiedHash = hash;
          return true;
        },
      });
    } catch {
      this.close(id);
      throw Error('Could not start the SSH connection.');
    }
  }
  async write(id: unknown, data: unknown) {
    if (typeof id !== 'string' || typeof data !== 'string' || Buffer.byteLength(data) > 65536)
      throw Error('Invalid terminal input.');
    const stream = this.sessions.get(id)?.stream;
    if (!stream || stream.destroyed) throw Error('The terminal is disconnected.');
    await new Promise<void>((resolve, reject) =>
      stream.write(data, (error) =>
        error ? reject(Error('Terminal input could not be delivered.')) : resolve(),
      ),
    );
  }
  resize(id: unknown, cols: unknown, rows: unknown) {
    const size = dimensions(cols, rows);
    if (typeof id !== 'string') throw Error('Invalid terminal session.');
    this.sessions.get(id)?.stream?.setWindow(size.rows, size.cols, 0, 0);
  }
  ack(id: unknown, bytes: unknown) {
    if (
      typeof id !== 'string' ||
      !Number.isSafeInteger(bytes) ||
      Number(bytes) < 0 ||
      Number(bytes) > 1024 * 1024
    )
      return;
    const state = this.sessions.get(id);
    if (!state) return;
    state.outstanding = Math.max(0, state.outstanding - Number(bytes));
    if (state.outstanding < 64 * 1024) {
      state.stream?.resume();
      state.stream?.stderr.resume();
    }
  }
  close(id: unknown) {
    if (typeof id !== 'string') return;
    const opening = this.opening.get(id);
    if (opening) {
      opening.cancelled = true;
      this.opening.delete(id);
    }
    const state = this.sessions.get(id);
    if (!state) return;
    state.closed = true;
    this.sessions.delete(id);
    state.stream?.close();
    state.client.end();
    setTimeout(() => state.client.destroy(), 1000).unref();
  }
  closeAll() {
    for (const id of [...this.sessions.keys(), ...this.opening.keys()]) this.close(id);
    this.offeredKeys.clear();
  }
}
