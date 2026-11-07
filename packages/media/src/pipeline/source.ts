/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { runMediaProcess } from './transcode.js';
import type { MediaProcessRunOptions } from './transcode.js';
import { mediaInputArguments, parseMediaInputProfile } from './input.js';

export async function inspectSourceAudio(
  url: string,
  token?: string,
  signal?: AbortSignal,
  inputArguments: readonly string[] = [],
  options: MediaProcessRunOptions = {},
): Promise<boolean> {
  if (!url || url.includes('\0') || (token && /[\r\n]/.test(token)))
    throw new Error('invalid_media_source');
  const profile = parseMediaInputProfile(inputArguments);
  const probeProfile = { ...profile };
  delete probeProfile.realtime;
  const { stdout } = await runMediaProcess(
    'ffprobe',
    [
      '-v',
      profile.logLevel ?? 'error',
      /^rtsps?:/i.test(url) ? '-timeout' : '-rw_timeout',
      '15000000',
      ...(token ? ['-headers', `Authorization: Bearer ${token}\r\n`] : []),
      '-analyzeduration',
      '8000000',
      ...mediaInputArguments(probeProfile),
      '-probesize',
      '8000000',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'json',
      url,
    ],
    { ...options, timeout: options.timeout ?? 20000, signal },
  );
  const streams = (
    JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: string }>;
    }
  ).streams;
  return streams?.some((stream) => stream.codec_type === 'audio') ?? false;
}
