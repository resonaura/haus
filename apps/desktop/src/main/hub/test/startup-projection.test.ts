/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { cachedHomeSnapshot } from '@haus/ha/view/cached-home';
import { normalizeHome } from '@haus/ha/view/normalize';
import type { Snapshot } from '@haus/ha/view/types';
import { buildView } from '../entities';
import { parseDevices, type CompatView } from '../types';
import { CoalescedHubRefresh } from '../management/hub-live-state';
import { handleHubRegistryRpc } from '../management/hub-registry';

describe('Hub startup atomicity, multi-light projection, and offline Tuya camera retention', () => {
  it('coalesces concurrent registry queries behind initial refresh so devices/entities are never empty on startup', async () => {
    let loaded = false;
    let fetches = 0;
    let view: CompatView = {
      states: [],
      devices: [],
      entities: [],
      areas: [],
      bindings: new Map(),
    };

    const refresher = new CoalescedHubRefresh(async () => {
      fetches += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      view = {
        ...view,
        devices: [{ id: 'dev-1', name: 'Narnia Lamp', area_id: 'narnia' }],
        entities: [{ entity_id: 'light.narnia', device_id: 'dev-1', platform: 'haus' }],
        areas: [{ area_id: 'narnia', name: 'Narnia' }],
      };
      loaded = true;
    });

    const ctx = {
      api: async () => ({}),
      refresh: () => refresher.run(true),
      ensureLoaded: () => refresher.ensureLoaded(() => loaded),
      getView: () => view,
      recordCache: () => undefined,
      emitRegistryUpdated: () => undefined,
    };

    const [, devicesRes, entitiesRes, areasRes] = await Promise.all([
      refresher.run(true),
      handleHubRegistryRpc({ type: 'config/device_registry/list' }, ctx),
      handleHubRegistryRpc({ type: 'config/entity_registry/list' }, ctx),
      handleHubRegistryRpc({ type: 'config/area_registry/list' }, ctx),
    ]);

    expect(fetches).toBe(1);
    expect(devicesRes.handled && devicesRes.result).toHaveLength(1);
    expect(entitiesRes.handled && entitiesRes.result).toHaveLength(1);
    expect(areasRes.handled && areasRes.result).toHaveLength(1);
  });

  it('rejects partial cached home snapshots that contain states with empty devices & entities', () => {
    const poisoned = {
      config: { location_name: 'Haus' },
      services: {},
      user: { name: 'Andrii', is_admin: true },
      areas: [],
      devices: [],
      entities: [],
      states: [
        {
          entity_id: 'sensor.raw_diagnostic',
          state: '42',
          attributes: {},
          last_changed: '',
        },
      ],
    };
    expect(cachedHomeSnapshot(poisoned)).toBeUndefined();
  });

  it('exposes multi-light devices as independent light tiles while keeping segments grouped and retaining offline Tuya cameras with authExpired', () => {
    const devices = parseDevices({
      devices: [
        {
          id: 'ha:dual_ceiling',
          name: 'Living Room Ceiling',
          category: 'lighting',
          roomId: 'living_room',
          availability: 'online',
          connectivity: { protocol: 'local_ip' },
          opaqueMetadata: {
            presentation: {
              independentLightEndpoints: ['ep_main', 'ep_ambient'],
            },
          },
          endpoints: [
            {
              id: 'ep_main',
              name: 'Main',
              capabilities: [
                { id: 'on_off', kind: 'binary', operations: ['set'] },
                { id: 'brightness', kind: 'numeric', operations: ['set'] },
              ],
            },
            {
              id: 'ep_ambient',
              name: 'Ambient',
              capabilities: [
                { id: 'on_off', kind: 'binary', operations: ['set'] },
                { id: 'color', kind: 'complex', operations: ['set'] },
              ],
            },
          ],
        },
        {
          id: 'native-cam-narnia',
          name: 'Narnia Camera',
          category: 'cameras',
          roomId: 'narnia',
          availability: 'offline',
          connectivity: { protocol: 'local_ip' },
          diagnostics: {
            provider: 'tuya',
            bridgeId: '75399349-a61d-4104-841d-0280196deb09',
            authExpired: true,
          },
          endpoints: [
            {
              id: 'native-ep-1',
              name: '',
              mediaId: 'camera.narnia_camera',
              availability: 'offline',
              capabilities: [{ id: 'video', kind: 'complex', operations: [] }],
            },
          ],
        },
        {
          id: 'tuya:eba0193b64396cb4fbyqwf',
          name: 'Narnia Camera',
          category: 'cameras',
          availability: 'online',
          connectivity: { protocol: 'local_ip' },
          endpoints: [
            {
              id: 'ep_tuya_eba0193b64396cb4fbyqwf_camera',
              name: 'Narnia Camera',
              capabilities: [{ id: 'video', kind: 'camera', operations: ['stream'] }],
            },
          ],
        },
      ],
    });

    const view = buildView(devices, {
      ep_main: { power: true, brightness: 200 },
      ep_ambient: { power: false },
    });

    // Tuya cloud camera stub is suppressed; real offline Tuya bridge camera is preserved with authExpired
    const cameraStates = view.states.filter((s) => s.entity_id.startsWith('camera.'));
    expect(cameraStates).toHaveLength(1);
    expect(cameraStates[0]).toMatchObject({
      entity_id: 'camera.narnia_camera',
      state: 'unavailable',
      attributes: expect.objectContaining({
        haus_native_camera: 1,
        haus_bridge_provider: 'tuya',
        haus_bridge_id: '75399349-a61d-4104-841d-0280196deb09',
        haus_auth_expired: true,
      }),
    });

    const model = normalizeHome({
      config: { location_name: 'Haus' },
      services: { light: { turn_on: {}, turn_off: {} } },
      user: { name: 'Andrii', is_admin: true },
      states: view.states as Snapshot['states'],
      devices: view.devices as Snapshot['devices'],
      entities: view.entities as Snapshot['entities'],
      areas: view.areas as Snapshot['areas'],
    });

    // Real offline Narnia Camera survives normalizeHome (no longer dropped!)
    expect(model.cameras.map((c) => c.entity_id)).toEqual(['camera.narnia_camera']);

    // Dual-light device produces 2 independent light accessories with distinct names
    const lights = model.accessories.filter((a) => a.category === 'lights');
    expect(lights.map((l) => l.name)).toEqual([
      'Living Room Ceiling Main',
      'Living Room Ceiling Ambient',
    ]);
  });
});
