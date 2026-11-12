/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { HausDevice } from '@haus/core';
import type { NativeCameraRegistry } from '../../camera/control/sources.js';

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'device';

/** Legacy camera presentation IDs are used only to preserve the existing media/archive association. */
export function graphRegistry(devices: readonly HausDevice[]): NativeCameraRegistry {
  return {
    cameras: devices.flatMap((device) =>
      device.endpoints
        .filter((endpoint) => endpoint.capabilities.some((cap) => cap.id === 'video'))
        .map((endpoint) => ({
          id:
            endpoint.mediaId ??
            `camera.${device.connectivity?.protocol === 'mqtt' && device.endpoints.length > 1 ? slug(endpoint.id.replace(/^ep_(mqtt_)?/, '')) : slug(device.id)}`,
          name: device.name,
          deviceId: device.id,
          areaId: device.roomId,
        })),
    ),
    devices: devices.map((device) => ({
      id: device.id,
      identifiers: (device.sourceRefs ?? []).flatMap((source): [string, string][] => {
        if (source.protocol === 'mqtt') return [['mqtt', source.externalId]];
        const bridge = source.metadata?.bridgeId,
          physical = source.metadata?.physicalId;
        return source.protocol === 'vendor' &&
          typeof bridge === 'string' &&
          typeof physical === 'string'
          ? [['haus', `${bridge}:${physical}`]]
          : [];
      }),
    })),
  };
}
