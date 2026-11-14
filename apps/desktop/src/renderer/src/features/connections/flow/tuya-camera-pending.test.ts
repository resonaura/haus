/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createDemoSnapshot, normalizeHome, type Snapshot } from '../../../model';
import { RegistryController } from '../../../ha/registry';
import { DeviceInventory } from '../DeviceInventory';
import { InventoryRow } from '../InventoryRow';
import { IntegrationAttentionList } from '../details/IntegrationAttentionList';
import { IntegrationEntryCard } from '../details/IntegrationEntryCard';
import { TuyaCameraFollowup } from './TuyaCameraFollowup';
import {
  findPendingTuyaCameras,
  groupPendingByDevice,
  hasTuyaCameraCandidates,
  tuyaPendingCopy,
} from './tuya-camera-pending';

function makeSnapshot(partial?: Partial<Snapshot>): Snapshot {
  const base = createDemoSnapshot();
  return {
    ...base,
    config: { ...base.config, demo: false },
    devices: [],
    entities: [],
    states: [],
    ...partial,
  };
}

describe('incomplete Tuya camera detection & list UI warnings', () => {
  it('flags skipped Hub Tuya stub cameras as bridge_missing even though entities view sets haus_native_camera=1', () => {
    const snapshot = makeSnapshot({
      devices: [
        {
          id: 'tuya:cam_1',
          name: 'Porch Camera',
          manufacturer: 'Tuya',
          model: 'Smart Camera',
          config_entries: ['entry_tuya_1'],
        },
        {
          id: 'tuya:bulb_1',
          name: 'Desk Bulb',
          manufacturer: 'Tuya',
          config_entries: ['entry_tuya_1'],
        },
      ],
      entities: [
        {
          entity_id: 'camera.tuya_cam_1',
          device_id: 'tuya:cam_1',
          platform: 'haus',
          config_entry_id: 'entry_tuya_1',
          unique_id: 'ep_tuya_cam_1_camera:video',
        },
        {
          entity_id: 'light.tuya_bulb_1',
          device_id: 'tuya:bulb_1',
          platform: 'haus',
          config_entry_id: 'entry_tuya_1',
          unique_id: 'ep_tuya_bulb_1_light:on_off',
        },
      ],
      states: [
        {
          entity_id: 'camera.tuya_cam_1',
          state: 'idle',
          attributes: { haus_native_camera: 1, friendly_name: 'Porch Camera' },
          last_changed: '2026-11-13T10:00:00Z',
        },
      ],
    });

    expect(hasTuyaCameraCandidates(snapshot, ['entry_tuya_1'])).toBe(true);
    const pending = findPendingTuyaCameras({
      snapshot,
      tuyaEntryIds: ['entry_tuya_1'],
      pairedProviders: [],
    });
    expect(pending).toEqual([
      {
        deviceId: 'tuya:cam_1',
        deviceName: 'Porch Camera',
        entryId: 'entry_tuya_1',
        reason: 'bridge_missing',
      },
    ]);
  });

  it('tracks bridge_login_required, partial camera_unimported, and clears completed cameras', () => {
    const snapshot = makeSnapshot({
      devices: [
        { id: 'tuya:cam_a', name: 'Front Door Cam', config_entries: ['entry_tuya_1'] },
        { id: 'tuya:cam_b', name: 'Garage Cam', config_entries: ['entry_tuya_1'] },
      ],
      entities: [
        {
          entity_id: 'camera.tuya_cam_a',
          device_id: 'tuya:cam_a',
          platform: 'haus',
          config_entry_id: 'entry_tuya_1',
          unique_id: 'ep_tuya_cam_a_camera:video',
        },
        {
          entity_id: 'camera.tuya_cam_b',
          device_id: 'tuya:cam_b',
          platform: 'haus',
          config_entry_id: 'entry_tuya_1',
          unique_id: 'ep_tuya_cam_b_camera:video',
        },
      ],
    });

    const pairedProviders = [
      { id: 'bridge-tuya-1', provider: 'tuya', url: 'http://127.0.0.1:6766' },
    ];

    const loginNeeded = findPendingTuyaCameras({
      snapshot,
      tuyaEntryIds: ['entry_tuya_1'],
      pairedProviders,
      pairedBridgeCameras: { 'bridge-tuya-1': [] },
    });
    expect(loginNeeded.map((item) => [item.deviceId, item.reason])).toEqual([
      ['tuya:cam_a', 'bridge_login_required'],
      ['tuya:cam_b', 'bridge_login_required'],
    ]);

    const partial = findPendingTuyaCameras({
      snapshot,
      tuyaEntryIds: ['entry_tuya_1'],
      pairedProviders,
      pairedBridgeCameras: {
        'bridge-tuya-1': [
          {
            physicalId: 'cam_a',
            name: 'Front Door Cam',
            available: true,
            existingCameraId: 'camera.tuya_cam_a',
            imported: true,
          },
          {
            physicalId: 'cam_b',
            name: 'Garage Cam',
            available: true,
            existingCameraId: 'camera.tuya_cam_b',
            imported: false,
          },
        ],
      },
    });
    expect(partial).toEqual([
      {
        deviceId: 'tuya:cam_b',
        deviceName: 'Garage Cam',
        entryId: 'entry_tuya_1',
        reason: 'camera_unimported',
        bridgeId: 'bridge-tuya-1',
        physicalId: 'cam_b',
      },
    ]);

    const completed = findPendingTuyaCameras({
      snapshot,
      tuyaEntryIds: ['entry_tuya_1'],
      pairedProviders,
      pairedBridgeCameras: {
        'bridge-tuya-1': [
          { physicalId: 'cam_a', name: 'Front Door Cam', available: true, imported: true },
          { physicalId: 'cam_b', name: 'Garage Cam', available: true, imported: true },
        ],
      },
    });
    expect(completed).toEqual([]);
  });

  it('flags HA Tuya camera DP devices when unbridged and skips them once native HA camera links', () => {
    const baseSnapshot = makeSnapshot({
      devices: [
        { id: 'ha-dev-cam', name: 'Hallway Cam', config_entries: ['ha-tuya-1'] },
        { id: 'ha-dev-plug', name: 'Living Room Plug', config_entries: ['ha-tuya-1'] },
      ],
      entities: [
        {
          entity_id: 'switch.hallway_cam_basic_indicator',
          device_id: 'ha-dev-cam',
          platform: 'tuya',
          config_entry_id: 'ha-tuya-1',
          unique_id: 'tuya_1_basic_indicator',
        },
        {
          entity_id: 'switch.living_room_plug',
          device_id: 'ha-dev-plug',
          platform: 'tuya',
          config_entry_id: 'ha-tuya-1',
          unique_id: 'tuya_2_switch_1',
        },
      ],
    });

    expect(findPendingTuyaCameras({ snapshot: baseSnapshot, pairedProviders: [] })).toEqual([
      {
        deviceId: 'ha-dev-cam',
        deviceName: 'Hallway Cam',
        entryId: 'ha-tuya-1',
        reason: 'bridge_missing',
      },
    ]);

    const bridgedSnapshot: Snapshot = {
      ...baseSnapshot,
      devices: [...baseSnapshot.devices, { id: 'haus-native-cam-dev', name: 'Hallway Cam' }],
      entities: [
        ...baseSnapshot.entities,
        {
          entity_id: 'camera.hallway_cam',
          device_id: 'haus-native-cam-dev',
          platform: 'haus',
        },
      ],
      states: [
        {
          entity_id: 'switch.hallway_cam_basic_indicator',
          state: 'on',
          attributes: {},
          last_changed: '2026-11-13T10:00:00Z',
        },
        {
          entity_id: 'camera.hallway_cam',
          state: 'idle',
          attributes: { haus_native_camera: 1, friendly_name: 'Hallway Cam' },
          last_changed: '2026-11-13T10:00:00Z',
        },
      ],
    };

    expect(findPendingTuyaCameras({ snapshot: bridgedSnapshot, pairedProviders: [] })).toEqual([]);
  });

  it('renders Setup incomplete warning and Finish setup CTA in InventoryRow, DeviceInventory, IntegrationEntryCard, IntegrationAttentionList, and TuyaCameraFollowup', () => {
    const pending = {
      deviceId: 'tuya:cam_1',
      deviceName: 'Porch Camera',
      entryId: 'entry_tuya_1',
      reason: 'bridge_missing' as const,
    };

    const inventoryRowAdminHtml = renderToStaticMarkup(
      createElement(InventoryRow, {
        device: {
          id: 'tuya:cam_1',
          name: 'Porch Camera',
          manufacturer: 'Tuya',
          model: 'Smart Camera',
          category: 'security',
          status: 'available',
          entityCount: 1,
          activeEntityCount: 1,
          integrationIds: ['entry_tuya_1'],
        },
        selecting: false,
        selected: false,
        pendingTuya: pending,
        canManage: true,
        onSelect: vi.fn(),
        onOpen: vi.fn(),
        onManage: vi.fn(),
        onFinishTuyaSetup: vi.fn(),
      }),
    );
    expect(inventoryRowAdminHtml).toContain('Setup incomplete');
    expect(inventoryRowAdminHtml).toContain('Finish setup');
    expect(inventoryRowAdminHtml).not.toContain('Reporting');

    const inventoryRowGuestHtml = renderToStaticMarkup(
      createElement(InventoryRow, {
        device: {
          id: 'tuya:cam_1',
          name: 'Porch Camera',
          manufacturer: 'Tuya',
          model: 'Smart Camera',
          category: 'security',
          status: 'available',
          entityCount: 1,
          activeEntityCount: 1,
          integrationIds: ['entry_tuya_1'],
        },
        selecting: false,
        selected: false,
        pendingTuya: pending,
        canManage: false,
        onSelect: vi.fn(),
        onOpen: vi.fn(),
        onManage: vi.fn(),
      }),
    );
    expect(inventoryRowGuestHtml).toContain('Setup incomplete');
    expect(inventoryRowGuestHtml).not.toContain('Finish setup');

    const snapshot = makeSnapshot({
      devices: [
        {
          id: 'tuya:cam_1',
          name: 'Porch Camera',
          manufacturer: 'Tuya',
          model: 'Smart Camera',
          config_entries: ['entry_tuya_1'],
        },
      ],
      entities: [
        {
          entity_id: 'camera.tuya_cam_1',
          device_id: 'tuya:cam_1',
          platform: 'haus',
          config_entry_id: 'entry_tuya_1',
        },
      ],
    });
    const entry = {
      entry_id: 'entry_tuya_1',
      domain: 'tuya',
      title: 'Tuya',
      state: 'loaded',
      disabled_by: null,
    };

    const entryCardHtml = renderToStaticMarkup(
      createElement(IntegrationEntryCard, {
        entry,
        snapshot,
        progress: [],
        searchQuery: '',
        busy: false,
        pendingTuyaByDevice: groupPendingByDevice([pending]),
        onFlow: vi.fn(),
        onChange: vi.fn(async () => undefined),
        onConfirm: vi.fn(),
        onEditDevice: vi.fn(),
        onFinishTuyaSetup: vi.fn(),
      }),
    );
    expect(entryCardHtml).toContain('Setup incomplete');
    expect(entryCardHtml).toContain('Finish setup');
    expect(entryCardHtml).toContain('is-setup-incomplete');

    const attentionHtml = renderToStaticMarkup(
      createElement(IntegrationAttentionList, {
        name: 'Tuya',
        entries: [entry],
        progress: [],
        issues: [],
        admin: true,
        pendingTuyaCameras: [pending],
        onFlow: vi.fn(),
        onFinishTuyaSetup: vi.fn(),
      }),
    );
    expect(attentionHtml).toContain('Needs attention');
    expect(attentionHtml).toContain('Porch Camera');
    expect(attentionHtml).toContain('Finish setup');

    const registry = new RegistryController({
      snapshot: () => snapshot,
      context: () => ({ mode: 'live', generation: 1, status: 'connected' }),
      commit: vi.fn(),
      request: async () => {
        throw new Error('not called');
      },
    });
    const followupHtml = renderToStaticMarkup(
      createElement(TuyaCameraFollowup, {
        entryId: 'entry_tuya_1',
        entryTitle: 'Tuya',
        resumed: true,
        focusDeviceName: 'Porch Camera',
        onNoCameras: vi.fn(),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    expect(followupHtml).toContain('Checking Tuya for cameras');

    const inventoryHtml = renderToStaticMarkup(
      createElement(DeviceInventory, {
        snapshot,
        accessories: normalizeHome(snapshot).accessories,
        onOpen: vi.fn(),
        onAdd: vi.fn(),
        registry,
        notify: vi.fn(),
      }),
    );
    expect(inventoryHtml).toContain('Porch Camera');

    expect(tuyaPendingCopy('bridge_missing').action).toBe('Finish setup');
    expect(tuyaPendingCopy('bridge_login_required').detail).toContain('QR sign-in');
    expect(tuyaPendingCopy('camera_unimported').detail).toContain('import');
  });

  it('infers Hub Tuya cameras without explicit entryIds and picks direct resume stage', () => {
    const inferredSnapshot = makeSnapshot({
      devices: [{ id: 'tuya:cam_x', name: 'Patio Camera', config_entries: ['hub_tuya_auto'] }],
      entities: [
        {
          entity_id: 'camera.patio',
          device_id: 'tuya:cam_x',
          platform: 'haus',
          unique_id: 'ep_tuya_cam_x_camera:video',
          config_entry_id: 'hub_tuya_auto',
        },
      ],
    });
    expect(hasTuyaCameraCandidates(inferredSnapshot)).toBe(true);
    expect(findPendingTuyaCameras({ snapshot: inferredSnapshot })).toEqual([
      {
        deviceId: 'tuya:cam_x',
        deviceName: 'Patio Camera',
        entryId: 'hub_tuya_auto',
        reason: 'bridge_missing',
      },
    ]);
  });

  it('suppresses disabled Tuya entries and avoids false login warnings when preview is unavailable', () => {
    const camEntity = {
      entity_id: 'switch.cam_1_motion_switch',
      device_id: 'tuya:cam_1',
      platform: 'haus',
      config_entry_id: 'hub_tuya',
    };
    const baseSnapshot = makeSnapshot({
      devices: [{ id: 'tuya:cam_1', name: 'Front Door', config_entries: ['hub_tuya'] }],
      entities: [camEntity],
    });
    expect(hasTuyaCameraCandidates(baseSnapshot, ['hub_tuya'], ['hub_tuya'])).toBe(false);
    expect(
      findPendingTuyaCameras({ snapshot: baseSnapshot, disabledEntryIds: ['hub_tuya'] }),
    ).toEqual([]);
    const paired = [{ id: 'b-1', provider: 'tuya', url: 'http://hub:6766', cameras: 1 }];
    expect(findPendingTuyaCameras({ snapshot: baseSnapshot, pairedProviders: paired })).toEqual([
      expect.objectContaining({
        deviceId: 'tuya:cam_1',
        reason: 'camera_unimported',
        bridgeId: 'b-1',
      }),
    ]);
    const importedSnapshot = makeSnapshot({
      devices: [
        { id: 'tuya:cam_1', name: 'Front Door', config_entries: ['hub_tuya'] },
        { id: 'native-cam-1', name: 'Front Door' },
      ],
      entities: [
        camEntity,
        { entity_id: 'camera.front_door', device_id: 'native-cam-1', platform: 'haus' },
      ],
      states: [
        {
          entity_id: 'camera.front_door',
          state: 'streaming',
          attributes: { friendly_name: 'Front Door', haus_native_camera: 1 },
          last_changed: '',
        },
      ],
    });
    expect(findPendingTuyaCameras({ snapshot: importedSnapshot, pairedProviders: paired })).toEqual(
      [],
    );
  });
});
