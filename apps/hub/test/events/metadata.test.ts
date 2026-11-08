/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import {
  ORIGINAL_POLICY_VERSION,
  PLAYBACK_VERSION,
  playbackReady,
} from '../../src/events/playback.js';
import { recordingMetadata } from '../../src/events/recording-metadata.js';
import { recordingProvenance } from '../../src/nvr/recording-provenance.js';

const base = {
  id: 'fixture',
  cameraId: 'camera.fixture',
  startAt: 1,
  endAt: 2,
  duration: 1,
  kinds: ['motion'],
};

describe('recording replication metadata', () => {
  it('keeps the installed original-policy version that persisted rows and replicas carry', () => {
    expect(PLAYBACK_VERSION).toBe(4);
    expect(ORIGINAL_POLICY_VERSION).toBe(1);
  });

  it('stays in lockstep with the NVR provenance policy version', () => {
    expect(
      recordingProvenance({
        originalCompatible: true,
        originalPolicyVersion: ORIGINAL_POLICY_VERSION,
      }).originalPolicyVersion,
    ).toBe(ORIGINAL_POLICY_VERSION);
  });

  it('never advertises old packet-only originals as normalized playback', () => {
    const event = {
      ...base,
      playbackVersion: 4,
      playbackBytes: 0,
      playbackInfo: { originalCompatible: true },
    };
    expect(recordingMetadata(event).playbackVersion).toBe(0);
    expect(recordingMetadata({ ...event, playbackBytes: 100 }).playbackVersion).toBe(4);
    const trusted = recordingMetadata({
      ...event,
      playbackInfo: {
        originalCompatible: true,
        originalPolicyVersion: 1,
        originalProvenance: {
          kind: 'camera',
          platform: 'eufy_security',
          manufacturer: 'Eufy Security',
          model: 'T8410C',
        },
      },
    });
    expect(trusted.playbackVersion).toBe(4);
    expect(
      (trusted.playbackInfo as { originalProvenance: { model: string } }).originalProvenance.model,
    ).toBe('T8410C');
  });

  it('treats a trusted policy-1 original as ready and other policy versions as stale', () => {
    const event = { ...base, playbackVersion: 4, playbackBytes: 0 };
    expect(
      playbackReady({
        ...event,
        playbackInfo: { originalCompatible: true, originalPolicyVersion: 1 },
      }),
    ).toBe(true);
    for (const stale of [0, 2, 3, undefined])
      expect(
        playbackReady({
          ...event,
          playbackInfo: { originalCompatible: true, originalPolicyVersion: stale },
        }),
      ).toBe(false);
  });

  it('keeps a five-minute motion burst bounded and rounds the media start', () => {
    const metadata = recordingMetadata({
      ...base,
      mediaStartAt: 100.4,
      startAt: 8100,
      endAt: 20000,
      duration: 20,
      detections: Array(500).fill({ kind: 'person' }),
      playbackInfo: { audio: true, sourceGaps: Array(100).fill({ at: 2, duration: 3 }) },
    } as typeof base & Record<string, unknown>);
    expect(metadata.mediaStartAt).toBe(100);
    expect((metadata.playbackInfo as { audio: boolean }).audio).toBe(true);
    expect(JSON.stringify(metadata).length).toBeLessThan(1000);
  });
});
