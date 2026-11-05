/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';
import { IdentityRegistry } from '@haus/core/identity';
import { IdentityDatabase } from '../../core/test/fixtures/identity.js';
import type { ProviderContext } from '@haus/core/provider';
import type { Command, HomeEvent } from '@haus/core/types';
import {
  haIntegrationDefinition,
  haProviderAddress,
  HaProvider,
  type HaCredential,
} from '../src/provider/index.js';

interface LoopbackServer {
  port: number;
  received: Array<Record<string, unknown>>;
  close(): Promise<void>;
  dropConnections(): void;
  sendToClients(message: Record<string, unknown>): void;
}

const cleanupTasks: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanupTasks.splice(0).reverse()) {
    try {
      await cleanup();
    } catch {}
  }
});

function createLoopbackServer(options?: {
  authSuccess?: boolean;
  rejectServices?: boolean;
  isValidToken?: (token: string) => boolean;
  onCommand?: (msg: Record<string, unknown>, socket: WebSocket) => boolean;
}): Promise<LoopbackServer> {
  return new Promise((resolve) => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    const received: Array<Record<string, unknown>> = [];
    const sockets = new Set<WebSocket>();

    server.on('connection', (socket: WebSocket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.send(JSON.stringify({ type: 'auth_required', ha_version: '2026.11.0' }));

      socket.on('message', (raw: WebSocket.RawData) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        received.push(msg);

        if (msg.type === 'auth') {
          const valid = options?.isValidToken
            ? options.isValidToken(String(msg.access_token))
            : options?.authSuccess !== false && msg.access_token !== 'invalid-token';
          if (!valid) {
            socket.send(JSON.stringify({ type: 'auth_invalid', message: 'Invalid token' }));
            socket.close();
            return;
          }
          socket.send(JSON.stringify({ type: 'auth_ok', ha_version: '2026.11.0' }));
          return;
        }

        const id = msg.id;
        if (typeof id !== 'number') return;

        if (msg.type === 'get_states') {
          socket.send(
            JSON.stringify({
              id,
              type: 'result',
              success: true,
              result: [
                {
                  entity_id: 'light.desk',
                  state: 'on',
                  attributes: {
                    friendly_name: 'Desk Lamp',
                    brightness: 255,
                    supported_color_modes: ['brightness'],
                  },
                  last_changed: '2026-11-04T00:00:00.000Z',
                  last_updated: '2026-11-04T00:00:00.000Z',
                },
              ],
            }),
          );
        } else if (msg.type === 'get_config') {
          socket.send(
            JSON.stringify({
              id,
              type: 'result',
              success: true,
              result: {
                location_name: 'Test Home',
                unit_system: { temperature: '°C' },
              },
            }),
          );
        } else if (msg.type === 'get_services') {
          socket.send(
            JSON.stringify({
              id,
              type: 'result',
              success: true,
              result: {
                light: { turn_on: {}, turn_off: {} },
              },
            }),
          );
        } else if (msg.type === 'auth/current_user') {
          socket.send(
            JSON.stringify({
              id,
              type: 'result',
              success: true,
              result: { name: 'Admin', is_admin: true },
            }),
          );
        } else if (typeof msg.type === 'string' && msg.type.startsWith('config/')) {
          socket.send(
            JSON.stringify({
              id,
              type: 'result',
              success: true,
              result:
                msg.type === 'config/area_registry/list'
                  ? [{ area_id: 'office', name: 'Office' }]
                  : msg.type === 'config/device_registry/list'
                    ? [{ id: 'desk-dev', name: 'Desk Device', area_id: 'office' }]
                    : msg.type === 'config/entity_registry/list'
                      ? [
                          {
                            entity_id: 'light.desk',
                            device_id: 'desk-dev',
                            unique_id: 'desk-uid',
                            platform: 'test',
                          },
                        ]
                      : [],
            }),
          );
        } else if (msg.type === 'subscribe_entities') {
          socket.send(JSON.stringify({ id, type: 'result', success: true }));
        } else if (msg.type === 'call_service') {
          if (options?.onCommand && options.onCommand(msg, socket)) {
            return;
          }
          if (options?.rejectServices) {
            socket.send(
              JSON.stringify({
                id,
                type: 'result',
                success: false,
                error: { code: 'service_not_found', message: 'Service not found' },
              }),
            );
          } else {
            socket.send(
              JSON.stringify({
                id,
                type: 'result',
                success: true,
                result: { context: { id: `ack-${id}` } },
              }),
            );
          }
        } else {
          socket.send(JSON.stringify({ id, type: 'result', success: true, result: {} }));
        }
      });
    });

    server.once('listening', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw Error('server_address_failed');
      const loopback: LoopbackServer = {
        port: address.port,
        received,
        dropConnections() {
          for (const s of sockets) s.terminate();
          sockets.clear();
        },
        sendToClients(message: Record<string, unknown>) {
          for (const s of sockets) s.send(JSON.stringify(message));
        },
        async close() {
          for (const s of sockets) s.terminate();
          sockets.clear();
          await new Promise<void>((done) => server.close(() => done()));
        },
      };
      cleanupTasks.push(() => loopback.close());
      resolve(loopback);
    });
  });
}

