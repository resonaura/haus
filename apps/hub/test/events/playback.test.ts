/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  inspectCadence,
  playbackArguments,
  runMedia,
} from '../../src/events/recorder/compatible.js';

describe('playback cadence and arguments', () => {
  it('produces compatibility output with regular timestamps and bounded keyframes without overwriting the source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-cadence-'));
    try {
      const input = join(root, 'source.mp4');
      const output = join(root, 'playback.mp4');
      await runMedia('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=160x90:rate=20',
        '-t',
        '3',
        '-vf',
        "select='not(between(t,1,2))'",
        '-fps_mode',
        'vfr',
        '-c:v',
        'libx264',
        input,
      ]);
      const before = await inspectCadence(input);
      expect(before.largestGap).toBeGreaterThanOrEqual(1);
      await runMedia('ffmpeg', ['-v', 'error', '-y', '-i', input, ...playbackArguments(), output]);
      expect((await inspectCadence(output)).largestGap).toBe(0);
      expect((await stat(input)).size).toBeGreaterThan(0);
      expect((await stat(output)).size).toBeGreaterThan(0);
      const frames = await runMedia('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'frame=key_frame,best_effort_timestamp_time',
        '-of',
        'json',
        output,
      ]);
      const parsed = JSON.parse(frames.stdout) as {
        frames: Array<{ key_frame?: number; best_effort_timestamp_time?: string }>;
      };
      const times = parsed.frames
        .filter((frame) => frame.key_frame)
        .map((frame) => Number(frame.best_effort_timestamp_time));
      expect(times.length).toBeGreaterThanOrEqual(2);
      expect(times.slice(1).every((at, i) => at - (times[i] ?? 0) <= 2.01)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
