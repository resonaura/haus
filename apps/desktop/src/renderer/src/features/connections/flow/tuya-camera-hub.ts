/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  providerBridgeId,
  type HubDetectedTuyaCamera,
  type TuyaBridgeCamera,
  type TuyaBridgeProvider,
} from './tuya-cameras';
import type { TuyaCameraPendingReason, TuyaPendingCamera } from './tuya-camera-pending';

const normalizeCameraName = (value: unknown): string =>
  String(value ?? '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Evaluates expired Tuya bridge sessions and Hub-reported Tuya cloud cameras without requiring stub devices. */
export function collectHubTuyaPendingItems(input: {
  readonly hubTuyaCameras: ReadonlyArray<HubDetectedTuyaCamera>;
  readonly tuyaEntryIds?: ReadonlyArray<string>;
  readonly disabledEntries: ReadonlySet<string>;
  readonly seenPendingIds: Set<string>;
  readonly nativeCameraNames: ReadonlySet<string>;
  readonly tuyaBridges: ReadonlyArray<TuyaBridgeProvider>;
  readonly pairedBridgeCameras: Record<string, ReadonlyArray<TuyaBridgeCamera>>;
  readonly loadedBridgeCams: ReadonlyArray<{ bridgeId: string; cam: TuyaBridgeCamera }>;
  readonly bridgeReportsCamerasWithoutPreview: boolean;
}): TuyaPendingCamera[] {
  const out: TuyaPendingCamera[] = [];

  const expiredBridge = input.tuyaBridges.find(
    (bridge) => bridge.authExpired === true || bridge.loggedIn === false,
  );
  const expiredBridgeId = providerBridgeId(expiredBridge);
  if (expiredBridge && expiredBridgeId) {
    const expiredCams = input.pairedBridgeCameras[expiredBridgeId] ?? [];
    if (expiredCams.length > 0) {
      for (const cam of expiredCams) {
        const key = `tuya:${cam.physicalId}`;
        input.seenPendingIds.add(key);
        out.push({
          deviceId: key,
          deviceName: cam.name || cam.physicalId,
          entryId: input.tuyaEntryIds?.[0],
          reason: 'bridge_session_expired',
          bridgeId: expiredBridgeId,
          physicalId: cam.physicalId,
        });
      }
    } else {
      const key = `tuya-bridge:${expiredBridgeId}`;
      input.seenPendingIds.add(key);
      out.push({
        deviceId: key,
        deviceName: expiredBridge.name || 'Tuya Camera Bridge',
        entryId: input.tuyaEntryIds?.[0],
        reason: 'bridge_session_expired',
        bridgeId: expiredBridgeId,
      });
    }
  }

  for (const hubCam of input.hubTuyaCameras) {
    if (hubCam.entryId && input.disabledEntries.has(hubCam.entryId)) continue;
    const deviceId = `tuya:${hubCam.id}`;
    if (input.seenPendingIds.has(deviceId)) continue;
    const normalizedName = normalizeCameraName(hubCam.name);
    const hasNative = Boolean(normalizedName && input.nativeCameraNames.has(normalizedName));
    const deviceName = hubCam.name || hubCam.id;

    if (input.tuyaBridges.length === 0) {
      if (!hasNative) {
        input.seenPendingIds.add(deviceId);
        out.push({
          deviceId,
          deviceName,
          entryId: hubCam.entryId,
          reason: 'bridge_missing',
          physicalId: hubCam.id,
        });
      }
      continue;
    }

    if (input.loadedBridgeCams.length === 0) {
      if (!hasNative) {
        input.seenPendingIds.add(deviceId);
        out.push({
          deviceId,
          deviceName,
          entryId: hubCam.entryId,
          reason: input.bridgeReportsCamerasWithoutPreview
            ? 'camera_unimported'
            : 'bridge_login_required',
          bridgeId: providerBridgeId(input.tuyaBridges[0]),
          physicalId: hubCam.id,
        });
      }
      continue;
    }

    const matched = input.loadedBridgeCams.find(
      (item) =>
        item.cam.physicalId === hubCam.id ||
        (normalizedName && normalizeCameraName(item.cam.name) === normalizedName),
    );
    if (matched) {
      if (!matched.cam.imported) {
        input.seenPendingIds.add(deviceId);
        out.push({
          deviceId,
          deviceName: hubCam.name || matched.cam.name,
          entryId: hubCam.entryId,
          reason: 'camera_unimported',
          bridgeId: matched.bridgeId,
          physicalId: matched.cam.physicalId,
        });
      }
      continue;
    }

    if (!hasNative && !input.loadedBridgeCams.every((item) => item.cam.imported)) {
      input.seenPendingIds.add(deviceId);
      out.push({
        deviceId,
        deviceName,
        entryId: hubCam.entryId,
        reason: 'camera_unimported',
        bridgeId: input.loadedBridgeCams.find((item) => !item.cam.imported)?.bridgeId,
        physicalId: hubCam.id,
      });
    }
  }

  return out;
}

export function tuyaPendingCopy(reason: TuyaCameraPendingReason): {
  badge: string;
  action: string;
  detail: string;
} {
  if (reason === 'bridge_session_expired') {
    return {
      badge: 'Session expired',
      action: 'Reconnect QR',
      detail:
        'Your Tuya camera bridge session expired. Scan a new QR code in Smart Life / Tuya Smart to reconnect.',
    };
  }
  if (reason === 'bridge_login_required') {
    return {
      badge: 'Setup incomplete',
      action: 'Finish setup',
      detail: 'Tuya Camera Bridge needs QR sign-in before live video and recordings work.',
    };
  }
  if (reason === 'camera_unimported') {
    return {
      badge: 'Setup incomplete',
      action: 'Finish setup',
      detail: 'Select and import this camera from Tuya Camera Bridge to enable live video.',
    };
  }
  return {
    badge: 'Setup incomplete',
    action: 'Finish setup',
    detail: 'Install or connect Tuya Camera Bridge to enable live video, audio, and recordings.',
  };
}
