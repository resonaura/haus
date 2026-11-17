/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QrCodeField } from '../../../components/forms/QrCodeField';
import { pollTuyaQr, startTuyaQr, tuyaQrFailure } from './tuya-qr';
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

describe('Tuya camera QR sign-in', () => {
  it('recovers a confirmed login when the QR poll times out during camera discovery', async () => {
    const nativeProviders = vi
      .fn()
      .mockRejectedValueOnce(new Error('The Hub request failed (502).'))
      .mockResolvedValueOnce({ loggedIn: true, region: 'us', regions: [] });
    vi.stubGlobal('window', { hausNative: { management: vi.fn(), nativeProviders } });
    try {
      await expect(pollTuyaQr('bridge-1', 'example-token')).resolves.toEqual({ loggedIn: true });
      expect(nativeProviders.mock.calls).toEqual([
        [{ operation: 'loginQrPoll', bridgeId: 'bridge-1', token: 'example-token' }],
        [{ operation: 'loginState', bridgeId: 'bridge-1' }],
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders the scannable code without printing the long sign-in link', () => {
    const payload = `tuyaSmart--qrLogin?token=${'a'.repeat(240)}`;
    const html = renderToStaticMarkup(
      createElement(QrCodeField, {
        label: 'Tuya Camera QR Sign-In',
        data: payload,
        showLink: false,
      }),
    );
    expect(html).toContain('aria-label="Tuya Camera QR Sign-In"');
    expect(html).not.toContain(payload);
    expect(html).not.toContain('Copy link');
  });
  it('requests the bridge QR through the native Hub session', async () => {
    const nativeProviders = vi
      .fn()
      .mockResolvedValue({ token: 'example-token', qrPayload: 'example-qr' });
    vi.stubGlobal('window', { hausNative: { management: vi.fn(), nativeProviders } });
    try {
      await expect(startTuyaQr('bridge-1', 'us')).resolves.toEqual({
        token: 'example-token',
        qrPayload: 'example-qr',
      });
      expect(nativeProviders).toHaveBeenCalledExactlyOnceWith({
        operation: 'loginQrStart',
        bridgeId: 'bridge-1',
        region: 'us',
      });
      nativeProviders.mockResolvedValue({ token: 'example-token', qrPayload: 42 });
      await expect(startTuyaQr('bridge-1', 'us')).rejects.toThrow('invalid_tuya_qr_response');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('distinguishes a temporary Hub failure from sign-in and pairing errors', () => {
    const ipc = (detail: string) =>
      new Error(`Error invoking remote method 'haus:native-providers': Error: ${detail}`);
    expect(tuyaQrFailure(ipc('The Hub request failed (502).'), 'poll')).toEqual({
      message: 'Could not verify the Tuya scan. Use Refresh QR to start a new sign-in.',
      retryable: true,
    });
    expect(
      tuyaQrFailure(ipc('The Hub request failed (403: administrator_required).'), 'start'),
    ).toMatchObject({ retryable: false, message: expect.stringContaining('administrator') });
    expect(
      tuyaQrFailure(ipc('The Hub request failed (404: native_provider_not_found).'), 'check'),
    ).toMatchObject({
      retryable: false,
      message: expect.stringContaining('Pair Tuya Camera Bridge'),
    });
    expect(tuyaQrFailure(ipc('Invalid Tuya QR token.'), 'poll')).toMatchObject({
      retryable: false,
      message: expect.stringContaining('scan the new code'),
    });
  });
});
