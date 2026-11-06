/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { test, expect } from 'vitest';
import { RecordingIndex } from '../../src/nvr/recording-index.js';

interface IndexFixture {
  index: RecordingIndex;
  event: {
    id: string;
    cameraId: string;
    startAt: number;
    endAt: number;
    duration: number;
    kinds: string[];
  };
  add: (patch?: Record<string, unknown>) => Promise<void>;
}

function fixture(): IndexFixture {
  const index = new RecordingIndex(':memory:', {
    info: async () => ({ size: 10 }),
  });
  const event = {
    id: 'a'.repeat(36),
    cameraId: 'camera.fixture',
    startAt: 1000,
    endAt: 2000,
    duration: 1,
    kinds: [],
  };
  const add = async (patch: Record<string, unknown> = {}) => {
    await index.add({
      event,
      digest: 'b'.repeat(64),
      ...patch,
    });
    return;
  };
  return { index, event, add };
}

test('recording cursor pagination does not lose equal-time clips', async () => {
  const index = new RecordingIndex(':memory:', {
    info: async () => ({ size: 10 }),
  });
  try {
    for (let i = 0; i < 201; i++)
      await index.add({
        digest: 'a'.repeat(64),
        event: {
          id: i.toString(16).padStart(36, '0'),
          cameraId: 'camera.fixture',
          startAt: 1000,
          endAt: 2000,
          duration: 1,
          kinds: ['motion'],
          playbackVersion: 2,
        },
      });
    const first = index.list();
    const last = index.list(first.nextCursor ?? '');
    expect(first.items).toHaveLength(200);
    expect(last.items).toHaveLength(1);
    expect(
      new Set([...first.items, ...last.items].map((item) => item.id)).size,
    ).toBe(201);
    expect(last.nextCursor).toBeNull();
    expect(() => index.list('not-a-cursor')).toThrow(/invalid_cursor/);
  } finally {
    index.close();
  }
});

test('storage references preserve exact original/prepared roles without accepting arbitrary metadata', async () => {
  const { index, add } = fixture();
  try {
    await add({ variant: 'prepared', originalDigest: 'c'.repeat(64) });
    expect(index.get('a'.repeat(36))?.originalDigest).toBe('c'.repeat(64));
    expect(index.get('a'.repeat(36))?.storageVariant).toBe('prepared');
    await expect(
      index.add({
        event: {
          id: 'a'.repeat(36),
          cameraId: 'camera.fixture',
          startAt: 1000,
          endAt: 2000,
          duration: 1,
          kinds: [],
        },
        digest: 'b'.repeat(64),
        variant: 'prepared',
        originalDigest: 'not-a-digest',
      }),
    ).rejects.toThrow(/invalid_recording_metadata/);
    await expect(
      index.add({
        event: {
          id: 'a'.repeat(36),
          cameraId: 'camera.fixture',
          startAt: 1000,
          endAt: 2000,
          duration: 1,
          kinds: [],
        },
        digest: 'b'.repeat(64),
        variant: 'guess',
      }),
    ).rejects.toThrow(/invalid_recording_metadata/);
  } finally {
    index.close();
  }
});

test('replicates corrected playback timing and bounded repair diagnostics', async () => {
  const index = new RecordingIndex(':memory:', {
    info: async () => ({ size: 10 }),
  });
  try {
    await index.add({
      digest: 'a'.repeat(64),
      event: {
        id: 'a'.repeat(36),
        cameraId: 'camera.fixture',
        startAt: 1000,
        endAt: 3000,
        duration: 2,
        originalDuration: 1002,
        kinds: ['motion'],
        playbackVersion: 3,
        playbackInfo: {
          audio: true,
          duration: 2,
          audioTrimSeconds: 1000,
          audioTailSeconds: -1,
          sourceGaps: Array.from({ length: 100 }, () => ({ at: 1, duration: 2 })),
          privateField: 'omitted',
        },
      },
    });
    const item = index.get('a'.repeat(36));
    expect(item?.originalDuration).toBe(1002);
    expect(item?.playbackInfo).toEqual({
      audio: true,
      duration: 2,
      audioTrimSeconds: 1000,
    });
  } finally {
    index.close();
  }
});

test('archive provenance preserves explicit compatibility fields without trusting legacy packet versions', async () => {
  const index = new RecordingIndex(':memory:', {
    info: async () => ({ size: 10 }),
  });
  const base = {
    id: 'a'.repeat(36),
    cameraId: 'camera.fixture',
    startAt: 1000,
    endAt: 2000,
    duration: 1,
    kinds: ['motion'],
    playbackVersion: 4,
  };
  try {
    await index.add({
      digest: 'a'.repeat(64),
      event: {
        ...base,
        playbackInfo: {
          originalCompatible: false,
          originalPolicyVersion: 1,
          compatibilityRepaired: true,
          originalProvenance: {
            kind: 'camera',
            platform: 'mqtt',
            manufacturer: 'Aqara',
            model: 'G5 Pro',
            token: 'do-not-copy',
          },
        },
      },
    });
    expect(index.get(base.id)?.playbackInfo).toEqual({
      originalCompatible: false,
      originalPolicyVersion: 1,
      compatibilityRepaired: true,
      originalProvenance: {
        kind: 'camera',
        platform: 'mqtt',
        manufacturer: 'Aqara',
        model: 'G5 Pro',
      },
    });
    await index.add({
      digest: 'a'.repeat(64),
      event: { ...base, playbackInfo: { audio: true } },
    });
    expect(index.get(base.id)?.playbackInfo).toEqual({ audio: true });
    await index.add({
      digest: 'a'.repeat(64),
      event: {
        ...base,
        playbackInfo: {
          originalCompatible: true,
          originalPolicyVersion: 1,
          originalProvenance: {
            kind: 'haus-encoder',
            profile: 1,
            encoderArgs: 'do-not-copy',
          },
        },
      },
    });
    expect(index.get(base.id)?.playbackInfo).toEqual({
      originalCompatible: true,
      originalPolicyVersion: 1,
      originalProvenance: { kind: 'haus-encoder', profile: 1 },
    });
  } finally {
    index.close();
  }
});

test('archive provenance rejects unknown policies/profiles and bounds camera labels', async () => {
  const index = new RecordingIndex(':memory:', {
    info: async () => ({ size: 10 }),
  });
  const base = {
    id: 'a'.repeat(36),
    cameraId: 'camera.fixture',
    startAt: 1000,
    endAt: 2000,
    duration: 1,
    kinds: ['motion'],
  };
  try {
    await index.add({
      digest: 'a'.repeat(64),
      event: {
        ...base,
        playbackInfo: {
          originalCompatible: 'true',
          originalPolicyVersion: 2,
          compatibilityRepaired: 1,
          originalProvenance: { kind: 'haus-encoder', profile: 99 },
        },
      },
    });
    expect(index.get(base.id)?.playbackInfo).toEqual({});
    await index.add({
      digest: 'a'.repeat(64),
      event: {
        ...base,
        playbackInfo: {
          originalProvenance: {
            kind: 'camera',
            manufacturer: `\u0000${'a'.repeat(300)}`,
            platform: 42,
            model: 'Camera\nModel',
          },
        },
      },
    });
    expect(index.get(base.id)?.playbackInfo).toEqual({
      originalProvenance: {
        kind: 'camera',
        manufacturer: 'a'.repeat(160),
        model: 'CameraModel',
      },
    });
  } finally {
    index.close();
  }
});
