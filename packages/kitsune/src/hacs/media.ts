/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import type { Capability } from '@haus/core/types';
import { MediaPlayerEntityFeature, onOffCapability } from '@haus/core/device';
import type { HacsEntityPayload } from './types.js';

const PRIVATE_MEDIA_URL = /(?:https?|rtsps?|rtmp|srt|file):\/\/|data:/i;

export function safeMediaLabel(value: unknown): string | undefined {
  return typeof value === 'string' && !PRIVATE_MEDIA_URL.test(value) ? value : undefined;
}

export function mapMediaPlayerCapabilities(payload?: Partial<HacsEntityPayload>): Capability[] {
  const attrs = payload?.attributes ?? {};
  const features = typeof attrs.supported_features === 'number' ? attrs.supported_features : 0;
  const supports = (feature: number) => (features & feature) === feature;
  const caps: Capability[] = [
    {
      id: 'media_playback',
      kind: 'action',
      readable: true,
      deviceClass:
        attrs.device_class === 'tv' ||
        attrs.device_class === 'speaker' ||
        attrs.device_class === 'receiver'
          ? attrs.device_class
          : undefined,
      operations: [
        ...(supports(MediaPlayerEntityFeature.PLAY) ? ['play'] : []),
        ...(supports(MediaPlayerEntityFeature.PAUSE) ? ['pause'] : []),
        ...(supports(MediaPlayerEntityFeature.PLAY) || supports(MediaPlayerEntityFeature.PAUSE)
          ? ['play_pause']
          : []),
        ...(supports(MediaPlayerEntityFeature.STOP) ? ['stop'] : []),
      ],
    },
  ];
  if (supports(MediaPlayerEntityFeature.TURN_ON) || supports(MediaPlayerEntityFeature.TURN_OFF)) {
    caps.push({
      ...onOffCapability,
      operations: [
        ...(supports(MediaPlayerEntityFeature.TURN_ON) ? ['turn_on'] : []),
        ...(supports(MediaPlayerEntityFeature.TURN_OFF) ? ['turn_off'] : []),
      ],
    });
  }
  if (
    supports(MediaPlayerEntityFeature.VOLUME_SET) ||
    supports(MediaPlayerEntityFeature.VOLUME_STEP)
  ) {
    caps.push({
      id: 'volume',
      kind: 'numeric',
      readable: true,
      operations: [
        ...(supports(MediaPlayerEntityFeature.VOLUME_SET) ? ['set_volume'] : []),
        ...(supports(MediaPlayerEntityFeature.VOLUME_STEP) ? ['volume_up', 'volume_down'] : []),
      ],
      minimum: 0,
      maximum: 100,
      step: 1,
      unit: '%',
    });
  }
  if (supports(MediaPlayerEntityFeature.VOLUME_MUTE)) {
    caps.push({ id: 'mute', kind: 'binary', readable: true, operations: ['set_mute'] });
  }
  const sources = Array.isArray(attrs.source_list)
    ? attrs.source_list
        .map(safeMediaLabel)
        .filter((source): source is string => source !== undefined)
    : [];
  if (supports(MediaPlayerEntityFeature.SELECT_SOURCE) && sources.length) {
    caps.push({
      id: 'source',
      kind: 'enum',
      readable: true,
      operations: ['select_source', 'set'],
      choices: sources,
    });
  }
  return caps;
}

export const remoteKeyCapability: Capability = {
  id: 'remote_key',
  kind: 'action',
  readable: false,
  operations: ['send_command'],
};
