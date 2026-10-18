import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeAssistantConnection } from './connection';
import type { SecureStore } from './secure-store';
import type { NativeEvent } from '../shared/native';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('main-process Home Assistant transport', () => {
  it('sends management forms to the configured server with private authentication and surfaces server validation errors', async () => {
    const received: Array<{ url?: string; authorization?: string; body: string }> = [];
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        if (request.url === '/auth/token') {
          response
            .writeHead(200, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ access_token: 'private-management', expires_in: 1800 }));
          return;
        }
        received.push({ url: request.url, authorization: request.headers.authorization, body });
        if (request.url?.endsWith('/logs')) {
          response.writeHead(200, { 'Content-Type': 'text/plain' }).end('Live server log');
          return;
        }
        response
          .writeHead(request.method === 'POST' ? 200 : 400, { 'Content-Type': 'application/json' })
          .end(
            JSON.stringify(
              request.method === 'POST'
                ? { type: 'form', flow_id: 'flow123', errors: { host: 'cannot_connect' } }
                : { message: 'Setup no longer exists' },
            ),
          );
      });
    });
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    const store = {
      loadSession: async () => ({
        url: `http://127.0.0.1:${address.port}`,
        name: 'Test',
        clientId: 'http://127.0.0.1/',
        refreshToken: 'private-refresh',
      }),
    } as unknown as SecureStore;
    const connection = new HomeAssistantConnection(
      store,
      () => {},
      async () => {},
    );
    cleanup.push(() => connection.dispose());
    const result = await connection.management({
      method: 'POST',
      path: 'config/config_entries/flow/flow123',
      data: { host: 'local-device', password: 'form-secret' },
    });
    expect(result).toMatchObject({ type: 'form', errors: { host: 'cannot_connect' } });
    expect(JSON.stringify(result)).not.toContain('private-management');
    expect(received[0]).toEqual({
      url: '/api/config/config_entries/flow/flow123',
      authorization: 'Bearer private-management',
      body: JSON.stringify({ host: 'local-device', password: 'form-secret' }),
    });
    expect(
      await connection.management({ method: 'GET', path: 'hassio/addons/core_example/logs' }),
    ).toBe('Live server log');
    await expect(
      connection.management({ method: 'GET', path: 'config/config_entries/flow/expired' }),
    ).rejects.toThrow('Setup no longer exists');
    await expect(connection.management({ method: 'POST', path: '//other.test' })).rejects.toThrow();
    expect(received).toHaveLength(3);
  });
  it('refreshes a restored session, correlates commands, forwards events, and keeps tokens out of renderer events', async () => {
    const received: Record<string, unknown>[] = [];
    const eventContext = { id: 'context-id', parent_id: null, user_id: 'test-user' };
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ access_token: 'private-access', expires_in: 1800 }));
    });
    const websocket = new WebSocketServer({ server, path: '/api/websocket' });
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          for (const client of websocket.clients) client.terminate();
          websocket.close();
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    );
    websocket.on('connection', (socket) => {
      socket.send(JSON.stringify({ type: 'auth_required' }));
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as Record<string, unknown>;
        received.push(message);
        if (message.type === 'auth') {
          socket.send(JSON.stringify({ type: 'auth_ok' }));
          return;
        }
        socket.send(
          JSON.stringify({
            type: 'result',
            id: message.id,
            success: true,
            result:
              message.type === 'get_states'
                ? [{ entity_id: 'light.desk', state: 'on', attributes: {} }]
                : message.type === 'supervisor/api' &&
                    message.endpoint === '/addons/core_example/info'
                  ? {
                      name: 'Example',
                      state: 'started',
                      ingress: true,
                      ingress_url: '/api/hassio_ingress/example-path',
                    }
                  : message.type === 'supervisor/api' && message.endpoint === '/ingress/session'
                    ? { session: 'private-ingress-cookie' }
                    : null,
          }),
        );
        if (message.type === 'subscribe_events' && message.event_type === 'state_changed') {
          socket.send(
            JSON.stringify({
              type: 'event',
              id: message.id,
              event: {
                event_type: 'state_changed',
                data: { entity_id: 'light.desk' },
                context: eventContext,
              },
            }),
          );
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture port.');
    const url = `http://127.0.0.1:${address.port}`;
    const store = {
      loadSession: vi.fn(async () => ({
        url,
        name: 'Test Home',
        refreshToken: 'private-refresh',
        clientId: 'http://127.0.0.1:43210/',
      })),
      clearSession: vi.fn(async () => undefined),
    } as unknown as SecureStore;
    const events: NativeEvent[] = [];
    const connection = new HomeAssistantConnection(
      store,
      (event) => events.push(event),
      async () => undefined,
    );
    cleanup.push(() => connection.dispose());
    expect(await connection.getSession()).toEqual({ url, name: 'Test Home' });
    expect(await connection.request({ type: 'get_states' })).toEqual([
      { entity_id: 'light.desk', state: 'on', attributes: {} },
    ]);
    await vi.waitFor(() =>
      expect(
        events.some(
          (event) => event.type === 'ha-event' && event.event.event_type === 'state_changed',
        ),
      ).toBe(true),
    );
    expect(
      events.find(
        (event) => event.type === 'ha-event' && event.event.event_type === 'state_changed',
      ),
    ).toMatchObject({ event: { context: eventContext } });
    expect(received.find((message) => message.type === 'auth')?.access_token).toBe(
      'private-access',
    );
    expect(JSON.stringify(events)).not.toContain('private-access');
    expect(JSON.stringify(events)).not.toContain('private-refresh');
    expect(await connection.addonSurface('core_example')).toEqual({
      url: `${url}/api/hassio_ingress/example-path/`,
      title: 'Example',
      cookie: 'private-ingress-cookie',
    });
    expect(JSON.stringify(events)).not.toContain('private-ingress-cookie');
    const ids = received
      .filter((message) => typeof message.id === 'number')
      .map((message) => message.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
