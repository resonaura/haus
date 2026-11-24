/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  countAppFilters,
  countIntegrationFilters,
  filterInstalledApps,
  filterIntegrationGroups,
  filterUpdates,
  groupIntegrationsByDomain,
  parseInstalledAppsPayload,
  parseSupervisorAddonsPayload,
  type IntegrationEntryRecord,
  type RepairIssueRecord,
  type UnifiedUpdateRecord,
} from '../../src/transport/index.js';

describe('@haus/core transport integrations & apps helpers', () => {
  it('groups, filters, and counts integrations including issues and updates', () => {
    const entries: IntegrationEntryRecord[] = [
      { entry_id: 'e1', domain: 'hue', title: 'Hue Bridge', state: 'loaded', disabled_by: null },
      { entry_id: 'e2', domain: 'tuya', title: 'Tuya Home', state: 'setup_error', disabled_by: null },
      {
        entry_id: 'e3',
        domain: 'tuya_rtsp_bridge',
        title: 'Tuya Camera Relay',
        state: 'loaded',
        disabled_by: null,
      },
      { entry_id: 'e4', domain: 'sonos', title: 'Sonos Living Room', state: 'loaded', disabled_by: 'user' },
    ];
    const issues: RepairIssueRecord[] = [
      { domain: 'hue', issue_id: 'auth_expired', severity: 'error' },
    ];

    const groups = groupIntegrationsByDomain(entries, (domain) => domain.toUpperCase());
    expect(groups.map((g) => [g.domain, g.name, g.entries.length])).toEqual([
      ['hue', 'HUE', 1],
      ['sonos', 'SONOS', 1],
      ['tuya', 'Tuya', 2],
    ]);

    expect(filterIntegrationGroups(groups, 'issues', '', issues).map((g) => g.domain)).toEqual([
      'hue',
      'tuya',
    ]);
    expect(filterIntegrationGroups(groups, 'disabled', '', issues).map((g) => g.domain)).toEqual([
      'sonos',
    ]);
    expect(countIntegrationFilters(entries, 2, issues)).toEqual({
      all: 4,
      discovered: 2,
      loaded: 3,
      issues: 2,
      disabled: 1,
    });

    const updates: UnifiedUpdateRecord[] = [
      {
        id: 'u1',
        domain: 'hue',
        title: 'Hue Firmware',
        category: 'firmware',
        installedVersion: '1.0',
        latestVersion: '1.1',
        updateAvailable: true,
        canInstall: true,
      },
      {
        id: 'u2',
        domain: 'homebridge',
        title: 'Homebridge UI',
        category: 'homebridge',
        installedVersion: '4.0',
        latestVersion: '4.0',
        updateAvailable: false,
        canInstall: true,
      },
    ];
    expect(filterUpdates(updates, 'available').map((u) => u.id)).toEqual(['u1']);
    expect(filterUpdates(updates, 'bridges').map((u) => u.id)).toEqual(['u2']);
  });

  it('parses Hub apps and Supervisor add-on payloads and filters apps cleanly', () => {
    const apps = parseInstalledAppsPayload({
      apps: [
        {
          id: 'z2m',
          name: 'Zigbee2MQTT',
          state: 'running',
          available: true,
          managed: true,
          actions: ['stop', 'restart'],
          source: { instanceId: 'drv-1', externalId: 'zigbee2mqtt' },
          accessories: { mqtt: true, camera: false },
          update_available: true,
        },
        {
          id: 'thread',
          name: 'Thread Border',
          state: 'stopped',
          available: true,
          managed: false,
          actions: ['start'],
        },
      ],
      drivers: [{ id: 'drv-1', capabilities: { logs: true } }],
    });
    expect(apps.map((a) => [a.id, a.externalId, a.logs, a.updateAvailable])).toEqual([
      ['z2m', 'zigbee2mqtt', true, true],
      ['thread', 'thread', false, false],
    ]);

    expect(countAppFilters(apps)).toEqual({ all: 2, running: 1, stopped: 1, updates: 1 });
    expect(filterInstalledApps(apps, 'running', 'zigbee').map((a) => a.id)).toEqual(['z2m']);

    const supervisor = parseSupervisorAddonsPayload(
      { addons: [{ slug: 'mosquitto', name: 'Mosquitto broker', state: 'started', version: '6.4' }] },
      { addons: [{ slug: 'mosquitto', name: 'Mosquitto broker', version: '6.4', version_latest: '6.5', update_available: true }] },
    );
    expect(supervisor.installed[0]?.sourceKind).toBe('supervisor-addon');
    expect(supervisor.catalog[0]?.installed).toBe(true);
  });
});
