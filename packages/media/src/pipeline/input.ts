/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export interface MediaInputProfile {
  rtspTransport?: 'tcp';
  liveStartIndex?: -1;
  realtime?: true;
  logLevel?: 'debug';
}

/** Adapts the established HA input-option contract through a strict allowlist. */
export function parseMediaInputProfile(arguments_: readonly string[] = []): MediaInputProfile {
  const profile: {
    rtspTransport?: 'tcp';
    liveStartIndex?: -1;
    realtime?: true;
    logLevel?: 'debug';
  } = {};
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index];
    if (argument === '-re') {
      profile.realtime = true;
      continue;
    }
    if (argument === '-rtsp_transport' && arguments_[index + 1] === 'tcp') {
      profile.rtspTransport = 'tcp';
      index++;
      continue;
    }
    if (argument === '-live_start_index' && arguments_[index + 1] === '-1') {
      profile.liveStartIndex = -1;
      index++;
      continue;
    }
    if (argument === '-loglevel' && arguments_[index + 1] === 'debug') {
      profile.logLevel = 'debug';
      index++;
      continue;
    }
    throw new Error('invalid_media_input_profile');
  }
  return profile;
}

export function mediaInputArguments(profile: MediaInputProfile = {}): string[] {
  if (
    (profile.rtspTransport !== undefined && profile.rtspTransport !== 'tcp') ||
    (profile.liveStartIndex !== undefined && profile.liveStartIndex !== -1) ||
    (profile.realtime !== undefined && profile.realtime !== true) ||
    (profile.logLevel !== undefined && profile.logLevel !== 'debug')
  )
    throw new Error('invalid_media_input_profile');
  return [
    ...(profile.rtspTransport ? ['-rtsp_transport', profile.rtspTransport] : []),
    ...(profile.liveStartIndex !== undefined
      ? ['-live_start_index', String(profile.liveStartIndex)]
      : []),
    ...(profile.realtime ? ['-re'] : []),
  ];
}
