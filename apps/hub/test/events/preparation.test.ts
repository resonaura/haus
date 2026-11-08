/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { setTimeout as pause } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { PlaybackPreparation, type PlaybackPreparationOptions } from '../../src/events/playback.js';

describe('PlaybackPreparation', () => {
  it('cannot mark unprepared footage ready or enqueue fictitious work without a worker', () => {
    const preparation = new PlaybackPreparation();
    expect(preparation.status({ id: 'unprepared', playbackVersion: 0 })).toBe('failed');
    expect(preparation.jobs.size).toBe(0);
  });

  it('bounds pending work, promotes a selected event and reclaims completed entries', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const priorities: number[] = [];
    const prepare = new PlaybackPreparation(
      {
        preparePlayback: (_event, priority) => {
          priorities.push(priority);
          return pending;
        },
      },
      { limit: 1 },
    );
    const event = { id: 'event', playbackVersion: 0 };
    expect(prepare.status(event, 0)).toBe('preparing');
    await pause(0);
    expect(prepare.status(event, 20)).toBe('preparing');
    expect(priorities).toEqual([0, 20]);
    expect(prepare.status({ id: 'other' }, 20)).toBe('busy');
    finish();
    await pause(0);
    expect(prepare.status(event, 20)).toBe('ready');
    expect(prepare.status({ id: 'other', playbackVersion: 4 }, 20)).toBe('ready');
    expect(prepare.status({ id: 'third' }, 20)).toBe('preparing');
    prepare.clear();
    expect(prepare.jobs.size).toBe(0);
  });

  it('catches, redacts, and holds failed work briefly rather than repeatedly restarting', async () => {
    const warnings: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      let now = 0;
      let calls = 0;
      const prepare = new PlaybackPreparation(
        {
          preparePlayback: async () => {
            calls++;
            throw new Error('rtsp://secret:credential@private-camera/live');
          },
        },
        { now: () => now },
      );
      const event = { id: 'event' };
      expect(prepare.status(event, 20)).toBe('preparing');
      await pause(0);
      expect(prepare.status(event, 20)).toBe('failed');
      expect(calls).toBe(1);
      expect(JSON.stringify(warnings)).not.toContain('credential');
      now = 5000;
      expect(prepare.status(event, 20)).toBe('preparing');
      await pause(0);
      expect(calls).toBe(2);
    } finally {
      console.warn = warn;
    }
  });

  it('does not reuse the original ready marker on explicit repair and coalesces polling until a copy exists', async () => {
    let finish!: () => void;
    let options: PlaybackPreparationOptions | undefined;
    const promise = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const prepare = new PlaybackPreparation({
      preparePlayback: async (_event, _priority, input) => {
        options = input;
        await promise;
      },
    });
    const event = { id: 'source', playbackVersion: 4, playbackBytes: 0 };
    expect(prepare.status(event, 20)).toBe('ready');
    expect(prepare.status(event, 20, { forceCompatibility: true })).toBe('preparing');
    await pause(0);
    expect(options?.forceCompatibility).toBe(true);
    expect(prepare.status(event, 20)).toBe('preparing');
    expect(prepare.status(event, 20, { forceCompatibility: true })).toBe('preparing');
    finish();
    await pause(0);
    expect(
      prepare.status(
        {
          ...event,
          playbackBytes: 100,
          playbackInfo: { compatibilityRepaired: true },
        },
        20,
        {
          forceCompatibility: true,
        },
      ),
    ).toBe('ready');
  });

  it('revalidates old packet-only ready originals while normalized copies stay immediately ready', async () => {
    const calls: string[] = [];
    const prepare = new PlaybackPreparation({
      preparePlayback: async (event) => {
        calls.push(event.id);
      },
    });
    const unsafe = {
      id: 'old-packet-only',
      playbackVersion: 4,
      playbackBytes: 0,
      playbackInfo: { originalCompatible: true },
    };
    expect(prepare.status(unsafe, 20)).toBe('preparing');
    expect(prepare.status({ ...unsafe, id: 'normalized', playbackBytes: 100 }, 20)).toBe('ready');
    expect(
      prepare.status(
        {
          ...unsafe,
          id: 'our-encoder',
          playbackInfo: { originalCompatible: false },
        },
        20,
      ),
    ).toBe('ready');
    await pause(0);
    expect(calls).toEqual([unsafe.id]);
  });
});
