/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { expect, it, vi } from 'vitest';
import {
  openMobileHubHome,
  type MobileHubFetch,
  type MobileHubSessionPort,
} from '../src/home/hub-home';
import { createMobileDashboardProjection } from '../src/home/mobile-dashboard';

it('projects mobile Hub device toggles in 0ms, preserves optimistic state across polls, and rolls back failures', async () => {
  let lampOn = false;
  const pendingCommands: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
  }> = [];

  const mockFetch: MobileHubFetch = async (url, init) => {
    const json = (payload: unknown, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    });
    if (url.endsWith('/api/auth/identity')) {
      return json({ hub: { name: 'Mobile Hub', homeName: 'Mobile Home' } });
    }
    if (url.endsWith('/api/rooms')) {
      return json({ rooms: [{ id: 'bedroom', name: 'Bedroom' }] });
    }
    if (url.endsWith('/api/scenes')) {
      return json({ scenes: [{ id: 'sleep', name: 'Sleep', roomId: 'bedroom' }] });
    }
    if (url.endsWith('/api/preferences')) {
      return json({ value: {} });
    }
    if (url.endsWith('/api/devices')) {
      return json({
        devices: [
          {
            id: 'bed-lamp',
            name: 'Bedside Lamp',
            category: 'lighting',
            roomId: 'bedroom',
            availability: 'online',
            endpoints: [
              {
                id: 'bed_lamp_ep',
                name: 'Bedside Lamp',
                capabilities: [{ id: 'on_off' }],
              },
            ],
          },
        ],
      });
    }
    if (url.endsWith('/api/states')) {
      return json({ states: { bed_lamp_ep: { on: lampOn } } });
    }
    if (url.includes('/api/devices/bed-lamp/command') && init?.method === 'POST') {
      const body = JSON.parse(init.body ?? '{}') as { command?: string };
      await new Promise<void>((resolve, reject) => {
        pendingCommands.push({ resolve, reject });
      });
      lampOn = body.command === 'turn_on';
      return json({ state: { on: lampOn } });
    }
    return json({}, 404);
  };

  const manager: MobileHubSessionPort = {
    bearer: () => ({ url: 'http://192.168.1.50:8790', token: 'mob-token' }),
    getSession: () => ({
      sessionId: 'sess-mobile-1',
      hubUrl: 'http://192.168.1.50:8790',
      hubId: 'hub-1',
      homeId: 'home-1',
      clientId: 'mobile-1',
      clientName: 'Haus Mobile',
      clientRole: 'admin',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      state: 'active',
    }),
    reconnect: async () => true,
    logout: async () => {},
  };

  const project = createMobileDashboardProjection();
  const runtime = await openMobileHubHome(manager, 'Mobile Home', {
    fetchFn: mockFetch,
    pollIntervalMs: 0,
  });

  try {
    const initialSections = project(runtime.store.getState().snapshot);
    const bedroomRow = initialSections.find((s) => s.key === 'bedroom')?.data[0];
    expect(bedroomRow).toMatchObject({
      name: 'Bedside Lamp',
      state: 'Off',
      available: true,
    });
    expect(bedroomRow?.quickActions).toEqual([
      { domain: 'light', service: 'turn_on', target: { entity_id: 'light.bed_lamp_ep' } },
    ]);

    const actions = bedroomRow?.quickActions ?? [];
    const cmd = runtime.store.getState().executeBatch(actions);
    const optimisticRow = project(runtime.store.getState().snapshot).find(
      (s) => s.key === 'bedroom',
    )?.data[0];
    expect(optimisticRow).toMatchObject({
      name: 'Bedside Lamp',
      state: 'On',
      active: true,
      pending: true,
    });
    expect(runtime.store.getState().confirmedSnapshot()?.states[0]?.state).toBe('off');

    await runtime.reconnect();
    const duringPollRow = project(runtime.store.getState().snapshot).find(
      (s) => s.key === 'bedroom',
    )?.data[0];
    expect(duringPollRow?.state).toBe('On');
    expect(duringPollRow?.pending).toBe(true);

    await vi.waitFor(() => expect(pendingCommands.length).toBe(1));
    pendingCommands.shift()?.resolve();
    await cmd;
    const confirmedRow = project(runtime.store.getState().snapshot).find((s) => s.key === 'bedroom')
      ?.data[0];
    expect(confirmedRow).toMatchObject({
      state: 'On',
      active: true,
    });
    expect(confirmedRow?.pending).toBeUndefined();

    const offCmd = runtime.store.getState().executeBatch(confirmedRow?.quickActions ?? []);
    expect(
      project(runtime.store.getState().snapshot).find((s) => s.key === 'bedroom')?.data[0]?.state,
    ).toBe('Off');
    const rejection = expect(offCmd).rejects.toMatchObject({ code: 'connection-failed' });
    await vi.waitFor(() => expect(pendingCommands.length).toBe(1));
    pendingCommands.shift()?.reject(new Error('HTTP 502'));
    await rejection;
    expect(
      project(runtime.store.getState().snapshot).find((s) => s.key === 'bedroom')?.data[0]?.state,
    ).toBe('On');
  } finally {
    runtime.dispose();
  }
});
