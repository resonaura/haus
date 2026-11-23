/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import type { HausDevice } from '@haus/core';
import {
  collectDeviceFirmwareUpdates,
  type DeviceFirmwareHomeView,
} from '../../../src/commissioning/updates/device-firmware.js';

function makeDevice(overrides: Partial<HausDevice>): HausDevice {
  return {
    id: 'ha:eero1:narnia',
    source: { instanceId: 'ha:eero1', externalId: 'narnia' },
    name: 'Narnia',
    category: 'network',
    availability: 'online',
    connectivity: { protocol: 'virtual' },
    endpoints: [],
    ...overrides,
  };
}

describe('collectDeviceFirmwareUpdates', () => {
  it('surfaces device update.* firmware entities with install/skip metadata', () => {
    const fakeHome: DeviceFirmwareHomeView = {
      devices: {
        listDevices: () => [
          makeDevice({
            manufacturer: 'eero',
            model: 'eero 6',
            sourceRefs: [{ protocol: 'vendor', instanceId: 'eero', externalId: 'narnia' }],
            endpoints: [
              {
                id: 'update.narnia_eero_firmware',
                address: 'network::narnia::firmware',
                name: 'Narnia Firmware',
                category: 'network',
                availability: 'online',
                capabilities: [
                  { id: 'update', kind: 'update', readable: true, operations: ['install', 'skip'] },
                ],
                readings: {},
              },
            ],
          }),
        ],
      },
      getEndpointState: (id: string) =>
        id === 'update.narnia_eero_firmware'
          ? {
              update: true,
              installed_version: 'v7.5.1-214',
              latest_version: 'v7.6.0-100',
              title: 'eeroOS',
              in_progress: false,
              release_summary: '- Mesh stability improvements',
              release_url: 'https://support.eero.com/releases',
              supported_features: 17,
            }
          : {},
    };

    const items = collectDeviceFirmwareUpdates({
      homeService: fakeHome,
      installing: new Set<string>(),
      checkedAt: '2026-11-23T00:00:00.000Z',
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'device-update:update.narnia_eero_firmware',
      domain: 'eero',
      title: 'Narnia · eeroOS',
      category: 'firmware',
      installedVersion: 'v7.5.1-214',
      latestVersion: 'v7.6.0-100',
      updateAvailable: true,
      canInstall: true,
      inProgress: false,
      releaseSummary: '- Mesh stability improvements',
      releaseUrl: 'https://support.eero.com/releases',
    });
  });

  it('respects skipped_version when latest_version matches skipped_version', () => {
    const fakeHome: DeviceFirmwareHomeView = {
      devices: {
        listDevices: () => [
          makeDevice({
            id: 'ha:eero1:tvplace',
            name: 'TV Place',
            endpoints: [
              {
                id: 'update.tv_place_eero_firmware',
                address: 'network::tvplace::firmware',
                name: 'Firmware',
                category: 'network',
                availability: 'online',
                capabilities: [
                  { id: 'update', kind: 'update', readable: true, operations: ['install'] },
                ],
                readings: {},
              },
            ],
          }),
        ],
      },
      getEndpointState: () => ({
        update: true,
        installed_version: 'v7.5.1',
        latest_version: 'v7.6.0',
        skipped_version: 'v7.6.0',
      }),
    };

    const items = collectDeviceFirmwareUpdates({
      homeService: fakeHome,
      installing: new Set<string>(),
      checkedAt: '2026-11-23T00:00:00.000Z',
    });
    expect(items[0]?.updateAvailable).toBe(false);
    expect(items[0]?.skippedVersion).toBe('v7.6.0');
  });
});
