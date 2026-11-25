/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { expect, it, vi } from 'vitest';
import type { ClientSessionCredentials } from '@haus/core/auth';
import { GpuiHomeRuntime } from '../../src/gpui/home/runtime.js';
import { homeDashboard } from '../../src/gpui/home/model.js';
import { createNestApp } from '../../../hub/src/nest.js';
import {
  STANDALONE_HOME_SERVICE,
  type StandaloneHomeService,
} from '../../../hub/src/home/home.service.js';
import {
  PREFERENCES_SERVICE,
  type IPreferencesService,
} from '../../../hub/src/preferences/preferences.controller.js';
import { attachMockDockerEnv } from '../../../hub/test/support/docker.js';

it('pairs, merges concurrent favorites, restores a rotated credential, and dispatches each fixture lamp command once', async () => {
  const docker = await attachMockDockerEnv();
  const app = await createNestApp({ dataDirectory: docker.dataDir });
  let saved: ClientSessionCredentials | null = null;
  const store = {
    assertAvailable() {},
    async loadHubSession() {
      return saved;
    },
    async saveHubSession(value: ClientSessionCredentials) {
      saved = value;
    },
    async clearHubSession() {
      saved = null;
    },
  };
  let acknowledgementLost = false;
  const preferenceWrites: number[] = [];
  let beforePreferenceWrite: (() => Promise<void>) | undefined;
  const transport: typeof fetch = async (input, init) => {
    const writesPreferences =
      String(input).endsWith('/api/preferences') && init?.method === 'PATCH';
    if (writesPreferences && beforePreferenceWrite) {
      const edit = beforePreferenceWrite;
      beforePreferenceWrite = undefined;
      await edit();
    }
    const response = await fetch(input, init);
    if (writesPreferences) preferenceWrites.push(response.status);
    if (acknowledgementLost && String(input).endsWith('/command')) {
      await response.body?.cancel();
      throw new TypeError('Fixture lost the acknowledgement after execution');
    }
    return response;
  };
  const first = new GpuiHomeRuntime(store, transport);
  const restored = new GpuiHomeRuntime(store, transport);
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const home = app.get<StandaloneHomeService>(STANDALONE_HOME_SERVICE);
    await home.roomManager.createRoom({ id: 'gpui-office', name: 'Fixture Office' });
    const lamps = [
      { id: 'fixture-lamp', name: 'Fixture Lamp' },
      { id: 'fixture-desk', name: 'Fixture Desk' },
    ];
    for (const { id, name } of lamps) {
      home.registerDevice({
        id,
        name,
        category: 'lighting',
        roomId: 'gpui-office',
        availability: 'online',
        source: { instanceId: 'fixture-gpui', externalId: id },
        connectivity: { protocol: 'virtual' },
        endpoints: [
          {
            id: `${id}-endpoint`,
            name,
            capabilities: [
              { id: 'on_off', kind: 'binary', readable: true, operations: ['turn_on', 'turn_off'] },
            ],
            readings: {},
          },
        ],
      });
    }
    const commands = vi.fn(async (endpoint: string, _capability: string, command: string) => {
      await home.updateEndpointState(endpoint, { state: command === 'turn_on' ? 'on' : 'off' });
    });
    home.registerCommandHandler('virtual', commands, { optimistic: false });
    for (const { id } of lamps) await home.updateEndpointState(`${id}-endpoint`, { state: 'off' });

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await first.start();
    expect(first.getSnapshot().session).toBeNull();
    await first.connect(url);
    const state = first.getSnapshot();
    expect(state.error).toBeNull();
    expect(state.offline).toBe(false);
    expect(state.session?.url).toBe(url);
    expect(state.snapshot).not.toBeNull();
    if (!state.snapshot) throw new Error('The fixture home was not loaded.');
    const devices = homeDashboard(state.snapshot, state.preferences).rooms.flatMap(
      (room) => room.devices,
    );
    const lamp = devices.find((device) => device.name === 'Fixture Lamp');
    const desk = devices.find((device) => device.name === 'Fixture Desk');
    expect(lamp?.id).toMatch(/^light\./);
    if (!lamp || !desk) throw new Error('The fixture lights were not visible.');
    expect(JSON.stringify(state)).not.toContain('sessionToken');

    expect(state.preferenceStatus).toBe('synced');
    expect(preferenceWrites).toEqual([]);
    const shared = app.get<IPreferencesService>(PREFERENCES_SERVICE);
    const otherFavorite = 'light.fixture-concurrent';
    beforePreferenceWrite = async () => {
      const current = await shared.get();
      const result = await shared.patch(current.revision, { favorites: [otherFavorite] });
      expect(result.conflict).toBeFalsy();
    };
    await first.setFavorite(lamp.id, true);
    expect(preferenceWrites).toEqual([409, 200]);
    expect(first.getSnapshot().preferenceStatus).toBe('synced');
    expect((await shared.get()).value.favorites).toEqual([otherFavorite, lamp.id]);

    const backgroundFavorite = 'light.fixture-background';
    const current = await shared.get();
    await shared.patch(current.revision, {
      favorites: [otherFavorite, lamp.id, backgroundFavorite],
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.waitFor(() =>
      expect(first.getSnapshot().preferences.favorites).toContain(backgroundFavorite),
    );
    expect(preferenceWrites).toEqual([409, 200]);
    await first.setFavorite(lamp.id, false);
    expect((await shared.get()).value.favorites).toEqual([otherFavorite, backgroundFavorite]);

    await first.controlDevice(lamp.id, 'toggle');
    expect(first.getSnapshot().error).toBeNull();
    expect(commands).toHaveBeenCalledTimes(1);
    expect(home.getEndpointState('fixture-lamp-endpoint').state).toBe('on');

    await first.controlDevice([lamp.id, desk.id, lamp.id], 'toggle');
    expect(commands.mock.calls.slice(1).map(([endpoint, , action]) => [endpoint, action])).toEqual([
      ['fixture-lamp-endpoint', 'turn_off'],
      ['fixture-desk-endpoint', 'turn_off'],
    ]);
    expect(home.getEndpointState('fixture-lamp-endpoint').state).toBe('off');
    expect(home.getEndpointState('fixture-desk-endpoint').state).toBe('off');

    acknowledgementLost = true;
    await first.controlDevice([lamp.id, desk.id], 'toggle');
    expect(commands).toHaveBeenCalledTimes(4);
    expect(first.getSnapshot().error).toMatch(/could not be confirmed/);
    expect(first.getSnapshot().offline).toBe(true);
    await first.toggleLight(lamp.id);
    expect(commands).toHaveBeenCalledTimes(4);
    expect(home.getEndpointState('fixture-lamp-endpoint').state).toBe('on');
    expect(home.getEndpointState('fixture-desk-endpoint').state).toBe('off');
    first.dispose();

    const previous = await store.loadHubSession();
    if (!previous) throw new Error('The fixture did not save a session.');
    await store.saveHubSession({ ...previous, expiresAt: Date.now() - 1 });
    await restored.start();
    expect(restored.getSnapshot().session?.url).toBe(url);
    expect(restored.getSnapshot().offline).toBe(false);
    expect(restored.getSnapshot().preferences.favorites).toEqual([
      otherFavorite,
      backgroundFavorite,
    ]);
    expect(preferenceWrites).toEqual([409, 200, 200]);
    expect((await store.loadHubSession())?.refreshToken).not.toBe(previous.refreshToken);
    const studio = await restored.registry.saveRoom('Fixture studio');
    await restored.registry.saveRoom('Fixture reading room', studio.area_id);
    expect(restored.getSnapshot().snapshot?.areas).toContainEqual(
      expect.objectContaining({ area_id: studio.area_id, name: 'Fixture reading room' }),
    );
    await restored.disconnect();
    expect(restored.getSnapshot().session).toBeNull();
    expect(await store.loadHubSession()).toBeNull();
  } finally {
    first.dispose();
    restored.dispose();
    vi.useRealTimers();
    await app.close();
    await docker.close();
  }
}, 30_000);

it('keeps runtime transport and system ports referentially stable across updates', () => {
  const runtime = new GpuiHomeRuntime({
    assertAvailable() {},
    async loadHubSession() {
      return null;
    },
    async saveHubSession() {},
    async clearHubSession() {},
  });
  try {
    const alertsBefore = runtime.alertsTransport;
    const managementBefore = runtime.managementPort;
    const systemBefore = runtime.systemPorts;
    runtime.cancelPairing();
    expect(runtime.alertsTransport).toBe(alertsBefore);
    expect(runtime.managementPort).toBe(managementBefore);
    expect(runtime.systemPorts).toBe(systemBefore);
  } finally {
    runtime.dispose();
  }
});