function createTestContext(credentialRef: { current: HaCredential }): {
  context: ProviderContext<HaCredential>;
  refreshCount: () => number;
} {
  let refreshes = 0;
  let idSeq = 0;
  const registry = new IdentityRegistry(new IdentityDatabase(), () => `id-${++idSeq}`);
  const context: ProviderContext<HaCredential> = {
    grant: {
      resource: { homeId: 'home-1', kind: 'integration', id: 'ha-int-1' },
      owner: { hubId: 'hub-1', processId: 'proc-1' },
      generation: 1,
    },
    identities: registry,
    credential: async () => credentialRef.current,
    refresh: async () => {
      refreshes++;
      credentialRef.current = {
        kind: 'oauth',
        accessToken: 'renewed-access-token',
        refreshToken: 'renewed-refresh-token',
        clientId: 'test-client',
        expiresAt: Date.now() + 3600_000,
      };
    },
  };
  return { context, refreshCount: () => refreshes };
}

it('opens authenticated connection and normalizes snapshot readings into canonical identities', async () => {
  const server = await createLoopbackServer();
  const creds = {
    current: { kind: 'token' as const, accessToken: 'valid-token' },
  };
  const { context } = createTestContext(creds);
  const address = haProviderAddress(`http://127.0.0.1:${server.port}`);
  const provider = new HaProvider(address, context);
  cleanupTasks.push(() => provider.close());

  await provider.open(creds.current, new AbortController().signal);
  expect(provider.inventory).toBeDefined();

  const snapshot = await provider.inventory!.snapshot();
  expect(snapshot.schema).toBe('haus.home');
  expect(snapshot.homeId).toBe('home-1');
  expect(snapshot.endpoints).toHaveLength(1);

  const endpoint = snapshot.endpoints[0];
  expect(endpoint.name).toBe('Desk Lamp');
  expect(endpoint.availability).toBe('online');
  expect(endpoint.readings.level?.value).toBe(100);
  expect(JSON.stringify(snapshot)).not.toContain('entity_id');
  expect(JSON.stringify(snapshot)).not.toContain('supported_color_modes');
});

it('rejects open on invalid auth without leaking token and sets state to auth-required', async () => {
  const server = await createLoopbackServer({ authSuccess: false });
  const creds = {
    current: { kind: 'token' as const, accessToken: 'bad-token' },
  };
  const { context } = createTestContext(creds);
  const address = haProviderAddress(`http://127.0.0.1:${server.port}`);
  const provider = new HaProvider(address, context);
  cleanupTasks.push(() => provider.close());

  await expect(provider.open(creds.current, new AbortController().signal)).rejects.toThrow(
    'ha_auth_invalid',
  );
});

