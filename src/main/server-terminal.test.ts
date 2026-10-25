import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Server, utils, type Connection, type ServerChannel } from 'ssh2';
import { afterEach, expect, it, vi } from 'vitest';
import { ServerTerminals } from './server-terminal';
import type { ServerSshStore } from './server-ssh-store';
import type { ServerSshInput, ServerTerminalEvent } from '../shared/terminal';

const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  type: 'pkcs1',
  format: 'pem',
});
const parsed = utils.parseKey(key);
if (parsed instanceof Error || Array.isArray(parsed)) throw Error('Invalid fixture key');
const hash = createHash('sha256').update(parsed.getPublicSSH()).digest('hex');
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
});
async function fixture({ knownHash = hash, password = 'fixture-pass' } = {}) {
  const events: ServerTerminalEvent[] = [],
    shells: ServerChannel[] = [],
    sizes: { cols: number; rows: number }[] = [];
  const clients = new Set<Connection>();
  const ssh = new Server({ hostKeys: [key] });
  let connections = 0;
  ssh.on('connection', (client) => {
    connections++;
    clients.add(client);
    client.on('error', () => {});
    client.on('close', () => clients.delete(client));
    client.on('authentication', (request) => {
      if (
        request.method === 'password' &&
        request.username === 'fixture' &&
        request.password === password
      )
        request.accept();
      else request.reject();
    });
    client.on('ready', () =>
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (accept, _reject, info) => {
          sizes.push({ cols: info.cols, rows: info.rows });
          accept?.();
        });
        session.on('window-change', (accept, _reject, info) => {
          sizes.push({ cols: info.cols, rows: info.rows });
          accept?.();
        });
        session.on('shell', (accept) => {
          const stream = accept();
          shells.push(stream);
          stream.on('data', (data: Buffer) => stream.write(data));
        });
      }),
    );
  });
  ssh.listen(0, '127.0.0.1');
  await once(ssh, 'listening');
  const port = (ssh.address() as { port: number }).port;
  const profile: ServerSshInput = {
    serverId: 'fixture',
    host: '127.0.0.1',
    port,
    username: 'fixture',
    auth: 'password',
    password,
    environment: 'native',
    rememberPassword: true,
  };
  const store = {
    load: vi.fn(async () => ({ fixture: { ...profile, fingerprints: [knownHash] } })),
    save: vi.fn(async () => {}),
  };
  const terminal = new ServerTerminals(store as unknown as ServerSshStore, (event) =>
    events.push(event),
  );
  cleanup.push(async () => {
    terminal.closeAll();
    for (const client of clients) client.end();
    await new Promise<void>((resolve) => ssh.close(() => resolve()));
  });
  return { terminal, events, sizes, profile, shells, store, connections: () => connections };
}
const connected = (events: ServerTerminalEvent[], id: string) =>
  events.some((e) => e.sessionId === id && e.type === 'status' && e.state === 'connected');
it('negotiates the initial PTY size, resizes the remote PTY and exchanges terminal data', async () => {
  const f = await fixture(),
    id = randomUUID();
  await f.terminal.open({ sessionId: id, profile: f.profile, cols: 137, rows: 43 });
  await vi.waitFor(() => expect(connected(f.events, id)).toBe(true));
  expect(f.sizes[0]).toEqual({ cols: 137, rows: 43 });
  f.terminal.resize(id, 93, 24);
  await vi.waitFor(() => expect(f.sizes.at(-1)).toEqual({ cols: 93, rows: 24 }));
  await f.terminal.write(id, 'hello λ\r');
  await vi.waitFor(() =>
    expect(
      f.events
        .filter((e) => e.type === 'data')
        .map((e) => e.data)
        .join(''),
    ).toContain('hello λ\r'),
  );
  expect(f.store.save).toHaveBeenCalledWith(expect.objectContaining({ password: 'fixture-pass' }), [
    hash,
  ]);
  f.terminal.close(id);
  await expect(f.terminal.write(id, 'must not replay')).rejects.toThrow('disconnected');
});
it('requires the exact offered host key and never saves credentials before authentication', async () => {
  const f = await fixture({ knownHash: '0'.repeat(64) }),
    id = randomUUID();
  await f.terminal.open({ sessionId: id, profile: f.profile, cols: 80, rows: 24 });
  await vi.waitFor(() => expect(f.events.some((e) => e.type === 'host-key')).toBe(true));
  expect(f.store.save).not.toHaveBeenCalled();
  await expect(
    f.terminal.open({
      sessionId: randomUUID(),
      profile: f.profile,
      cols: 80,
      rows: 24,
      trustFingerprint: 'forged',
    }),
  ).rejects.toThrow('verified again');
  const offered = f.events.find((e) => e.type === 'host-key');
  expect(offered?.type === 'host-key' && offered.changed).toBe(true);
  const next = randomUUID();
  await f.terminal.open({
    sessionId: next,
    profile: f.profile,
    cols: 80,
    rows: 24,
    trustFingerprint: offered?.type === 'host-key' ? offered.fingerprint : undefined,
  });
  await vi.waitFor(() => expect(connected(f.events, next)).toBe(true));
});
it('cancels an open waiting for secure storage without starting an orphan SSH connection', async () => {
  const f = await fixture();
  let release!: (value: Awaited<ReturnType<typeof f.store.load>>) => void;
  f.store.load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const id = randomUUID(),
    opening = f.terminal.open({ sessionId: id, profile: f.profile, cols: 80, rows: 24 });
  f.terminal.close(id);
  release({ fixture: { ...f.profile, fingerprints: [hash] } });
  await opening;
  expect(f.connections()).toBe(0);
});
it('a late close from a replaced connection cannot close the new session with the same ID', async () => {
  const f = await fixture(),
    id = randomUUID(),
    input = { sessionId: id, profile: f.profile, cols: 80, rows: 24 };
  await f.terminal.open(input);
  await vi.waitFor(() => expect(connected(f.events, id)).toBe(true));
  await f.terminal.open(input);
  // Server acceptance precedes delivery of CHANNEL_SUCCESS to the client.
  // Wait for client readiness rather than racing that TCP round trip on Linux.
  await vi.waitFor(() =>
    expect(
      f.events.filter((event) => event.type === 'status' && event.state === 'connected'),
    ).toHaveLength(2),
  );
  await f.terminal.write(id, 'replacement alive');
  await vi.waitFor(() =>
    expect(
      f.events
        .filter((e) => e.type === 'data')
        .map((e) => e.data)
        .join(''),
    ).toContain('replacement alive'),
  );
});
