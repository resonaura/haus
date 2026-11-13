/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  computeHaIntegrationMetadata,
  computeHaUpdates,
  installHaUpdate,
} from '../src/native/updates.js';

describe('@haus/ha native updates and integration metadata', () => {
  it('aggregates HA update entities, HACS repositories, and Supervisor addons sorted with available core first', async () => {
    const requestFn = vi.fn(async (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case 'get_states':
          return [
            {
              entity_id: 'update.home_assistant_core_update',
              state: 'on',
              attributes: {
                title: 'Home Assistant Core',
                installed_version: '2026.10.3',
                latest_version: '2026.11.1',
                release_url: 'https://www.home-assistant.io/latest-release-notes/',
              },
            },
            {
              entity_id: 'sensor.living_room_temp',
              state: '21.5',
              attributes: {},
            },
          ];
        case 'hacs/repositories/list':
          return [
            {
              id: '101',
              installed: true,
              name: 'Xiaomi Miot Auto',
              domain: 'xiaomi_miot',
              full_name: 'al-one/hass-xiaomi-miot',
              installed_version: '1.1.4',
              available_version: '1.1.5',
              pending_upgrade: true,
              category: 'integration',
            },
          ];
        case 'supervisor/api':
          return {
            addons: [
              {
                slug: 'core_mosquitto',
                name: 'Mosquitto broker',
                version: '6.4.0',
                version_latest: '6.4.0',
                update_available: false,
              },
            ],
          };
        default:
          return [];
      }
    });

    const result = await computeHaUpdates(
      requestFn as <T = unknown>(message: Record<string, unknown>) => Promise<T>,
    );

    expect(result.total).toBe(3);
    expect(result.availableCount).toBe(2);
    expect(result.items[0]).toMatchObject({
      id: 'entity:update.home_assistant_core_update',
      category: 'core',
      updateAvailable: true,
      canInstall: true,
    });
    expect(result.items[1]).toMatchObject({
      id: 'hacs:101',
      domain: 'xiaomi_miot',
      category: 'hacs',
      updateAvailable: true,
      releaseUrl: 'https://github.com/al-one/hass-xiaomi-miot/releases',
    });
    expect(result.items[2]).toMatchObject({
      id: 'addon:core_mosquitto',
      category: 'addon',
      updateAvailable: false,
    });
  });

  it('dispatches update installs to HA update service, supervisor api, or HACS download', async () => {
    const requestFn = vi.fn(async () => ({}));
    const fn = requestFn as <T = unknown>(message: Record<string, unknown>) => Promise<T>;

    await installHaUpdate(fn, 'entity:update.home_assistant_core_update');
    expect(requestFn).toHaveBeenLastCalledWith({
      type: 'call_service',
      domain: 'update',
      service: 'install',
      target: { entity_id: 'update.home_assistant_core_update' },
    });

    await installHaUpdate(fn, 'addon:core_mosquitto');
    expect(requestFn).toHaveBeenLastCalledWith({
      type: 'supervisor/api',
      endpoint: '/store/addons/core_mosquitto/update',
      method: 'post',
    });

    await installHaUpdate(fn, 'hacs:101');
    expect(requestFn).toHaveBeenLastCalledWith({
      type: 'hacs/repository/download',
      repository: '101',
    });

    await expect(installHaUpdate(fn, 'unknown:1')).rejects.toThrow('Unsupported update target');
  });

  it('computes domain device counts, entity counts, custom integration source, and broken status', async () => {
    const requestFn = vi.fn(async (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case 'config_entries/get':
          return [
            {
              entry_id: 'entry-1',
              domain: 'xiaomi_miot',
              title: 'Xiaomi: 8210526797',
              state: 'setup_error',
              supports_options: true,
              supports_reconfigure: true,
            },
          ];
        case 'manifest/list':
          return [
            {
              domain: 'xiaomi_miot',
              name: 'Xiaomi Miot',
              version: '1.1.5',
              is_built_in: false,
              iot_class: 'cloud_polling',
              single_config_entry: false,
              documentation: 'https://github.com/al-one/hass-xiaomi-miot',
            },
          ];
        case 'config/device_registry/list':
          return [
            { id: 'd1', config_entries: ['entry-1'] },
            { id: 'd2', config_entries: ['entry-1'] },
          ];
        case 'config/entity_registry/list':
          return [
            { entity_id: 'switch.a', device_id: 'd1', config_entry_id: 'entry-1' },
            { entity_id: 'sensor.b', device_id: 'd2', config_entry_id: 'entry-1' },
            { entity_id: 'sensor.c', device_id: 'd2', config_entry_id: 'entry-1' },
          ];
        case 'hacs/repositories/list':
          return [{ installed: true, domain: 'xiaomi_miot' }];
        default:
          return [];
      }
    });

    const meta = await computeHaIntegrationMetadata(
      requestFn as <T = unknown>(message: Record<string, unknown>) => Promise<T>,
    );
    expect(meta).toHaveLength(1);
    expect(meta[0]).toMatchObject({
      domain: 'xiaomi_miot',
      name: 'Xiaomi Miot',
      version: '1.1.5',
      runtimeType: 'custom_integration',
      iotClass: 'cloud_polling',
      supportsOptions: true,
      supportsReconfigure: true,
      supportsMultiple: true,
      deviceCount: 2,
      entityCount: 3,
      entryCount: 1,
      brokenCount: 1,
    });
  });
});