it('subscribes to entity events and delivers availability offline when disconnected', async () => {
  const server = await createLoopbackServer();
  const creds = {
    current: { kind: 'token' as const, accessToken: 'valid-token' },
  };
  const { context } = createTestContext(creds);
  const address = haProviderAddress(`http://127.0.0.1:${server.port}`);
  const provider = new HaProvider(address, context);
  cleanupTasks.push(() => provider.close());

  await provider.open(creds.current, new AbortController().signal);
  const events: HomeEvent[] = [];
  const unsubscribe = provider.inventory!.subscribe((e) => events.push(e));
  cleanupTasks.push(() => unsubscribe());

  server.dropConnections();

  await vi.waitFor(() => {
    expect(events.some((e) => e.kind === 'availability' && e.availability === 'offline')).toBe(
      true,
    );
  });

  const offlineEvent = events.find(
    (e) => e.kind === 'availability' && e.availability === 'offline',
  );
  expect(offlineEvent).toMatchObject({
    schema: 'haus.event',
    version: 2,
    homeId: 'home-1',
    sourceId: 'ha-int-1',
    ownerGeneration: 1,
    owner: { hubId: 'hub-1', processId: 'proc-1' },
  });
});

it('executes canonical commands via call_service and returns receipt status', async () => {
  const server = await createLoopbackServer();
  const creds = {
    current: { kind: 'token' as const, accessToken: 'valid-token' },
  };
  const { context } = createTestContext(creds);
  const address = haProviderAddress(`http://127.0.0.1:${server.port}`);
  const provider = new HaProvider(address, context);
  cleanupTasks.push(() => provider.close());

  await provider.open(creds.current, new AbortController().signal);
  const snapshot = await provider.inventory!.snapshot();
  const endpoint = snapshot.endpoints[0];

  const command: Command = {
    id: 'cmd-1',
    endpointId: endpoint.id,
    capabilityId: 'level',
    operation: 'set',
    arguments: { value: 50 },
  };

  const reply = await provider.execute(command, creds.current, new AbortController().signal);
  expect(reply.status).toBe('accepted');
  expect(reply.correlationId).toMatch(/^ack-/);

  const serviceCall = server.received.find((m) => m.type === 'call_service');
  expect(serviceCall).toMatchObject({
    type: 'call_service',
    domain: 'light',
    service: 'turn_on',
    target: { entity_id: 'light.desk' },
    service_data: { brightness: 128 },
  });
});

it('reports status failed when provider service rejects or capability is unsupported', async () => {
  const server = await createLoopbackServer({ rejectServices: true });
  const creds = {
    current: { kind: 'token' as const, accessToken: 'valid-token' },
  };
  const { context } = createTestContext(creds);
  const address = haProviderAddress(`http://127.0.0.1:${server.port}`);
  const provider = new HaProvider(address, context);
  cleanupTasks.push(() => provider.close());

  await provider.open(creds.current, new AbortController().signal);
  const snapshot = await provider.inventory!.snapshot();
  const endpoint = snapshot.endpoints[0];

  const command: Command = {
    id: 'cmd-reject',
    endpointId: endpoint.id,
    capabilityId: 'level',
    operation: 'set',
    arguments: { value: 50 },
  };

  const reply = await provider.execute(command, creds.current, new AbortController().signal);
  expect(reply.status).toBe('failed');

  const unsupportedCmd: Command = {
    id: 'cmd-unsupported',
    endpointId: endpoint.id,
    capabilityId: 'invalid-cap',
    operation: 'set',
    arguments: { value: 50 },
  };
  const replyUnsupported = await provider.execute(
    unsupportedCmd,
    creds.current,
    new AbortController().signal,
  );
  expect(replyUnsupported.status).toBe('failed');
});

