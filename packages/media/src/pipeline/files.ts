/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { createReadStream } from 'node:fs';
import type { ReadStream } from 'node:fs';
import type { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface MediaFileRange {
  start: number;
  end: number;
}

/** Opens an owned local media file for upload or playback without copying it into memory. */
export function openMediaFile(file: string, range?: MediaFileRange): ReadStream {
  return createReadStream(file, range);
}

/** Pipes an owned local media file to a transport and preserves backpressure. */
export async function pipeMediaFile(
  file: string,
  destination: Writable,
  range?: MediaFileRange,
): Promise<void> {
  await pipeline(openMediaFile(file, range), destination);
}
