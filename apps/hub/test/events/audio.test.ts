/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  inspectAudioAlignment,
  playbackArguments,
  runMedia,
} from '../../src/events/recorder/compatible.js';

describe('playback audio alignment', () => {
  it('repairs a proven silent audio lead and caps playback at the actual video', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-audio-alignment-'));
    try {
      const input = join(root, 'original.mp4');
      const output = join(root, 'playback.mp4');
      await runMedia('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=160x90:rate=20:duration=2',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=500:sample_rate=16000:duration=2',
        '-af',
        'adelay=6000',
        '-c:v',
        'libx264',
        '-bf',
        '0',
        '-c:a',
        'aac',
        input,
      ]);
      const original = await readFile(input);
      const alignment = await inspectAudioAlignment(input, 2);
      expect(Math.abs((alignment.audioTrimSeconds ?? 0) - 6)).toBeLessThan(0.15);
      expect((await inspectAudioAlignment(input, 30)).audioTrimSeconds).toBeUndefined();
      await runMedia('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-i',
        input,
        ...playbackArguments({
          copyVideo: true,
          audioTrimSeconds: alignment.audioTrimSeconds,
          videoDuration: alignment.videoDuration,
        }),
        output,
      ]);
      const probe = await runMedia('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type,duration',
        '-of',
        'json',
        output,
      ]);
      const data = JSON.parse(probe.stdout) as {
        format: { duration?: string };
        streams: Array<{ codec_type?: string; duration?: string }>;
      };
      expect(Number(data.format.duration)).toBeLessThan(2.2);
      expect(data.streams.some((stream) => stream.codec_type === 'audio')).toBe(true);
      const sound = await runMedia('ffmpeg', [
        '-hide_banner',
        '-i',
        output,
        '-map',
        '0:a:0',
        '-t',
        '1',
        '-af',
        'volumedetect',
        '-f',
        'null',
        '-',
      ]);
      const volume = Number(/mean_volume:\s*(-?[\d.]+) dB/.exec(sound.stderr)?.[1]);
      expect(volume).toBeGreaterThan(-30);
      expect(await readFile(input)).toEqual(original);

      const ambiguous = join(root, 'real-audio.mp4');
      await runMedia('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=160x90:rate=20:duration=2',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=500:sample_rate=16000:duration=8',
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        ambiguous,
      ]);
      expect((await inspectAudioAlignment(ambiguous, 2)).audioTrimSeconds).toBeUndefined();
      const unchanged = await readFile(ambiguous);
      const unshifted = await inspectAudioAlignment(ambiguous, 2);
      await runMedia('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-i',
        ambiguous,
        ...playbackArguments({ videoDuration: unshifted.videoDuration }),
        output,
      ]);
      const bounded = await runMedia('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type,duration',
        '-of',
        'json',
        output,
      ]);
      const boundedInfo = JSON.parse(bounded.stdout) as {
        format: { duration?: string };
        streams: Array<{ codec_type?: string; duration?: string }>;
      };
      expect(Number(boundedInfo.format.duration)).toBeLessThan(2.2);
      expect(
        Number(boundedInfo.streams.find((s) => s.codec_type === 'audio')?.duration),
      ).toBeLessThan(2.2);
      expect(await readFile(ambiguous)).toEqual(unchanged);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ensures a short audio track cannot truncate the remaining camera video', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-short-audio-'));
    try {
      const output = join(root, 'playback.mp4');
      await runMedia('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=160x90:rate=20:duration=4',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=500:sample_rate=16000:duration=1',
        ...playbackArguments(),
        output,
      ]);
      const probe = await runMedia('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'json',
        output,
      ]);
      const parsed = JSON.parse(probe.stdout) as { format: { duration?: string } };
      const duration = Number(parsed.format.duration);
      expect(duration).toBeGreaterThanOrEqual(3.95);
      expect(duration).toBeLessThan(4.2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
