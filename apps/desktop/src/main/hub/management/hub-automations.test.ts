/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { HubConnection } from '../connection';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('hub-automations and scene/script/automation wiring', () => {
  const active: HubConnection[] = [];
  afterEach(() => {
    while (active.length) active.pop()?.dispose();
    vi.restoreAllMocks();
  });

  function createHubHarness() {
    const scenes = [
      {
        id: 'scene-night',
        name: 'Movie Night',
        icon: 'mdi:movie',
        roomId: 'living',
        members: [{ endpointId: 'ep-1', targetState: { on_off: true, brightness: 120 } }],
      },
    ];
    const scripts = [
      {
        id: 'script-bed',
        name: 'Bedtime',
        mode: 'single',
        steps: [
          {
            type: 'action',
            action: {
              kind: 'device_command',
              payload: { endpointId: 'ep-1', capability: 'on_off', command: 'turn_off' },
            },
          },
        ],
      },
    ];
    const automations = [
      {
        id: 'rule-evening',
        name: 'Evening Lamp',
        enabled: true,
        mode: 'single',
        triggers: [{ type: 'time', sun: 'sunset' }],
        conditions: [],
        actions: [
          {
            type: 'action',
            action: {
              kind: 'device_command',
              payload: { endpointId: 'ep-1', capability: 'on_off', command: 'turn_on' },
            },
          },
        ],
      },
    ];
    const calls: Array<{ path: string; method: string; body?: unknown }> = [];

    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
      if (path === '/api/auth/refresh') {
        return json({
          grant: {
            sessionId: 's-1',
            sessionToken: 'tok-1',
            refreshToken: 'ref-1',
            clientId: 'c-1',
            clientName: 'Desktop',
            clientRole: 'admin',
            issuedAt: Date.now() - 1000,
            expiresAt: Date.now() + 60_000,
            state: 'active',
          },
        });
      }
      if (path === '/api/auth/identity') {
        return json({ hub: { hubId: 'h-1', homeId: 'home-1', name: 'Haus' } });
      }
      if (path === '/api/devices') {
        return json({
          devices: [
            {
              id: 'dev-1',
              name: 'Floor Lamp',
              roomId: 'living',
              category: 'lighting',
              availability: 'online',
              endpoints: [
                {
                  id: 'ep-1',
                  name: 'Lamp',
                  capabilities: [
                    { id: 'on_off', kind: 'binary', operations: ['read', 'turn_on', 'turn_off'] },
                    { id: 'brightness', kind: 'numeric', operations: ['read', 'set'] },
                  ],
                },
              ],
            },
          ],
        });
      }
      if (path === '/api/rooms') return json({ rooms: [{ id: 'living', name: 'Living' }] });
      if (path === '/api/states')
        return json({ states: { 'ep-1': { on_off: false, brightness: 0 } } });
      if (path === '/api/commissioning/integrations') return json({ entries: [] });

      if (path === '/api/scenes' && method === 'GET') return json({ scenes });
      if (path === '/api/scenes' && method === 'POST') {
        calls.push({ path, method, body });
        const next = body as (typeof scenes)[number];
        const idx = scenes.findIndex((s) => s.id === next.id);
        if (idx >= 0) scenes[idx] = next;
        else scenes.push(next);
        return json({ scene: next }, 201);
      }
      if (path.startsWith('/api/scenes/') && path.endsWith('/activate')) {
        calls.push({ path, method, body });
        return json({ execution: { status: 'completed' } });
      }
      if (path.startsWith('/api/scenes/') && method === 'DELETE') {
        calls.push({ path, method });
        const id = decodeURIComponent(path.replace('/api/scenes/', ''));
        const idx = scenes.findIndex((s) => s.id === id);
        if (idx >= 0) scenes.splice(idx, 1);
        return json({ removed: true, id });
      }

      if (path === '/api/scripts' && method === 'GET') return json({ scripts });
      if (path.startsWith('/api/scripts/') && path.endsWith('/execute')) {
        calls.push({ path, method });
        return json({ execution: { status: 'completed' } });
      }

      if (path === '/api/automations' && method === 'GET') return json({ automations });
      if (path === '/api/automations' && method === 'POST') {
        calls.push({ path, method, body });
        const next = body as (typeof automations)[number];
        const idx = automations.findIndex((a) => a.id === next.id);
        if (idx >= 0) automations[idx] = next;
        else automations.push(next);
        return json({ automation: next }, 201);
      }
      if (path.startsWith('/api/automations/') && path.endsWith('/trigger')) {
        calls.push({ path, method });
        return json({ execution: { status: 'completed' } });
      }
      if (path.startsWith('/api/automations/') && method === 'DELETE') {
        calls.push({ path, method });
        const id = decodeURIComponent(path.replace('/api/automations/', ''));
        const idx = automations.findIndex((a) => a.id === id);
        if (idx >= 0) automations.splice(idx, 1);
        return json({ removed: true, id });
      }

      if (path === '/api/devices/dev-1/command' && method === 'POST') {
        calls.push({ path, method, body });
        return json({ status: 'accepted' });
      }
      return json({}, 404);
    });

    const conn = new HubConnection(
      {
        assertAvailable: () => undefined,
        loadHubSession: async () => ({
          hubUrl: 'http://127.0.0.1:8090',
          sessionId: 's-1',
          sessionToken: 'tok-1',
          refreshToken: 'ref-1',
          hubId: 'h-1',
          homeId: 'home-1',
          clientId: 'c-1',
          clientRole: 'admin',
          clientName: 'Desktop',
          expiresAt: Date.now() + 60_000,
        }),
        saveHubSession: async () => undefined,
        clearHubSession: async () => undefined,
        cameraSnapshots: { get: async () => null, put: async () => undefined },
      },
      () => undefined,
      fetchFn,
    );
    active.push(conn);
    return { conn, calls, scenes, automations };
  }

  it('projects scenes/scripts/automations into compat entities and exposes getSceneConfig & RPC configs', async () => {
    const { conn } = createHubHarness();
    await conn.getSession();
    const states = (await conn.request({ type: 'get_states' })) as Array<{
      entity_id: string;
      state: string;
      attributes: Record<string, unknown>;
    }>;

    const scene = states.find((s) => s.entity_id === 'scene.movie_night');
    const script = states.find((s) => s.entity_id === 'script.bedtime');
    const automation = states.find((s) => s.entity_id === 'automation.evening_lamp');

    expect(scene?.attributes.id).toBe('scene-night');
    expect(script?.attributes.id).toBe('script-bed');
    expect(automation?.state).toBe('on');

    const sceneCfg = await conn.getSceneConfig('scene.movie_night', 'scene-night');
    expect(sceneCfg).toEqual({
      id: 'scene-night',
      name: 'Movie Night',
      icon: 'mdi:movie',
      room_id: 'living',
      entities: { 'light.dev_1': { state: 'on', brightness: 120 } },
    });

    await expect(
      conn.request({ type: 'automation/config', entity_id: 'automation.evening_lamp' }),
    ).resolves.toMatchObject({
      config: {
        id: 'rule-evening',
        alias: 'Evening Lamp',
        initial_state: true,
        triggers: [{ trigger: 'sun', event: 'sunset' }],
      },
    });

    await expect(
      conn.request({ type: 'script/config', entity_id: 'script.bedtime' }),
    ).resolves.toMatchObject({
      config: { id: 'script-bed', alias: 'Bedtime' },
    });
  });

  it('supports ConfigEditor CRUD and executing scene.turn_on, scene.apply, script.turn_on, and automation.*', async () => {
    const { conn, calls } = createHubHarness();
    await conn.getSession();
    await conn.request({ type: 'get_states' });

    await conn.management({
      method: 'POST',
      path: 'config/scene/config/scene-reading',
      data: {
        name: 'Reading',
        icon: 'mdi:book',
        entities: { 'light.dev_1': { state: 'on', brightness: 220 } },
      },
    });
    expect(calls.at(-1)).toMatchObject({
      path: '/api/scenes',
      method: 'POST',
      body: {
        id: 'scene-reading',
        name: 'Reading',
        roomId: 'living',
        members: [{ endpointId: 'ep-1', targetState: { on_off: true, brightness: 220 } }],
      },
    });

    await conn.request({
      type: 'call_service',
      domain: 'scene',
      service: 'turn_on',
      target: { entity_id: 'scene.reading' },
    });
    expect(calls.at(-1)).toMatchObject({
      path: '/api/scenes/scene-reading/activate',
      method: 'POST',
    });

    await conn.request({
      type: 'call_service',
      domain: 'scene',
      service: 'apply',
      service_data: { entities: { 'light.dev_1': { state: 'on', brightness: 150 } } },
    });
    expect(calls.at(-1)).toMatchObject({
      path: '/api/devices/dev-1/command',
      method: 'POST',
      body: { endpointId: 'ep-1', command: 'turn_on', parameters: { brightness: 150 } },
    });

    await conn.request({
      type: 'call_service',
      domain: 'script',
      service: 'turn_on',
      target: { entity_id: 'script.bedtime' },
    });
    expect(calls.at(-1)).toMatchObject({ path: '/api/scripts/script-bed/execute', method: 'POST' });

    await conn.request({
      type: 'call_service',
      domain: 'automation',
      service: 'toggle',
      target: { entity_id: 'automation.evening_lamp' },
    });
    expect(calls.at(-1)).toMatchObject({
      path: '/api/automations',
      method: 'POST',
      body: { id: 'rule-evening', enabled: false },
    });

    await conn.request({
      type: 'call_service',
      domain: 'automation',
      service: 'trigger',
      target: { entity_id: 'automation.evening_lamp' },
    });
    expect(calls.at(-1)).toMatchObject({
      path: '/api/automations/rule-evening/trigger',
      method: 'POST',
    });

    await conn.management({
      method: 'POST',
      path: 'config/automation/config/rule-custom',
      data: {
        alias: 'Motion Light',
        initial_state: false,
        triggers: [{ trigger: 'state', entity_id: 'light.dev_1', to: 'on' }],
        actions: [{ action: 'light.turn_on', target: { entity_id: 'light.dev_1' } }],
      },
    });
    await expect(
      conn.management({ method: 'GET', path: 'config/automation/config/rule-custom' }),
    ).resolves.toMatchObject({ id: 'rule-custom', alias: 'Motion Light', initial_state: false });

    await conn.management({ method: 'DELETE', path: 'config/automation/config/rule-custom' });
    await conn.management({ method: 'DELETE', path: 'config/scene/config/scene-reading' });
    expect(calls.some((c) => c.path === '/api/scenes/scene-reading' && c.method === 'DELETE')).toBe(
      true,
    );
  });
});
