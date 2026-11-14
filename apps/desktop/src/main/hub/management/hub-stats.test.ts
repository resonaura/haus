/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it, vi } from 'vitest';
import { handleHubRegistryRpc } from './hub-registry';
import type { CompatView, HubDevice } from '../types';

function makeDevice(): HubDevice {
  return {
    id: 'dev-light',
    name: 'Desk Lamp',
    roomId: 'office',
    category: 'lighting',
    availability: 'online',
    endpoints: [
      {
        id: 'ep-light',
        name: 'Light',
        capabilities: [
          {
            id: 'on_off',
            kind: 'binary',
            operations: ['read', 'turn_on', 'turn_off'],
            supportedColorModes: ['brightness'],
          },
          { id: 'power', kind: 'numeric', operations: ['read'], unit: 'W', deviceClass: 'power' },
        ],
      },
    ],
  };
}

function makeView(): CompatView {
  const device = makeDevice();
  return {
    states: [
      {
        entity_id: 'light.desk_lamp',
        state: 'on',
        attributes: { friendly_name: 'Desk Lamp', brightness: 128 },
        last_changed: '',
        last_updated: '',
      },
      {
        entity_id: 'sensor.desk_lamp_power',
        state: '18.5',
        attributes: {
          friendly_name: 'Desk Lamp Power',
          unit_of_measurement: 'W',
          device_class: 'power',
        },
        last_changed: '',
        last_updated: '',
      },
    ],
    areas: [{ area_id: 'office', name: 'Office' }],
    devices: [
      {
        id: device.id,
        name: device.name,
        area_id: 'office',
        name_by_user: null,
        disabled_by: null,
      },
    ],
    entities: [
      { entity_id: 'light.desk_lamp', device_id: 'dev-light', area_id: null },
      { entity_id: 'sensor.desk_lamp_power', device_id: 'dev-light', area_id: null },
    ],
    bindings: new Map([
      [
        'light.desk_lamp',
        {
          deviceId: 'dev-light',
          endpointId: 'ep-light',
          capability: device.endpoints[0].capabilities[0],
          domain: 'light',
        },
      ],
      [
        'sensor.desk_lamp_power',
        {
          deviceId: 'dev-light',
          endpointId: 'ep-light',
          capability: device.endpoints[0].capabilities[1],
          domain: 'sensor',
        },
      ],
    ]),
  };
}

describe('hub-stats compatibility handlers', () => {
  it('maps recorder/list_statistic_ids to compat entities and preserves system stats', async () => {
    const api = vi.fn(async (path: string) => {
      expect(path).toBe('/api/stats/meta');
      return [
        {
          statisticId: 'device.ep-light.power',
          source: 'device',
          unit: 'W',
          displayName: 'Raw Power',
          hasMean: true,
          hasSum: true,
        },
        {
          statisticId: 'system.cpu',
          source: 'system',
          unit: '%',
          displayName: 'Host CPU',
          hasMean: true,
          hasSum: false,
        },
      ];
    });

    const res = await handleHubRegistryRpc(
      { type: 'recorder/list_statistic_ids' },
      {
        api,
        refresh: async () => undefined,
        getView: makeView,
        getDevices: () => [makeDevice()],
        recordCache: () => undefined,
        emitRegistryUpdated: () => undefined,
      },
    );

    expect(res).toEqual({
      handled: true,
      result: [
        {
          statistic_id: 'sensor.desk_lamp_power',
          source: 'recorder',
          name: 'Desk Lamp Power',
          unit_of_measurement: 'W',
          mean_type: 1,
          has_mean: true,
          has_sum: true,
        },
        {
          statistic_id: 'system.cpu',
          source: 'system',
          name: 'Host CPU',
          unit_of_measurement: '%',
          mean_type: 1,
          has_mean: true,
          has_sum: false,
        },
      ],
    });
  });

  it('queries recorder/statistics_during_period with millisecond starts and raw fallback', async () => {
    const calls: string[] = [];
    const api = vi.fn(async (path: string) => {
      calls.push(path);
      if (path.includes('statistic_id=device.ep-light.power') && path.includes('resolution=auto')) {
        return { metadata: { hasSum: true }, data: [] };
      }
      if (path.includes('statistic_id=device.ep-light.power') && path.includes('resolution=raw')) {
        return {
          metadata: { hasSum: true },
          data: [
            { timestamp: 1700000010, value: 18.5, min: 18.0, max: 19.2 },
            { timestamp: 1700000020, value: 21.0 },
          ],
        };
      }
      if (path.includes('statistic_id=system.cpu')) {
        return {
          metadata: { hasSum: false },
          data: [{ timestamp: 1700000015, value: 42 }],
        };
      }
      return { data: [] };
    });

    const res = await handleHubRegistryRpc(
      {
        type: 'recorder/statistics_during_period',
        start_time: '2023-11-14T22:13:20.000Z',
        end_time: '2023-11-14T22:15:00.000Z',
        period: 'hour',
        statistic_ids: ['sensor.desk_lamp_power', 'system.cpu'],
      },
      {
        api,
        refresh: async () => undefined,
        getView: makeView,
        recordCache: () => undefined,
        emitRegistryUpdated: () => undefined,
      },
    );

    expect(calls.some((url) => url.includes('resolution=raw'))).toBe(true);
    expect(res).toEqual({
      handled: true,
      result: {
        'sensor.desk_lamp_power': [
          { start: 1700000010000, mean: 18.5, min: 18.0, max: 19.2, state: 18.5, sum: 18.5 },
          { start: 1700000020000, mean: 21.0, min: 21.0, max: 21.0, state: 21.0, sum: 21.0 },
        ],
        'system.cpu': [{ start: 1700000015000, mean: 42, min: 42, max: 42, state: 42 }],
      },
    });
  });

  it('projects history/history_during_period via stateFor with significant_changes_only filtering', async () => {
    const api = vi.fn(async (path: string) => {
      expect(path).toContain('/api/history?endpoint_ids=ep-light');
      return {
        history: {
          'ep-light': [
            { tsMs: 1700000000000, state: { on_off: false, brightness: 0 } },
            { tsMs: 1700000005000, state: { on_off: false, brightness: 0 } },
            { tsMs: 1700000010000, state: { on_off: true, brightness: 200 } },
          ],
        },
      };
    });

    const filtered = await handleHubRegistryRpc(
      {
        type: 'history/history_during_period',
        entity_ids: ['light.desk_lamp'],
        start_time: '2023-11-14T22:13:00.000Z',
        end_time: '2023-11-14T22:14:00.000Z',
        significant_changes_only: true,
      },
      {
        api,
        refresh: async () => undefined,
        getView: makeView,
        getDevices: () => [makeDevice()],
        recordCache: () => undefined,
        emitRegistryUpdated: () => undefined,
      },
    );

    expect(filtered).toEqual({
      handled: true,
      result: {
        'light.desk_lamp': [
          expect.objectContaining({ s: 'off', lu: 1700000000, lc: 1700000000 }),
          expect.objectContaining({
            s: 'on',
            lu: 1700000010,
            lc: 1700000010,
            a: expect.objectContaining({ brightness: 200 }),
          }),
        ],
      },
    });
  });
});
