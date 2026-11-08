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
  compatiblePackets,
  hasFrontIndex,
  inspectOriginalPlayback,
  runMedia,
  trustedOriginalParameters,
  type OriginalPlaybackProvenance,
  type ProbedOriginalPlaybackInfo,
  type VideoStreamParameters,
} from '../../src/events/recorder/compatible.js';

const encoder: OriginalPlaybackProvenance = { kind: 'haus-encoder', profile: 1 };

const good = (): {
  streams: [VideoStreamParameters, VideoStreamParameters];
  packets: Array<{
    stream_index: number;
    pts_time: string;
    dts_time: string;
    flags: string;
  }>;
} => ({
  streams: [
    {
      index: 0,
      codec_type: 'video',
      codec_name: 'h264',
      pix_fmt: 'yuv420p',
      profile: 'High',
      start_time: '0',
      duration: '2',
    },
    {
      index: 1,
      codec_type: 'audio',
      codec_name: 'aac',
      start_time: '0',
      duration: '2',
    },
  ],
  packets: Array.from({ length: 40 }, (_, i) => ({
    stream_index: 0,
    pts_time: String(i / 20),
    dts_time: String(i / 20),
    flags: i % 20 === 0 ? 'K_' : '__',
  })),
});

describe('compatible original playback inspection', () => {
  it('only admits compatible indexed packets with short GOPs, continuous timestamps and aligned real audio', () => {
    expect(compatiblePackets(good(), {}, encoder)).toBe(true);
    for (const mutate of [
      (x: ReturnType<typeof good>) => {
        x.streams[0].codec_name = 'hevc';
      },
      (x: ReturnType<typeof good>) => {
        x.streams[0].pix_fmt = 'yuv420p10le';
      },
      (x: ReturnType<typeof good>) => {
        x.streams[0].profile = 'High 4:4:4 Predictive';
      },
      (x: ReturnType<typeof good>) => {
        x.streams[1].codec_name = 'pcm_alaw';
      },
      (x: ReturnType<typeof good>) => {
        x.streams[1].start_time = '1';
      },
      (x: ReturnType<typeof good>) => {
        x.streams[1].duration = '20';
      },
      (x: ReturnType<typeof good>) => {
        x.packets[0]!.flags = '__';
      },
      (x: ReturnType<typeof good>) => {
        x.packets[12]!.dts_time = '0';
      },
      (x: ReturnType<typeof good>) => {
        x.packets.splice(10, 25);
      },
      (x: ReturnType<typeof good>) => {
        x.streams[0].duration = '8';
      },
    ]) {
      const input = good();
      mutate(input);
      expect(compatiblePackets(input as ProbedOriginalPlaybackInfo, {}, encoder)).toBe(false);
    }
    expect(compatiblePackets(good(), { audioTrimSeconds: 1 }, encoder)).toBe(false);
    expect(compatiblePackets(good(), { audioTailSeconds: 5 }, encoder)).toBe(false);
  });

  it('admits a real H264/AAC faststart original without compatibility encode, while tail-indexed originals keep fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-original-playback-'));
    try {
      const file = join(root, 'fast.mp4');
      const tail = join(root, 'tail.mp4');
      await runMedia('ffmpeg', [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=160x90:rate=20',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000',
        '-t',
        '2',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-g',
        '20',
        '-bf',
        '0',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        file,
      ]);
      const original = await readFile(file);
      expect(await inspectOriginalPlayback(file, {}, encoder)).toBe(true);
      expect(await readFile(file)).toEqual(original);
      await runMedia('ffmpeg', ['-v', 'error', '-i', file, '-c', 'copy', tail]);
      expect(await hasFrontIndex(tail)).toBe(false);
      expect(await inspectOriginalPlayback(tail, {}, encoder)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ensures packet timing cannot confer trust on an unknown or unproven Aqara bitstream', () => {
    expect(compatiblePackets(good())).toBe(false);
    for (const provenance of [
      undefined,
      {
        kind: 'camera',
        platform: 'mqtt',
        manufacturer: 'Aqara',
        model: 'Camera E1',
      },
      {
        kind: 'camera',
        platform: 'mqtt',
        manufacturer: 'Aqara',
        model: 'Camera Hub G5 Pro (Wi-Fi)',
      },
    ] satisfies Array<OriginalPlaybackProvenance | undefined>) {
      const info = good();
      Object.assign(info.streams[0], {
        profile: 'Main',
        level: 50,
        width: 2688,
        height: 1520,
        has_b_frames: 0,
      });
      expect(compatiblePackets(info, {}, provenance)).toBe(false);
    }
    const provenEufy: OriginalPlaybackProvenance = {
      kind: 'camera',
      platform: 'eufy_security',
      manufacturer: 'Eufy Security',
      model: 'T8410C',
    };
    const info = good();
    Object.assign(info.streams[0], {
      profile: 'High',
      level: 42,
      width: 1920,
      height: 1080,
      has_b_frames: 0,
    });
    expect(compatiblePackets(info, {}, provenEufy)).toBe(true);
    for (const change of [
      { profile: 'Main' },
      { level: 50 },
      { width: 2688 },
      { has_b_frames: 2 },
    ]) {
      expect(trustedOriginalParameters({ ...info.streams[0], ...change }, provenEufy)).toBe(false);
    }
    expect(compatiblePackets(info, {}, { ...provenEufy, model: 'Unknown' })).toBe(false);
    expect(compatiblePackets(info, {}, { ...provenEufy, platform: 'generic' })).toBe(false);
  });
});
