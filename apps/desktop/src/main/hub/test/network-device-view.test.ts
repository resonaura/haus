/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { normalizeHome } from '@haus/ha/view/normalize';
import { describeAccessory } from '@haus/ha/view/presentation';
import type { Snapshot } from '@haus/ha/view/types';
import { buildView } from '../entities';
import { buildHubManifests } from '../flow-entries';
import { parseDevices } from '../types';

describe('Generic network device desktop projection', () => {
  it('exposes generic_network in built-in Hub integration manifests', () => {
    expect(buildHubManifests()).toContainEqual({
      domain: 'generic_network',
      name: 'Generic Network Device',
    });
  });

  it('projects deviceType, managementUrl, category, and subtitle from Hub device payloads', () => {
    const devices = parseDevices({
      devices: [
        {
          id: 'net:entry_net_switch1',
          name: 'Office Switch',
          category: 'network',
          deviceType: 'network_switch',
          availability: 'online',
          manufacturer: 'Generic',
          model: 'Switch',
          connectivity: { protocol: 'local_ip', address: '192.168.4.2' },
          source: { instanceId: 'entry_net_switch1', externalId: 'http://192.168.4.2/' },
          opaqueMetadata: {
            managementUrl: 'http://192.168.4.2/',
            presentation: {
              deviceType: 'network_switch',
              managementUrl: 'http://192.168.4.2/',
            },
          },
          endpoints: [
            {
              id: 'binary_sensor.entry_net_switch1_status',
              name: 'Status',
              capabilities: [
                {
                  id: 'connectivity',
                  kind: 'binary',
                  operations: [],
                  deviceClass: 'connectivity',
                  name: 'Status',
                },
              ],
            },
          ],
        },
      ],
    });

    const onlineView = buildView(devices, {
      'binary_sensor.entry_net_switch1_status': {
        connectivity: true,
        state: 'on',
        ip: '192.168.4.2',
        url: 'http://192.168.4.2/',
      },
    });
    const onlineModel = normalizeHome({
      states: onlineView.states,
      devices: onlineView.devices as Snapshot['devices'],
      entities: onlineView.entities as Snapshot['entities'],
      areas: [],
      services: {},
      config: { location_name: 'Home' },
      user: { name: 'Admin', is_admin: true },
    });

    expect(onlineModel.accessories).toHaveLength(1);
    const acc = onlineModel.accessories[0]!;
    expect(acc.category).toBe('network');
    expect(acc.deviceType).toBe('network_switch');
    expect(acc.managementUrl).toBe('http://192.168.4.2/');
    expect(describeAccessory(acc)).toBe('Connected · 192.168.4.2');

    const offlineView = buildView(devices, {
      'binary_sensor.entry_net_switch1_status': {
        connectivity: false,
        state: 'off',
        ip: '192.168.4.2',
        url: 'http://192.168.4.2/',
      },
    });
    const offlineModel = normalizeHome({
      states: offlineView.states,
      devices: offlineView.devices as Snapshot['devices'],
      entities: offlineView.entities as Snapshot['entities'],
      areas: [],
      services: {},
      config: { location_name: 'Home' },
      user: { name: 'Admin', is_admin: true },
    });
    expect(describeAccessory(offlineModel.accessories[0]!)).toBe('Offline · 192.168.4.2');
  });
});
