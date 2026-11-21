/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientSessionCredentials } from '@haus/core/auth';
import type { NativeEvent } from '../../../shared/native';
import { HubConnection } from '../connection';
import { CoalescedHubRefresh } from './hub-live-state';

const hubUrl = 'http://127.0.0.1:8090';
const credentials: ClientSessionCredentials = {
  hubUrl,
  sessionId: 'session-id',
  sessionToken: 'private-session-token',
  refreshToken: 'private-refresh-token',
  hubId: 'hub-id',
  homeId: 'home-id',
  clientId: 'client-id',
  clientName: 'Test Desktop',
  clientRole: 'admin',
  expiresAt: Date.now() + 60_000,
};

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

const devicesPayload = {
  devices: [1, 2, 3, 4].map((idx) => ({
    id: `dev_light_${idx}`,
    name: `Lamp ${idx}`,
    category: 'light',
    availability: 'online',
    roomId: 'living',
    endpoints: [
      {
        id: `ep_light_${idx}`,
        name: `Lamp ${idx}`,
        capabilities: [
          { id: 'on_off', kind: 'on_off' },
          { id: 'brightness', kind: 'brightness' },
        ],
      },
    ],
  })),
};

const connections: HubConnection[] = [];
afterEach(() => {
  for (const conn of connections.splice(0)) conn.dispose();
});

