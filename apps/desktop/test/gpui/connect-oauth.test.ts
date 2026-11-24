/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { ClientSessionCredentials } from '@haus/core/auth';
import type { CachedCameraSnapshot, CredentialStore, StoredSession } from '@haus/ha/native-types';
import { GpuiHomeRuntime } from '../../src/gpui/home/runtime.js';
import type { HubSessionManagerDependencies } from '../../src/main/hub-session.js';

function createMemoryCombinedStore(): HubSessionManagerDependencies['store'] & CredentialStore {
  let hubSession: ClientSessionCredentials | null = null;
  let haSession: StoredSession | null = null;
  const snapshots = new Map<string, CachedCameraSnapshot>();
  return {
    assertAvailable() {},
    async loadHubSession() {
      return hubSession;
    },
    async saveHubSession(value) {
      hubSession = value;
    },
    async clearHubSession() {
      hubSession = null;
    },
    async loadSession() {
      return haSession;
    },
    async saveSession(value) {
      haSession = value;
    },
    async clearSession() {
      haSession = null;
    },
    async loadHomeCache() {
      return null;
    },
    async saveHomeCache() {},
    cameraSnapshots: {
      async get(home, id) {
        return snapshots.get(`${home}\0${id}`) ?? null;
      },
      put(home, id, value) {
        snapshots.set(`${home}\0${id}`, value);
      },
    },
  };
}

it('connects explicit Home Assistant via OAuth loopback callback, applies live state events, and clears session on disconnect', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/auth/token' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          access_token: 'ha-access-token',
          refresh_token: 'ha-refresh-token',
          expires_in: 1800,
          token_type: 'Bearer',
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server, path: '/api/websocket' });
  let liveSocket: import('ws').WebSocket | undefined;
  wss.on('connection', (socket) => {
    liveSocket = socket;
    socket.send(JSON.stringify({ type: 'auth_required', ha_version: '2026.1.0' }));
    socket.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { id?: number; type?: string };
      if (msg.type === 'auth') {
        socket.send(JSON.stringify({ type: 'auth_ok', ha_version: '2026.1.0' }));
        return;
      }
      const reply = (result: unknown) =>
        socket.send(JSON.stringify({ id: msg.id, type: 'result', success: true, result }));
      switch (msg.type) {
        case 'get_states':
          reply([
            {
              entity_id: 'light.study_lamp',
              state: 'off',
              attributes: { friendly_name: 'Study Lamp' },
            },
          ]);
          break;
        case 'get_config':
          reply({ location_name: 'Cedar Home', version: '2026.1.0' });
          break;
        case 'auth/current_user':
          reply({ name: 'Alex', is_admin: true });
          break;
        case 'get_services':
          reply({ light: { turn_on: {}, turn_off: {} } });
          break;
        case 'config/area_registry/list':
          reply([{ area_id: 'study', name: 'Study' }]);
          break;
        case 'config/device_registry/list':
          reply([]);
          break;
        case 'config/entity_registry/list':
          reply([{ entity_id: 'light.study_lamp', area_id: 'study' }]);
          break;
        case 'subscribe_events':
          reply(null);
          break;
        default:
          reply(null);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP port.');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const store = createMemoryCombinedStore();
  let launchedAuthUrl = '';
  const runtime = new GpuiHomeRuntime(
    store,
    undefined,
    (options) => ({
      promise: Promise.resolve([
        {
          id: 'ha-1',
          name: 'Cedar Home',
          url: baseUrl,
          host: '127.0.0.1',
          port: address.port,
          kind: options?.explicitHa ? 'home-assistant' : 'haus-hub',
        },
      ]),
      cancel() {},
    }),
    undefined,
    {
      openBrowser: async (authorizeUrl) => {
        launchedAuthUrl = authorizeUrl;
        const parsed = new URL(authorizeUrl);
        const redirect = parsed.searchParams.get('redirect_uri')!;
        const state = parsed.searchParams.get('state')!;
        const callbackUrl = new URL(redirect);
        callbackUrl.searchParams.set('code', 'oauth-code-123');
        callbackUrl.searchParams.set('state', state);
        const response = await fetch(callbackUrl);
        expect(response.status).toBe(200);
      },
    },
  );

  try {
    await runtime.start();
    await runtime.scan(true);
    expect(runtime.getSnapshot().servers[0]?.kind).toBe('home-assistant');

    await runtime.connect(baseUrl, undefined, true);
    expect(launchedAuthUrl).toContain(`${baseUrl}/auth/authorize`);
    const connected = runtime.getSnapshot();
    expect(connected.error).toBeNull();
    expect(connected.sessionKind).toBe('home-assistant');
    expect(connected.session?.name).toBe('Cedar Home');
    expect(connected.snapshot?.states[0]?.state).toBe('off');
    expect((await store.loadSession())?.refreshToken).toBe('ha-refresh-token');

    liveSocket?.send(
      JSON.stringify({
        type: 'event',
        event: {
          event_type: 'state_changed',
          data: {
            new_state: {
              entity_id: 'light.study_lamp',
              state: 'on',
              attributes: { friendly_name: 'Study Lamp' },
            },
          },
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(runtime.getSnapshot().snapshot?.states[0]?.state).toBe('on');

    await runtime.disconnect();
    expect(runtime.getSnapshot().session).toBeNull();
    expect(await store.loadSession()).toBeNull();
  } finally {
    runtime.dispose();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
