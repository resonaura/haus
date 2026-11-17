/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { MediaPlayerEntityFeature } from '@haus/core/device';
import type { HubCapability, HubDevice, HubEndpoint } from './types';
import { truthy } from './sensor-classes';
import { privateMediaState } from './redact.js';

const mediaCapabilityIds = new Set([
  'on_off',
  'media_player',
  'media_playback',
  'volume',
  'mute',
  'source',
]);

export function isMediaCapability(
  device: HubDevice,
  endpoint: HubEndpoint,
  capability: HubCapability,
) {
  return (
    mediaCapabilityIds.has(capability.id) &&
    (endpoint.haIdentity?.domain === 'media_player' ||
      (!endpoint.haIdentity && device.category === 'media'))
  );
}

export function mergeMediaCapabilities(
  endpoint: HubEndpoint,
  capability: HubCapability,
): HubCapability {
  const media = endpoint.capabilities.filter((item) => mediaCapabilityIds.has(item.id));
  return {
    ...capability,
    operations: [...new Set(media.flatMap((item) => item.operations))],
    choices: media.find((item) => item.id === 'source')?.choices ?? capability.choices,
    deviceClass: media.find((item) => item.deviceClass)?.deviceClass,
  };
}

function mediaClass(device: HubDevice): string | undefined {
  const label = `${device.model ?? ''} ${device.name}`;
  if (/\bhome\s?pod\b|\bspeaker\b|\bsoundbar\b|\bnest (?:audio|mini)\b/i.test(label))
    return 'speaker';
  if (/\b(?:tv|television|tvos|odyssey)\b|\bAFT[A-Z0-9]+\b/i.test(label)) return 'tv';
  return undefined;
}

export function mediaPlayerState(
  cap: HubCapability,
  endpointState: Record<string, unknown> | undefined,
  attributes: Record<string, unknown>,
  device: HubDevice,
): { state: string; attributes: Record<string, unknown> } {
  const deviceClass = cap.deviceClass ?? mediaClass(device);
  if (deviceClass) attributes.device_class = deviceClass;
  const operations = new Set(cap.operations);
  let features = 0;
  if (operations.has('pause')) features |= MediaPlayerEntityFeature.PAUSE;
  if (operations.has('play')) features |= MediaPlayerEntityFeature.PLAY;
  if (operations.has('stop')) features |= MediaPlayerEntityFeature.STOP;
  if (operations.has('set_volume')) features |= MediaPlayerEntityFeature.VOLUME_SET;
  if (operations.has('volume_up') || operations.has('volume_down'))
    features |= MediaPlayerEntityFeature.VOLUME_STEP;
  if (operations.has('set_mute')) features |= MediaPlayerEntityFeature.VOLUME_MUTE;
  if (operations.has('select_source')) features |= MediaPlayerEntityFeature.SELECT_SOURCE;
  if (operations.has('turn_on')) features |= MediaPlayerEntityFeature.TURN_ON;
  if (operations.has('turn_off')) features |= MediaPlayerEntityFeature.TURN_OFF;
  attributes.supported_features = features;
  if (!endpointState) return { state: 'off', attributes };

  const title = endpointState.media_title;
  const artist = endpointState.media_artist;
  const album = endpointState.media_album_name;
  const appName = endpointState.app_name;
  if (typeof title === 'string' && !privateMediaState(title)) attributes.media_title = title;
  if (typeof artist === 'string' && !privateMediaState(artist)) attributes.media_artist = artist;
  if (typeof album === 'string' && !privateMediaState(album)) attributes.media_album_name = album;
  if (typeof appName === 'string' && !privateMediaState(appName)) attributes.app_name = appName;
  const sourceList = cap.choices ?? endpointState.source_list;
  if (Array.isArray(sourceList))
    attributes.source_list = sourceList.filter(
      (source): source is string => typeof source === 'string' && !privateMediaState(source),
    );
  if (typeof endpointState.source === 'string' && !privateMediaState(endpointState.source))
    attributes.source = endpointState.source;
  if (typeof endpointState.volume === 'number')
    attributes.volume_level = endpointState.volume / 100;
  if (typeof endpointState.mute === 'boolean') attributes.is_volume_muted = endpointState.mute;

  const playbackState = endpointState.media_playback ?? endpointState.state;
  if (
    typeof playbackState === 'string' &&
    ['playing', 'paused', 'idle', 'standby', 'buffering', 'off', 'unknown'].includes(playbackState)
  ) {
    return { state: playbackState, attributes };
  }
  const on = truthy(endpointState.on_off ?? endpointState.state);
  return { state: on ? 'idle' : 'off', attributes };
}

export function remoteState(
  endpointState: Record<string, unknown> | undefined,
  attributes: Record<string, unknown>,
): { state: string; attributes: Record<string, unknown> } {
  attributes.supported_features = 0;
  const remoteState = endpointState?.remote ?? endpointState?.state;
  if (typeof remoteState === 'string' && ['on', 'off', 'unknown'].includes(remoteState)) {
    return { state: remoteState, attributes };
  }
  const on = truthy(endpointState?.on_off ?? endpointState?.state);
  return { state: on === undefined ? 'unknown' : on ? 'on' : 'off', attributes };
}