describe('HubConnection instant live delta & parallel command dispatch', () => {
  it('applies pushed stateChanges in memory with zero HTTP fetches and refreshes on unknown endpoints', async () => {
    const events: NativeEvent[] = [];
    const fetchCalls: string[] = [];
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);
      if (url.endsWith('/api/auth/resume')) {
        return json({
          status: 'active',
          session: {
            sessionId: credentials.sessionId,
            hubId: credentials.hubId,
            homeId: credentials.homeId,
            clientId: credentials.clientId,
            clientRole: credentials.clientRole,
            clientName: credentials.clientName,
            issuedAt: Date.now() - 1000,
            expiresAt: credentials.expiresAt,
            state: 'active',
          },
        });
      }
      if (url.endsWith('/api/auth/identity')) {
        return json({
          hub: { hubId: credentials.hubId, homeId: credentials.homeId, name: 'Haus' },
        });
      }
      if (url.endsWith('/api/devices')) return json(devicesPayload);
      if (url.endsWith('/api/rooms')) return json({ rooms: [{ id: 'living', name: 'Living' }] });
      if (url.endsWith('/api/states')) {
        return json({
          states: {
            ep_light_1: { state: 'off', on_off: false, brightness: 0 },
          },
        });
      }
      if (url.endsWith('/api/commissioning/integrations')) return json({ entries: [] });
      if (url.endsWith('/api/scenes')) return json({ scenes: [] });
      if (url.endsWith('/api/scripts')) return json({ scripts: [] });
      if (url.endsWith('/api/automations')) return json({ automations: [] });
      return new Response('{}', { status: 404 });
    });

    const store = {
      assertAvailable: vi.fn(),
      loadHubSession: vi.fn(async () => credentials),
      saveHubSession: vi.fn(async () => undefined),
      clearHubSession: vi.fn(async () => undefined),
      cameraSnapshots: { get: vi.fn(async () => null), put: vi.fn() },
    };
    const conn = new HubConnection(store, (event) => events.push(event), fetchFn as typeof fetch);
    connections.push(conn);

    await conn.getSession();
    await conn.refresh(true);
    fetchCalls.length = 0;
    events.length = 0;

    // Push known endpoint delta -> immediate state_changed event with ZERO HTTP fetches!
    conn.applyLiveStateChanges({ ep_light_1: { state: 'on', on_off: true, brightness: 204 } });
    expect(fetchCalls).toHaveLength(0);
    const stateEvent = events.find(
      (e) => e.type === 'ha-event' && e.event.event_type === 'state_changed',
    );
    expect(stateEvent).toBeDefined();
    if (stateEvent?.type === 'ha-event') {
      expect((stateEvent.event.data.new_state as { state?: string })?.state).toBe('on');
    }

    // Unknown endpoint delta triggers a fallback refresh(true).
    conn.applyLiveStateChanges({ ep_brand_new: { state: 'on' } });
    await vi.waitFor(() =>
      expect(fetchCalls.some((url) => url.endsWith('/api/devices'))).toBe(true),
    );
  });

  it('dispatches multi-device call_service in parallel and applies receipt state without re-polling /api/states', async () => {
    const events: NativeEvent[] = [];
    let statePollsAfterLoad = 0;
    let inFlightCommands = 0;
    let peakParallelCommands = 0;

    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/auth/resume')) {
        return json({
          status: 'active',
          session: {
            sessionId: credentials.sessionId,
            hubId: credentials.hubId,
            homeId: credentials.homeId,
            clientId: credentials.clientId,
            clientRole: credentials.clientRole,
            clientName: credentials.clientName,
            issuedAt: Date.now() - 1000,
            expiresAt: credentials.expiresAt,
            state: 'active',
          },
        });
      }
      if (url.endsWith('/api/auth/identity')) {
        return json({
          hub: { hubId: credentials.hubId, homeId: credentials.homeId, name: 'Haus' },
        });
      }
      if (url.endsWith('/api/devices')) return json(devicesPayload);
      if (url.endsWith('/api/rooms')) return json({ rooms: [{ id: 'living', name: 'Living' }] });
      if (url.endsWith('/api/states')) {
        statePollsAfterLoad += 1;
        return json({
          states: Object.fromEntries(
            [1, 2, 3, 4].map((idx) => [`ep_light_${idx}`, { state: 'off', on_off: false }]),
          ),
        });
      }
      if (url.endsWith('/api/commissioning/integrations')) return json({ entries: [] });
      if (url.endsWith('/api/scenes')) return json({ scenes: [] });
      if (url.endsWith('/api/scripts')) return json({ scripts: [] });
      if (url.endsWith('/api/automations')) return json({ automations: [] });
      if (url.includes('/command')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { endpointId: string };
        inFlightCommands += 1;
        peakParallelCommands = Math.max(peakParallelCommands, inFlightCommands);
        await new Promise((resolve) => setTimeout(resolve, 40));
        inFlightCommands -= 1;
        return json({
          receiptId: 'rcpt-1',
          endpointId: body.endpointId,
          status: 'accepted',
          state: { state: 'on', on_off: true, brightness: 255 },
        });
      }
      return new Response('{}', { status: 404 });
    });

    const store = {
      assertAvailable: vi.fn(),
      loadHubSession: vi.fn(async () => credentials),
      saveHubSession: vi.fn(async () => undefined),
      clearHubSession: vi.fn(async () => undefined),
      cameraSnapshots: { get: vi.fn(async () => null), put: vi.fn() },
    };
    const conn = new HubConnection(store, (event) => events.push(event), fetchFn as typeof fetch);
    connections.push(conn);

    await conn.getSession();
    await conn.refresh(true);
    statePollsAfterLoad = 0;
    events.length = 0;

    const entityIds = conn.request
      ? (await conn.request<Array<{ entity_id: string }>>({ type: 'get_states' })).map(
          (s) => s.entity_id,
        )
      : [];
    statePollsAfterLoad = 0;
    events.length = 0;

    await conn.request({
      type: 'call_service',
      domain: 'light',
      service: 'turn_on',
      target: { entity_id: entityIds },
      service_data: { brightness: 255 },
    });

    expect(peakParallelCommands).toBeGreaterThanOrEqual(4);
    expect(statePollsAfterLoad).toBe(0);
    const stateEvents = events.filter(
      (e) => e.type === 'ha-event' && e.event.event_type === 'state_changed',
    );
    expect(stateEvents).toHaveLength(4);
  });

  it('coalesces concurrent refresh calls while preserving pending force=true', async () => {
    const runs: boolean[] = [];
    let releaseFirst!: () => void;
    const refresher = new CoalescedHubRefresh(async (force) => {
      runs.push(force);
      if (runs.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
    });

    const p1 = refresher.run(false);
    const p2 = refresher.run(false);
    const p3 = refresher.run(true);
    const p4 = refresher.run(false);
    releaseFirst();
    await Promise.all([p1, p2, p3, p4]);

    expect(runs).toEqual([false, true]);
  });
});
