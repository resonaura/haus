/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createDemoSnapshot, type Snapshot } from '../../../model';
import { IntegrationAttentionList } from '../details/IntegrationAttentionList';
import { findPendingTuyaCameras, tuyaPendingCopy } from './tuya-camera-pending';
import { tuyaReconnectTargetForEntity } from '../../cameras/tuya/TuyaCameraReconnectModal';

function makeEmptySnapshot(): Snapshot {
  const base = createDemoSnapshot();
  return {
    ...base,
    config: { ...base.config, demo: false },
    devices: [],
    entities: [],
    states: [],
  };
}

describe('Hub Tuya camera suppression, setup alerts, and QR session expiry reconnect', () => {
  it('flags Hub-detected Tuya cameras as bridge_missing even with zero stub devices in snapshot', () => {
    const pending = findPendingTuyaCameras({
      snapshot: makeEmptySnapshot(),
      tuyaEntryIds: ['entry_tuya_1'],
      pairedProviders: [],
      hubTuyaCameras: [{ id: 'cam_hub_1', name: 'Narnia Camera', entryId: 'entry_tuya_1' }],
    });
    expect(pending).toEqual([
      {
        deviceId: 'tuya:cam_hub_1',
        deviceName: 'Narnia Camera',
        entryId: 'entry_tuya_1',
        reason: 'bridge_missing',
        physicalId: 'cam_hub_1',
      },
    ]);
  });

  it('flags expired Tuya bridge session with Reconnect QR even when cameras are already imported', () => {
    const pending = findPendingTuyaCameras({
      snapshot: makeEmptySnapshot(),
      tuyaEntryIds: ['entry_tuya_1'],
      pairedProviders: [
        {
          id: 'bridge-tuya-1',
          provider: 'tuya',
          url: 'http://192.168.4.44:6766',
          loggedIn: false,
          authExpired: true,
        },
      ],
      pairedBridgeCameras: {
        'bridge-tuya-1': [
          { physicalId: 'cam_hub_1', name: 'Narnia Camera', available: false, imported: true },
        ],
      },
      hubTuyaCameras: [{ id: 'cam_hub_1', name: 'Narnia Camera', entryId: 'entry_tuya_1' }],
    });
    expect(pending).toEqual([
      {
        deviceId: 'tuya:cam_hub_1',
        deviceName: 'Narnia Camera',
        entryId: 'entry_tuya_1',
        reason: 'bridge_session_expired',
        bridgeId: 'bridge-tuya-1',
        physicalId: 'cam_hub_1',
      },
    ]);
    expect(tuyaPendingCopy('bridge_session_expired').action).toBe('Reconnect QR');

    const html = renderToStaticMarkup(
      createElement(IntegrationAttentionList, {
        name: 'Tuya',
        entries: [
          {
            entry_id: 'entry_tuya_1',
            domain: 'tuya',
            title: 'Tuya',
            state: 'loaded',
            disabled_by: null,
          },
        ],
        progress: [],
        issues: [],
        admin: true,
        pendingTuyaCameras: pending,
        onFlow: vi.fn(),
        onFinishTuyaSetup: vi.fn(),
      }),
    );
    expect(html).toContain('Session expired');
    expect(html).toContain('Reconnect QR');
  });

  it('extracts 1-click QR reconnect target only for expired Tuya bridge cameras', () => {
    expect(
      tuyaReconnectTargetForEntity({
        entity_id: 'camera.narnia_camera',
        state: 'unavailable',
        attributes: {
          friendly_name: 'Narnia Camera',
          haus_bridge_provider: 'tuya',
          haus_bridge_id: 'bridge-tuya-1',
          haus_auth_expired: true,
        },
        last_changed: '',
      }),
    ).toEqual({ bridgeId: 'bridge-tuya-1', cameraName: 'Narnia Camera' });

    expect(
      tuyaReconnectTargetForEntity({
        entity_id: 'camera.outdoor',
        state: 'unavailable',
        attributes: {
          friendly_name: 'Outdoor Camera',
          haus_bridge_provider: 'aqara',
          haus_bridge_id: 'bridge-aqara-1',
        },
        last_changed: '',
      }),
    ).toBeNull();
  });
});
