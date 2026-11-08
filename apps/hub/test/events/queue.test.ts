/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { MediaQueue } from '../../src/events/recorder/queue.js';

describe('MediaQueue', () => {
  it('runs one encoder at a time, supports foreground promotion, bounds backlog, and rejects on stop', async () => {
    const queue = new MediaQueue(3);
    const order: string[] = [];
    let release!: () => void;
    const first = queue.run(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            order.push('first');
            resolve();
          };
        }),
      0,
      'active',
    );
    const speculative = queue.run(
      async () => {
        expect(queue.activeWork?.priority).toBe(20);
        order.push('speculative');
      },
      0,
      'next',
    );
    const recorded = queue.run(
      async () => {
        order.push('recorded');
      },
      10,
      'recorded',
    );
    queue.promote('next', 20);
    expect(queue.activeWork?.priority).toBe(0);
    expect(Date.now() - (queue.activeWork?.startedAt ?? 0)).toBeLessThan(1000);
    release();
    await Promise.all([first, speculative, recorded]);
    expect(queue.activeWork).toBeUndefined();
    expect(order).toEqual(['first', 'speculative', 'recorded']);

    const blocker = queue.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = queue.run(async () => {}, 0);
    const stopped = expect(pending).rejects.toThrow(/media_stopped/);
    queue.stop();
    release();
    await blocker;
    await stopped;
    await expect(queue.run(async () => {})).rejects.toThrow(/media_stopped/);
  });
});
