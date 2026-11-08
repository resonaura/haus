/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  directRecordingInput,
  type RecordingInputCamera,
  type RecordingInputEntity,
  type RecordingInputState,
} from '@haus/ha/node/recording-input';
import { requiresProtectedStream } from '@haus/kitsune/native';

export interface NvrCameraSourceDescriptor {
  kind?: string;
  url: string;
  [key: string]: unknown;
}

export type NvrCameraSource = NvrCameraSourceDescriptor;

export interface NvrCameraWithSources extends RecordingInputCamera {
  independentSource?: boolean;
  kitsuneSource?: NvrCameraSourceDescriptor;
  nativeProvider?: unknown;
  nativeSource?: NvrCameraSourceDescriptor;
  playbackSource?: {
    platform?: string;
    manufacturer?: string;
    model?: string;
  };
}

export interface NvrCameraRegistryLike {
  cameras?: readonly unknown[];
  states?: readonly RecordingInputState[];
  entities?: ReadonlyArray<{
    entity_id: string;
    device_id?: string | null;
    disabled_by?: unknown;
  }>;
}

export interface NvrCameraSourceOptions {
  local?: boolean;
}

/** Explicit protected restream telemetry only. Never ask HA to manufacture HLS. */
export function nvrCameraSource(
  camera: NvrCameraWithSources,
  registry: NvrCameraRegistryLike,
  { local = false }: NvrCameraSourceOptions = {},
): NvrCameraSourceDescriptor {
  // Imported native sources have already passed enrollment, private-address and identity validation.
  // Never fall back to HA telemetry when that provider owns this source.
  if (camera.independentSource && camera.kitsuneSource) return { ...camera.kitsuneSource };
  if (camera.nativeProvider && camera.nativeSource) return { ...camera.nativeSource };
  const states = registry.states ?? [];
  const entities: RecordingInputEntity[] = (registry.entities ?? []).map((entry) => ({
    entity_id: entry.entity_id,
    device_id: entry.device_id ?? undefined,
    disabled_by: entry.disabled_by ? String(entry.disabled_by) : null,
  }));
  const url = directRecordingInput(camera, states, entities);
  if (!url) throw new Error('camera_rtsp_source_unavailable');
  const p2p = states.some((state) => {
    try {
      return state.entity_id.endsWith('_p2p_rtsp_stream') && new URL(state.state).href === url;
    } catch {
      return false;
    }
  });
  if (
    !p2p &&
    requiresProtectedStream(
      {
        id: camera.id,
        aliases: camera.aliases ? [...camera.aliases] : undefined,
        deviceId: camera.deviceId ?? undefined,
        deviceIds: camera.deviceIds
          ? camera.deviceIds.filter((id): id is string => Boolean(id))
          : undefined,
        playbackSource: camera.playbackSource
          ? {
              platform: camera.playbackSource.platform,
              manufacturer: camera.playbackSource.manufacturer ?? undefined,
            }
          : undefined,
      },
      [...states],
      entities.map((entry) => ({
        entity_id: entry.entity_id,
        device_id: entry.device_id ?? undefined,
        disabled_by: entry.disabled_by,
      })),
    )
  ) {
    throw new Error('camera_protected_p2p_source_required');
  }
  const parsed = new URL(url);
  if (!local && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('camera_source_not_reachable_by_nvr');
  }
  return { kind: p2p ? 'p2p-restream' : 'rtsp', url };
}
