import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { createLongLivedTokenAuth } from 'home-assistant-js-websocket';
import { openHaTransport } from '../src/ha-transport.js';
import type { HaTransport } from '../src/ha-client.js';
const close: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of close.splice(0).reverse()) await cleanup();
});

it('uses the real HA WebSocket protocol for auth, entity subscription and service acknowledgement', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  close.push(
    () =>
      new Promise<void>((resolve) => {
        server.clients.forEach((peer) => peer.terminate());
        server.close(() => resolve());
      }),
  );
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (typeof address !== 'object' || !address) throw new Error('test-server-address');
  const received: string[] = [];
  server.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'auth_required', ha_version: '2026.10.0' }));
    socket.on('message', (raw) => {
      const data = JSON.parse(String(raw)) as { id?: number; type: string; access_token?: string };
      received.push(data.type);
      if (data.type === 'auth') {
        expect(data.access_token).toBe('test-only-credential');
        socket.send(JSON.stringify({ type: 'auth_ok', ha_version: '2026.10.0' }));
      } else {
        socket.send(
          JSON.stringify({
            id: data.id,
            type: 'result',
            success: true,
            result: { context: { id: 'fixture-context' } },
          }),
        );
        if (data.type === 'subscribe_entities')
          socket.send(
            JSON.stringify({
              id: data.id,
              type: 'event',
              event: {
                a: {
                  'light.fixture': {
                    s: 'off',
                    a: { brightness: 80 },
                    c: 'fixture-context',
                    lc: 1_790_000_000,
                  },
                },
              },
            }),
          );
      }
    });
  });
  const transport = await openHaTransport(
    createLongLivedTokenAuth(`http://127.0.0.1:${address.port}`, 'test-only-credential'),
  );
  close.push(() => transport.close());
  const entities = vi.fn();
  const stop = transport.watchEntities(entities);
  close.push(stop);
  await vi.waitFor(() =>
    expect(entities).toHaveBeenCalledWith([
      expect.objectContaining({ entity_id: 'light.fixture', state: 'off' }),
    ]),
  );
  const response = await transport.request<{ context: { id: string } }>({
    type: 'call_service',
    domain: 'light',
    service: 'turn_off',
    target: { entity_id: 'light.fixture' },
  });
  expect(response.context.id).toBe('fixture-context');
  expect(received).toContain('subscribe_entities');
});

it('maps rejected auth to a safe error without leaking server text', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  close.push(
    () =>
      new Promise<void>((resolve) => {
        server.clients.forEach((peer) => peer.terminate());
        server.close(() => resolve());
      }),
  );
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (typeof address !== 'object' || !address) throw new Error('test-server-address');
  server.on('connection', (socket) =>
    socket.on('message', () =>
      socket.send(JSON.stringify({ type: 'auth_invalid', message: 'sensitive-server-details' })),
    ),
  );
  let transport: HaTransport | undefined;
  close.push(() => transport?.close());
  await expect(
    openHaTransport(
      createLongLivedTokenAuth(`http://127.0.0.1:${address.port}`, 'test-only-credential'),
    ).then((value) => {
      transport = value;
    }),
  ).rejects.toMatchObject({ code: 'auth-required', message: 'auth-required' });
});

it('bounds a missing acknowledgement and reconnects without replaying that service call', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  close.push(
    () =>
      new Promise<void>((resolve) => {
        server.clients.forEach((peer) => peer.terminate());
        server.close(() => resolve());
      }),
  );
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (typeof address !== 'object' || !address) throw new Error('test-server-address');
  let serviceCalls = 0;
  server.on('connection', (socket) =>
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as { type: string; id?: number };
      if (message.type === 'auth')
        socket.send(JSON.stringify({ type: 'auth_ok', ha_version: '2026.10.0' }));
      else if (message.type === 'call_service') ++serviceCalls;
      else
        socket.send(
          JSON.stringify({ type: 'result', id: message.id, success: true, result: null }),
        );
    }),
  );
  const transport = await openHaTransport(
    createLongLivedTokenAuth(`http://127.0.0.1:${address.port}`, 'test-only-credential'),
    40,
  );
  close.push(() => transport.close());
  await expect(
    transport.request({
      type: 'call_service',
      domain: 'light',
      service: 'turn_off',
      target: { entity_id: 'light.fixture' },
    }),
  ).rejects.toMatchObject({ code: 'timeout' });
  expect(serviceCalls).toBe(1);
});
