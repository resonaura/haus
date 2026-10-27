import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { HelperLive } from './helper-live';
import type { NativeEvent } from '../shared/native';

it('keeps scoped invalidations independent of HA and never exposes ingress credentials or late home events', async () => {
  const server = createServer(),
    hub = new WebSocketServer({ noServer: true });
  const events: NativeEvent[] = [];
  server.on('upgrade', (req, socket, head) => {
    expect(req.url).toBe('/ingress/fixture/api/live');
    expect(req.headers.cookie).toBe('ingress_session=private-fixture');
    expect(req.headers['x-haus-client']).toBe('1');
    hub.handleUpgrade(req, socket, head, (socket) => hub.emit('connection', socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  let scope = 'http://home.fixture';
  const live = new HelperLive(
    async () => ({ url: `http://127.0.0.1:${port}/ingress/fixture/`, cookie: 'private-fixture' }),
    () => scope,
    (event) => events.push(event),
  );
  try {
    const connection = once(hub, 'connection');
    live.start();
    live.start();
    const [socket] = await connection;
    const message = {
      protocol: 1,
      instance: '11111111-1111-4111-8111-111111111111',
      sequence: 1,
      topic: 'home',
      revision: '0',
      connected: true,
    };
    socket.send(JSON.stringify(message));
    await expect.poll(() => live.connected).toBe(true);
    socket.send(JSON.stringify({ ...message, sequence: 2, connected: false }));
    await expect.poll(() => events.length).toBe(2);
    expect(events[1]).toMatchObject({
      type: 'helper-live',
      scope,
      online: true,
      haConnected: false,
    });
    expect(JSON.stringify(events)).not.toContain('private-fixture');
    scope = 'http://other.fixture';
    socket.send(JSON.stringify({ ...message, sequence: 3 }));
    live.stop();
    expect(live.connected).toBe(false);
    expect(events).toHaveLength(2);
  } finally {
    live.stop();
    for (const socket of hub.clients) socket.terminate();
    hub.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
