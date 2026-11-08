/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isIP } from 'node:net';

export interface RecordingInputCamera {
  id: string;
  aliases?: readonly string[];
  deviceId?: string | null;
  deviceIds?: ReadonlyArray<string | null | undefined>;
}

export interface RecordingInputState {
  entity_id: string;
  state: string;
}

export interface RecordingInputEntity {
  entity_id: string;
  device_id?: string | null;
  disabled_by?: string | null;
}

/** Only explicit stream telemetry for this camera may select a LAN source. */
export function directRecordingInput(
  camera: RecordingInputCamera,
  states: readonly RecordingInputState[],
  entities: readonly RecordingInputEntity[],
): string | undefined {
  const entries = new Map(entities.map((entry) => [entry.entity_id, entry]));
  const stems = [camera.id, ...(camera.aliases ?? [])].map((id) =>
    (id.split('.')[1] ?? id).replace(/_internal$/, ''),
  );
  const devices = new Set(
    [camera.deviceId, ...(camera.deviceIds ?? [])].filter((id): id is string => Boolean(id)),
  );
  const associated = (id: string): boolean => {
    const deviceId = entries.get(id)?.device_id;
    return (
      stems.some(
        (stem) =>
          id === `sensor.${stem}_p2p_rtsp_stream` ||
          id === `sensor.${stem}_rtsp_stream` ||
          id === `sensor.${stem}_rtsp_stream_url`,
      ) || Boolean(deviceId && devices.has(deviceId))
    );
  };
  // An unavailable or disabled P2P endpoint is not permission to change the
  // camera transport. HA fallback preserves its configured integration path.
  const p2p = [...states, ...entities].filter(
    (entry) => /^sensor\..*_p2p_rtsp_stream$/.test(entry.entity_id) && associated(entry.entity_id),
  );
  const exactP2p = p2p.filter((entry) =>
    stems.some((stem) => entry.entity_id === `sensor.${stem}_p2p_rtsp_stream`),
  );
  const p2pSources = new Set((exactP2p.length ? exactP2p : p2p).map((entry) => entry.entity_id));
  const candidates = states.filter((state) => {
    const entry = entries.get(state.entity_id);
    return (
      !entry?.disabled_by &&
      /^sensor\..*_rtsp_stream(?:_url)?$/.test(state.entity_id) &&
      (!p2pSources.size || p2pSources.has(state.entity_id)) &&
      associated(state.entity_id)
    );
  });
  let best = 0;
  const urls = new Set<string>();
  for (const state of candidates) {
    try {
      const url = new URL(state.state);
      const host = url.hostname.toLowerCase();
      const local =
        (isIP(host) === 4 && /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) ||
        host === 'localhost' ||
        host.endsWith('.local') ||
        host.endsWith('.lan');
      if (
        ['rtsp:', 'rtsps:'].includes(url.protocol) &&
        local &&
        !url.hash &&
        url.href.length <= 2048
      ) {
        const score = stems.some((stem) => state.entity_id === `sensor.${stem}_p2p_rtsp_stream`)
          ? 3
          : stems.some((stem) =>
                ['_rtsp_stream', '_rtsp_stream_url'].some(
                  (suffix) => state.entity_id === `sensor.${stem}${suffix}`,
                ),
              )
            ? 2
            : 1;
        if (score > best) urls.clear();
        if (score >= best) urls.add(url.href);
        best = Math.max(best, score);
      }
    } catch {}
  }
  // Ambiguous stream telemetry is left to HA, never guessed from room names.
  return urls.size === 1 ? [...urls][0] : undefined;
}
