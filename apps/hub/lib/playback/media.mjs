/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  inspectSourceAudio,
  probeMedia,
  runMediaProcess,
} from "@haus/media/pipeline";
export const runMedia = runMediaProcess;
export async function probe(path) {
  const info = await probeMedia(path);
  return {
    duration: info.duration,
    codec: info.videoCodec,
    audio: Boolean(info.audioCodec),
  };
}
export function parseRange(value, size) {
  if (!value) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) throw new Error("invalid_range");
  let start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  let end = match[1]
    ? match[2]
      ? Math.min(size - 1, Number(match[2]))
      : size - 1
    : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    start >= size
  )
    throw new Error("invalid_range");
  return { start, end, partial: true };
}

/** Discover late HLS audio before choosing an output stream map. No microphone is opened. */
export const sourceHasAudio = inspectSourceAudio;
