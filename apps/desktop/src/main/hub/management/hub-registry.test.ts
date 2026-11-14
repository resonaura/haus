/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildCompatAreas, handleHubRegistryCommand } from './hub-registry';
import { HubConnection } from '../connection';
import type { CompatView, HubDevice, HubRoom } from '../types';

function makeDevice(overrides: Partial<HubDevice> = {}): HubDevice {
  return {
    id: 'dev-1',
    name: 'Living Light',
    roomId: 'living',
    category: 'lighting',
    availability: 'available',
    endpoints: [
      {
        id: 'ep-1',
        name: 'Light',
        capabilities: [
          { id: 'on_off', kind: 'binary', operations: ['read', 'turn_on', 'turn_off'] },
        ],
      },
    ],
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('buildCompatAreas', () => {
  it('includes empty persisted rooms and falls back cleanly for device-only rooms without duplicating', () => {
    const rooms: HubRoom[] = [
      { id: 'spalnya', name: 'Спальня', icon: 'bed' },
      { id: 'unassigned', name: 'Unassigned' },
    ];
    const devices = [
      makeDevice({ id: 'dev-a', roomId: 'spalnya' }),
      makeDevice({ id: 'dev-b', roomId: 'kitchen_area' }),
      makeDevice({ id: 'dev-c', roomId: 'unassigned' }),
    ];

    expect(buildCompatAreas(devices, rooms)).toEqual([
      { area_id: 'spalnya', name: 'Спальня', icon: 'bed' },
      { area_id: 'kitchen_area', name: 'Kitchen area' },
    ]);
  });
});

describe('handleHubRegistryCommand', () => {
  it('routes area create/update/delete, device update, ignores entity area clear, and translates errors', async () => {
    let view: CompatView = {
      states: [],
      areas: [{ area_id: 'living', name: 'Living room' }],
      devices: [makeDevice()].map((d) => ({
        id: d.id,
        name: d.name,
        area_id: 'living',
        name_by_user: null,
        disabled_by: null,
      })),
      entities: [{ entity_id: 'light.living_light', device_id: 'dev-1', area_id: null }],
      bindings: new Map(),
    };

    const api = vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
      if (path === '/api/rooms' && init?.method === 'POST') {
        return { room: { id: 'office', name: 'Office', icon: 'briefcase' } };
      }
      if (path === '/api/rooms/office' && init?.method === 'PATCH') {
        return { room: { id: 'office', name: 'Study', icon: null } };
      }
      if (path === '/api/rooms/office' && init?.method === 'DELETE') {
        return { deleted: true };
      }
      if (path === '/api/devices/dev-1' && init?.method === 'PATCH') {
        return { device: { id: 'dev-1' } };
      }
      throw new Error('Hub request /api/rooms failed (409: room_name_exists).');
    });
    const refresh = vi.fn(async () => undefined);
    const recordCache = vi.fn();
    const emitRegistryUpdated = vi.fn();
    const ctx = {
      api,
      refresh,
      getView: () => view,
      recordCache,
      emitRegistryUpdated,
    };

    await expect(
      handleHubRegistryCommand(
        { type: 'config/area_registry/create', name: 'Office', icon: 'briefcase' },
        ctx,
      ),
    ).resolves.toEqual({ area_id: 'office', name: 'Office', icon: 'briefcase' });
    expect(api).toHaveBeenCalledWith('/api/rooms', {
      method: 'POST',
      body: { name: 'Office', icon: 'briefcase' },
    });
    expect(emitRegistryUpdated).toHaveBeenCalledWith('area_registry_updated');

    await expect(
      handleHubRegistryCommand(
        { type: 'config/area_registry/update', area_id: 'office', name: 'Study', icon: null },
        ctx,
      ),
    ).resolves.toEqual({ area_id: 'office', name: 'Study' });

    await expect(
      handleHubRegistryCommand({ type: 'config/area_registry/delete', area_id: 'office' }, ctx),
    ).resolves.toEqual({ deleted: true });
    expect(emitRegistryUpdated).toHaveBeenCalledWith('device_registry_updated');

    await handleHubRegistryCommand(
      {
        type: 'config/device_registry/update',
        device_id: 'dev-1',
        area_id: null,
        name_by_user: 'Desk Lamp',
      },
      ctx,
    );
    expect(api).toHaveBeenCalledWith('/api/devices/dev-1', {
      method: 'PATCH',
      body: { roomId: null, name: 'Desk Lamp' },
    });

    // Clearing entity area_id (planDeviceMoves override cleanup) should not wipe the device room on Hub.
    api.mockClear();
    await handleHubRegistryCommand(
      { type: 'config/entity_registry/update', entity_id: 'light.living_light', area_id: null },
      ctx,
    );
    expect(api).not.toHaveBeenCalled();

    // Error code translation for duplicate room names.
    api.mockRejectedValueOnce(new Error('Hub request /api/rooms failed (409: room_name_exists).'));
    await expect(
      handleHubRegistryCommand({ type: 'config/area_registry/create', name: 'Living room' }, ctx),
    ).rejects.toThrow('A room with this name already exists.');
  });
});

describe('HubConnection room synchronization', () => {
  const active: HubConnection[] = [];

  afterEach(() => {
    for (const conn of active.splice(0)) conn.disconnect();
  });

  it('loads persisted empty rooms via /api/rooms and refreshes areas on config/area_registry/create', async () => {
    const rooms: HubRoom[] = [{ id: 'balcony', name: 'Балкон' }];
    const devices: HubDevice[] = [makeDevice({ id: 'dev-1', roomId: 'unassigned' })];
    const events: unknown[] = [];

    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const path = new URL(url).pathname;
      if (path === '/api/auth/resume') {
        return json({
          status: 'active',
          session: {
            sessionId: 's-1',
            hubId: 'h-1',
            homeId: 'home-1',
            clientId: 'c-1',
            clientRole: 'admin',
            clientName: 'Desktop',
            issuedAt: Date.now() - 1000,
            expiresAt: Date.now() + 60_000,
            state: 'active',
          },
        });
      }
      if (path === '/api/auth/identity')
        return json({ hub: { hubId: 'h-1', homeId: 'home-1', name: 'Haus' } });
      if (path === '/api/devices') return json({ devices });
      if (path === '/api/rooms' && (!init?.method || init.method === 'GET')) return json({ rooms });
      if (path === '/api/rooms' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { name: string };
        const created = { id: 'guest', name: body.name };
        rooms.push(created);
        return json({ room: created }, 201);
      }
      if (path === '/api/states') return json({ states: {} });
      if (path === '/api/commissioning/integrations') return json({ entries: [] });
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
      (event) => events.push(event),
      fetchFn,
    );
    active.push(conn);

    await conn.getSession();
    await conn.request({ type: 'get_states' });
    await expect(conn.request({ type: 'config/area_registry/list' })).resolves.toEqual([
      { area_id: 'balcony', name: 'Балкон' },
    ]);

    await expect(
      conn.request({ type: 'config/area_registry/create', name: 'Guest Room' }),
    ).resolves.toEqual({ area_id: 'guest', name: 'Guest Room' });

    await expect(conn.request({ type: 'config/area_registry/list' })).resolves.toEqual([
      { area_id: 'balcony', name: 'Балкон' },
      { area_id: 'guest', name: 'Guest Room' },
    ]);
    expect(events).toContainEqual({
      type: 'ha-event',
      event: { event_type: 'area_registry_updated', data: {} },
    });
  });
});
