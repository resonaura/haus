/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { humanize, type FlowStep, type IntegrationEntry } from '../../../ha/management';
import type { Device, HassEntity, Snapshot } from '../../../model';
import {
  extractFlowErrorMessage,
  extractMenuOptions,
  resolveFieldLabel,
  resolveStepDocumentationUrl,
  validateRequiredFormFields,
} from '../flow/flow-helpers';
import { detectTuyaCameraCandidates, findTuyaBridgeAddon } from '../flow/tuya-cameras';
import { entryNeedsAttention } from '../integration-health';
import {
  buildAddonActionDescription,
  buildIntegrationGroups,
  computeIntegrationStats,
  deviceEntityCount,
  entryDevicesForEntry,
  filterIntegrationEntries,
  formatCategoryBadge,
  formatIotClass,
  formatRuntimeLabel,
} from './types';
import {
  filterDiscoveredProgress,
  formatDiscoverySourceLabel,
  isDiscoveredFlowProgress,
} from './DiscoveredPanel';

function makeSnapshot(devices: Device[], entities: Snapshot['entities']): Snapshot {
  return {
    config: { location_name: 'Home', version: '2026.11.0' },
    user: { id: 'u1', name: 'Admin', is_admin: true },
    areas: [{ area_id: 'narnia', name: 'Narnia' }],
    devices,
    entities,
    states: entities.map(
      (e) =>
        ({
          entity_id: e.entity_id,
          state: 'on',
          attributes: {},
          last_changed: '2026-01-01T00:00:00Z',
          last_updated: '2026-01-01T00:00:00Z',
        }) as unknown as HassEntity,
    ),
    services: {},
  };
}

describe('connections flow helpers', () => {
  it('extracts multi-step action radio cards with descriptions and translated labels', () => {
    const step: FlowStep = {
      flow_id: 'f1',
      type: 'menu',
      handler: 'xiaomi_miot',
      step_id: 'user',
      menu_options: {
        cloud: 'Add devices using Mi Account',
        local: 'Add device using host/token',
      },
      menu_descriptions: {
        cloud: 'Sign in with Xiaomi Cloud credentials or QR code.',
        local: 'Connect directly over LAN using IP and 32-char token.',
      },
      documentation_url: 'https://github.com/al-one/hass-xiaomi-miot',
    };

    const options = extractMenuOptions(step, { local: 'Local LAN token' }, humanize);
    expect(options).toEqual([
      {
        key: 'cloud',
        label: 'Add devices using Mi Account',
        description: 'Sign in with Xiaomi Cloud credentials or QR code.',
      },
      {
        key: 'local',
        label: 'Local LAN token',
        description: 'Connect directly over LAN using IP and 32-char token.',
      },
    ]);
    expect(resolveStepDocumentationUrl(step)).toBe('https://github.com/al-one/hass-xiaomi-miot');
  });

  it('ignores non-http or external-auth urls when resolving step help links', () => {
    const externalStep: FlowStep = {
      flow_id: 'f2',
      type: 'external',
      handler: 'tuya',
      step_id: 'auth',
      url: 'https://auth.example.com/oauth',
    };
    expect(resolveStepDocumentationUrl(externalStep)).toBeUndefined();
    expect(extractFlowErrorMessage(new Error('Invalid access secret'))).toBe(
      'Invalid access secret',
    );
    expect(extractFlowErrorMessage(null)).toContain('Could not complete configuration step');
    expect(resolveFieldLabel({ name: 'api_key', label: 'Client Secret' }, {}, humanize)).toBe(
      'Client Secret',
    );
  });
});