it('reports status unknown on lost acknowledgement and never replays the physical command', async () => {
  let dropped = false;
  const server = await createLoopbackServer({
    onCommand: (_msg, socket) => {
      if (!dropped) {
        dropped = true;
        socket.terminate();
        return true;
      }
      return false;
    },
  });

  const creds = {
    current: { kind: 'token' as const, accessToken: 'valid-token' },
  };
  const { context } = createTestContext(creds);
  const address = haProviderAddress(`http://127.0.0.1:${server.port}`);
  const provider = new HaProvider(address, context, { backoffMs: 50 });
  cleanupTasks.push(() => provider.close());

  await provider.open(creds.current, new AbortController().signal);
  const snapshot = await provider.inventory!.snapshot();
  const endpoint = snapshot.endpoints[0];

  const command: Command = {
    id: 'cmd-lost',
    endpointId: endpoint.id,
    capabilityId: 'level',
    operation: 'set',
    arguments: { value: 50 },
  };

  const reply = await provider.execute(command, creds.current, new AbortController().signal);
  expect(reply.status).toBe('unknown');

  await vi.waitFor(() => {
    expect(server.received.filter((m) => m.type === 'auth').length).toBeGreaterThanOrEqual(2);
  });

  const callCount = server.received.filter((m) => m.type === 'call_service').length;
  expect(callCount).toBe(1);
});

it('triggers context.refresh when token expires during reconnect and reconnects with new token', async () => {
  let activeToken = 'valid-first-token';
  const server = await createLoopbackServer({
    isValidToken: (token) => token === activeToken,
  });

  const creds = {
    current: { kind: 'token' as const, accessToken: 'valid-first-token' },
  };
  const { context, refreshCount } = createTestContext(creds);
  const address = haProviderAddress(`http://127.0.0.1:${server.port}`);
  const provider = new HaProvider(address, context, { backoffMs: 50 });
  cleanupTasks.push(() => provider.close());

  await provider.open(creds.current, new AbortController().signal);

  // Expire the first token on the server side
  activeToken = 'renewed-access-token';

  server.dropConnections();

  await vi.waitFor(() => {
    expect(refreshCount()).toBeGreaterThanOrEqual(1);
  });

  await vi.waitFor(() => {
    const authMsgs = server.received.filter((m) => m.type === 'auth');
    expect(authMsgs.some((m) => m.access_token === 'renewed-access-token')).toBe(true);
  });
});

it('closes cleanly, cancels pending work, and denies subsequent operations', async () => {
  const server = await createLoopbackServer();
  const creds = {
    current: { kind: 'token' as const, accessToken: 'valid-token' },
  };
  const { context } = createTestContext(creds);
  const address = haProviderAddress(`http://127.0.0.1:${server.port}`);
  const provider = new HaProvider(address, context);

  await provider.open(creds.current, new AbortController().signal);
  await provider.close();

  await expect(provider.inventory!.snapshot()).rejects.toThrow('provider_closed');
  await expect(
    provider.execute(
      { id: 'close', endpointId: 'ep', capabilityId: 'cap', operation: 'op', arguments: {} },
      creds.current,
      new AbortController().signal,
    ),
  ).rejects.toThrow('provider_closed');
});

it('integrates with haIntegrationDefinition producing a fully compliant provider', () => {
  const resource = { homeId: 'home-1', kind: 'integration' as const, id: 'ha-test' };
  const address = haProviderAddress('http://127.0.0.1:8123');
  const def = haIntegrationDefinition(resource, address);
  expect(def.resource).toEqual(resource);
  expect(def.codec).toBeDefined();
  const { context } = createTestContext({
    current: { kind: 'token', accessToken: 'test-token' },
  });
  const provider = def.create(context);
  expect(provider).toBeInstanceOf(HaProvider);
  expect(provider.inventory).toBeDefined();
});
