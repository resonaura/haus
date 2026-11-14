/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import {
  detectTuyaCameraCandidates,
  formatBridgeInstallProgress,
  providerBridgeId,
  resolveStandaloneTuyaBridge,
  resolveTuyaFollowupStage,
  type TuyaCameraDetectionResult,
} from './tuya-cameras';

describe('Tuya camera follow-up candidate detection', () => {
  it('flags Tuya camera entities bound to the entry so TuyaCameraFollowup prompts user', () => {
    const detection = detectTuyaCameraCandidates({
      entryId: 'entry_tuya_1',
      entities: [
        {
          entity_id: 'camera.kitchen_cam',
          config_entry_id: 'entry_tuya_1',
          device_id: 'tuya:cam_1',
          original_name: 'Kitchen Cam',
        },
      ],
      devices: [
        {
          id: 'tuya:cam_1',
          name: 'Kitchen Cam',
          config_entries: ['entry_tuya_1'],
        },
      ],
      pairedProviders: [],
      discoveredProviders: [],
    });

    expect(detection.hasEntryEntities).toBe(true);
    expect(detection.shouldPrompt).toBe(true);
    expect(detection.cameras).toEqual([
      { id: 'tuya:cam_1', name: 'Kitchen Cam', source: 'ha_entity', imported: false },
    ]);
  });

  it('resolves uninstalled, stopped, and running standalone Hub Tuya bridge state and progress text', () => {
    const manifest = {
      id: 'tuya-rtsp-bridge',
      version: '2.2.12',
      image: 'ghcr.io/resonaura/tuya-rtsp-bridge:latest',
    };

    expect(resolveStandaloneTuyaBridge({ apps: [] }, { entry: { manifest } })).toEqual({
      appId: 'tuya-rtsp-bridge',
      installed: false,
      running: false,
      version: '2.2.12',
      image: 'ghcr.io/resonaura/tuya-rtsp-bridge:latest',
      manifest,
    });

    expect(
      resolveStandaloneTuyaBridge(
        {
          apps: [
            {
              id: 'tuya-rtsp-bridge',
              state: 'running',
              version: '2.2.12',
              source: { externalId: 'tuya-rtsp-bridge' },
            },
          ],
        },
        { entry: { manifest } },
      )?.running,
    ).toBe(true);

    expect(formatBridgeInstallProgress({ stage: 'pulling', progress: 42.4 })).toBe(
      'Pulling latest Tuya Camera Bridge image (42%)…',
    );
    expect(
      formatBridgeInstallProgress({ stage: 'failed', errorCode: 'app_registry_image_unavailable' }),
    ).toBe('Bridge install failed (app_registry_image_unavailable).');
  });

  it('resolves bridgeId-only paired providers across detection and followup stage', () => {
    const pairedBridge = { bridgeId: 'tuya-bridge-42', provider: 'tuya', url: 'http://hub:6766' };
    expect(providerBridgeId(pairedBridge)).toBe('tuya-bridge-42');

    const detection = detectTuyaCameraCandidates({
      entryId: 'entry-tuya',
      entities: [],
      devices: [],
      pairedProviders: [pairedBridge],
      discoveredProviders: [
        { bridgeId: 'tuya-bridge-42', provider: 'tuya', url: 'http://hub:6766' },
      ],
      pairedBridgeCameras: {
        'tuya-bridge-42': [
          { physicalId: 'cam-1', name: 'Porch', available: true, imported: false },
        ],
      },
    });
    expect(detection.discoveredBridge).toBeUndefined();
    expect(detection.unimportedBridgeCameras).toHaveLength(1);
    expect(resolveTuyaFollowupStage(detection, true)).toBe('select-cameras');

    const baseDetection: TuyaCameraDetectionResult = {
      shouldPrompt: true,
      hasEntryEntities: true,
      cameras: [{ id: 'tuya:cam_x', name: 'Patio Camera', source: 'ha_entity', imported: false }],
      pairedBridge: { id: 'bridge-1', provider: 'tuya', url: 'http://127.0.0.1:6766' },
      bridgeCameras: [],
      unimportedBridgeCameras: [],
      bridgeNeedsLogin: true,
    };
    expect(resolveTuyaFollowupStage(baseDetection, false)).toBe('prompt');
    expect(resolveTuyaFollowupStage(baseDetection, true)).toBe('second-login');
    expect(resolveTuyaFollowupStage({ ...baseDetection, pairedBridge: undefined }, true)).toBe(
      'prompt',
    );
  });
});