describe('integration domain stats and multi-entry device linking', () => {
  const snapshot = makeSnapshot(
    [
      {
        id: 'dev-narnia-pedal',
        name: 'Narnia Pedalboard',
        model: 'chuangmi.plug.hmi206',
        area_id: 'narnia',
        config_entries: ['xiaomi-acct-1'],
      },
      {
        id: 'dev-kettle',
        name: 'Kitchen Kettle',
        model: 'xiaomi.kettle.v21',
        area_id: null,
        config_entries: ['xiaomi-acct-2'],
      },
      {
        id: 'dev-unlisted',
        name: 'Air Purifier',
        config_entries: [],
      },
    ],
    [
      {
        entity_id: 'switch.pedal_1',
        device_id: 'dev-narnia-pedal',
        config_entry_id: 'xiaomi-acct-1',
      },
      {
        entity_id: 'sensor.pedal_power',
        device_id: 'dev-narnia-pedal',
        config_entry_id: 'xiaomi-acct-1',
      },
      {
        entity_id: 'sensor.kettle_temp',
        device_id: 'dev-kettle',
        config_entry_id: 'xiaomi-acct-2',
      },
      {
        entity_id: 'fan.purifier',
        device_id: 'dev-unlisted',
        config_entry_id: 'xiaomi-acct-2',
        platform: 'xiaomi_miot',
      },
    ],
  );

  const entryOne: IntegrationEntry = {
    entry_id: 'xiaomi-acct-1',
    domain: 'xiaomi_miot',
    title: 'Xiaomi: 8210526797',
    source: 'user',
    state: 'setup_error',
    reason: 'Xiaomi authentication failed for this account',
    supports_options: true,
    supports_reconfigure: true,
    supports_unload: true,
    disabled_by: null,
  };

  const entryTwo: IntegrationEntry = {
    ...entryOne,
    entry_id: 'xiaomi-acct-2',
    title: 'Xiaomi: Secondary',
    state: 'loaded',
    reason: undefined,
  };

  it('attributes devices and entities accurately per entry and aggregated domain', () => {
    const firstDevices = entryDevicesForEntry(entryOne, snapshot);
    const secondDevices = entryDevicesForEntry(entryTwo, snapshot);
    expect(firstDevices.map((d) => d.id)).toEqual(['dev-narnia-pedal']);
    expect(secondDevices.map((d) => d.id)).toEqual(['dev-kettle', 'dev-unlisted']);
    expect(deviceEntityCount('dev-narnia-pedal', snapshot)).toBe(2);

    const stats = computeIntegrationStats('xiaomi_miot', [entryOne, entryTwo], snapshot);
    expect(stats).toEqual({ deviceCount: 3, entityCount: 4 });
  });

  it('filters entries by health and enabled state', () => {
    const entries = [
      entryOne,
      entryTwo,
      { ...entryTwo, entry_id: 'xiaomi-disabled', disabled_by: 'user', state: 'not_loaded' },
    ];
    expect(
      filterIntegrationEntries(entries, 'xiaomi_miot', 'issues', (e) => entryNeedsAttention(e)).map(
        (e) => e.entry_id,
      ),
    ).toEqual(['xiaomi-acct-1']);
    expect(
      filterIntegrationEntries(entries, 'xiaomi_miot', 'loaded', (e) => entryNeedsAttention(e)).map(
        (e) => e.entry_id,
      ),
    ).toEqual(['xiaomi-acct-2']);
    expect(
      filterIntegrationEntries(entries, 'xiaomi_miot', 'disabled', (e) =>
        entryNeedsAttention(e),
      ).map((e) => e.entry_id),
    ).toEqual(['xiaomi-disabled']);
  });

  it('formats runtime source tags, iot connectivity, update categories, and addon confirms', () => {
    expect(formatRuntimeLabel('custom_integration')).toBe('Custom integration');
    expect(formatRuntimeLabel('homebridge')).toBe('Homebridge plugin');
    expect(formatRuntimeLabel('scrypted')).toBe('Scrypted plugin');
    expect(formatIotClass('cloud_polling')).toBe('Requires Internet');
    expect(formatIotClass('local_push')).toBe('Local push');
    expect(formatCategoryBadge('hacs')).toBe('HACS');
    expect(formatCategoryBadge('core')).toBe('Core');
    expect(buildAddonActionDescription('update', true, '1.0.0', '1.1.0')).toContain('1.1.0');
  });

  it('validates required scalar fields without blocking optional qr_code or boolean fields', () => {
    expect(
      validateRequiredFormFields(
        [
          { name: 'user_code', type: 'string', required: true },
          { name: 'remember', type: 'boolean', required: true },
          { name: 'QR', type: 'qr_code', required: false },
        ],
        { user_code: '   ', remember: false },
      ),
    ).toEqual({ user_code: 'required' });

    expect(
      validateRequiredFormFields([{ name: 'user_code', type: 'string', required: true }], {
        user_code: 'uCode123',
      }),
    ).toEqual({});
  });

  it('detects Tuya cameras for second-login followup only when unbridged cameras or bridge exist', () => {
    // Only switches/lights under Tuya entry -> do not prompt about cameras
    const lightsOnly = detectTuyaCameraCandidates({
      entryId: 'tuya-entry-1',
      entities: [
        { entity_id: 'light.bedroom_lamp', platform: 'tuya', config_entry_id: 'tuya-entry-1' },
      ],
      devices: [{ id: 'd1', name: 'Lamp', config_entries: ['tuya-entry-1'] }],
      pairedProviders: [],
      discoveredProviders: [],
    });
    expect(lightsOnly.hasEntryEntities).toBe(true);
    expect(lightsOnly.shouldPrompt).toBe(false);

    // HA Tuya camera / indicator entity without paired native bridge -> prompt
    const withCam = detectTuyaCameraCandidates({
      entryId: 'tuya-entry-1',
      entities: [
        {
          entity_id: 'switch.hallway_cam_basic_indicator',
          platform: 'tuya',
          config_entry_id: 'tuya-entry-1',
          device_id: 'dev-cam-1',
          unique_id: 'tuya_dev1_basic_indicator',
        },
      ],
      devices: [{ id: 'dev-cam-1', name: 'Hallway Camera', config_entries: ['tuya-entry-1'] }],
      pairedProviders: [],
      discoveredProviders: [],
    });
    expect(withCam.shouldPrompt).toBe(true);
    expect(withCam.cameras.map((c) => c.name)).toEqual(['Hallway Camera']);

    // Paired tuya bridge whose 2nd QR login has not completed yet (0 cameras) -> prompt
    const pairedEmptyBridge = detectTuyaCameraCandidates({
      entryId: 'tuya-entry-1',
      entities: [],
      devices: [],
      pairedProviders: [{ id: 'bridge-tuya', provider: 'tuya', url: 'http://127.0.0.1:6766' }],
      discoveredProviders: [],
      pairedBridgeCameras: { 'bridge-tuya': [] },
    });
    expect(pairedEmptyBridge.shouldPrompt).toBe(true);
    expect(pairedEmptyBridge.bridgeNeedsLogin).toBe(true);

    // Paired tuya bridge with all cameras already imported -> do not re-prompt
    const alreadyImported = detectTuyaCameraCandidates({
      entryId: 'tuya-entry-1',
      entities: [
        {
          entity_id: 'camera.porch',
          platform: 'tuya',
          config_entry_id: 'tuya-entry-1',
          device_id: 'dev-porch',
        },
      ],
      devices: [{ id: 'dev-porch', name: 'Porch Cam', config_entries: ['tuya-entry-1'] }],
      pairedProviders: [{ id: 'bridge-tuya', provider: 'tuya', url: 'http://127.0.0.1:6766' }],
      discoveredProviders: [],
      pairedBridgeCameras: {
        'bridge-tuya': [{ physicalId: 'p1', name: 'Porch Cam', available: true, imported: true }],
      },
    });
    expect(alreadyImported.shouldPrompt).toBe(false);

    // Addon matcher finds tuya-rtsp-bridge across prefixed slugs
    expect(
      findTuyaBridgeAddon([{ slug: 'local_tuya-rtsp-bridge', name: 'Tuya RTSP', state: 'started' }])
        ?.slug,
    ).toBe('local_tuya-rtsp-bridge');
  });

  it('filters discovered flow progress separately from reauth items and formats discovery sources', () => {
    const progress = [
      {
        flow_id: 'comm_disc_hue_1',
        handler: 'hue',
        context: {
          source: 'zeroconf',
          title_placeholders: { name: 'Philips Hue Bridge (192.168.5.88)' },
        },
      },
      {
        flow_id: 'comm_disc_avr_1',
        handler: 'denonavr',
        context: {
          source: 'ssdp',
          title_placeholders: { name: 'Living Room AVR (192.168.5.42)' },
        },
      },
      {
        flow_id: 'reauth_xiaomi_1',
        handler: 'xiaomi_miot',
        context: {
          source: 'reauth',
          title_placeholders: { name: 'Reauthenticate Xiaomi' },
        },
      },
    ];

    expect(progress.map(isDiscoveredFlowProgress)).toEqual([true, true, false]);
    expect(filterDiscoveredProgress(progress, '').map((p) => p.handler)).toEqual([
      'hue',
      'denonavr',
    ]);
    expect(
      filterDiscoveredProgress(progress, 'denon', (d) =>
        d === 'denonavr' ? 'Denon HEOS / AVR' : humanize(d),
      ).map((p) => p.flow_id),
    ).toEqual(['comm_disc_avr_1']);
    expect(formatDiscoverySourceLabel('zeroconf')).toBe('mDNS / Zeroconf');
    expect(formatDiscoverySourceLabel('ssdp')).toBe('UPnP / SSDP');

    const entries: IntegrationEntry[] = [
      { entry_id: 'e1', domain: 'hue', title: 'Hue', state: 'loaded', disabled_by: null },
    ];
    expect(filterIntegrationEntries(entries, 'hue', 'discovered', () => false)).toEqual([]);
    expect(
      buildIntegrationGroups(entries, 'all', '', () => false, humanize).map((g) => g.domain),
    ).toEqual(['hue']);
  });
});
