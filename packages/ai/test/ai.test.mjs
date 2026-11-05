/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Capacity, Detectors } from '../dist/index.js';

describe('@haus/ai contracts', () => {
  it('bounds capacity by container quotas and pressure', async (t) => {
    let used = 100 * 1024 ** 2;
    const values = {
      'cpu.max': '75000 100000',
      'memory.max': String(512 * 1024 ** 2),
      'cpu.stat': 'usage_usec 1',
    };
    const capacity = await new Capacity({
      cpus: 32,
      memory: 64 * 1024 ** 3,
      read: async (path) =>
        path.endsWith('memory.current') ? String(used) : (values[path.split('/').at(-1)] ?? ''),
    }).initialize();
    t.after(() => capacity.stop());

    assert.equal(capacity.cpus, 0.75);
    assert.equal(capacity.memory, 512 * 1024 ** 2);
    assert.equal(capacity.streams, 1);
    assert.equal(capacity.detectors, 1);
    assert.equal(capacity.pressured, false);

    used = 480 * 1024 ** 2;
    await capacity.sample();
    assert.equal(capacity.pressured, true);

    values['memory.stat'] =
      `anon ${100 * 1024 ** 2}\ninactive_file ${380 * 1024 ** 2}\nshmem ${10 * 1024 ** 2}\n`;
    await capacity.sample();
    assert.equal(capacity.memoryUsed, 100 * 1024 ** 2);
    assert.equal(capacity.pressured, false);
    assert.equal(capacity.status().memoryCurrentBytes, used);
  });

  it('measures host PSI pressure without stopping camera capacity', async (t) => {
    let memory = 'full avg10=0.10 avg60=0.00 avg300=0.00 total=1',
      io = 'full avg10=25.00 avg60=0.00 avg300=0.00 total=1';
    const capacity = await new Capacity({
      cpus: 2,
      memory: 1024 ** 3,
      read: async (path) =>
        path === '/proc/pressure/memory' ? memory : path === '/proc/pressure/io' ? io : '',
    }).initialize();
    t.after(() => capacity.stop());

    assert.equal(capacity.pressured, false);
    assert.equal(capacity.analysisPressured, true);
    assert.equal(capacity.status().hostPressure?.ioFull, 25);

    io = 'full avg10=1.00 avg60=0.00 avg300=0.00 total=1';
    memory = 'full avg10=5.01 avg60=0.00 avg300=0.00 total=1';
    await capacity.sample();
    assert.equal(capacity.analysisPressured, true);

    memory = io = 'unsupported';
    await capacity.sample();
    assert.equal(capacity.status().hostPressure?.memoryFull, null);
    assert.equal(capacity.analysisPressured, false);
    assert.equal(capacity.streams, 4);
  });

  it('validates detector source URLs and bounds jobs', async () => {
    let now = 1000;
    const detectors = new Detectors(
      'http://127.0.0.1:8080',
      {
        pressured: false,
        detectors: 2,
        memoryUsed: 100,
        memory: 1000,
      },
      {
        worker: () => ({
          state: 'running',
          lastFrame: now,
          lastResult: now,
          calibrated: true,
          stop: async () => {},
        }),
        now: () => now,
      },
    );
    detectors.supported = true;

    // Invalid origin throws
    assert.throws(
      () =>
        detectors.start(
          'http://evil.com/cluster/source/0123456789abcdef0123456789abcdef0123456789abcdef/feed.m3u8',
        ),
      /invalid_detector_source/,
    );

    // Valid origin starts job
    const job = detectors.start(
      'http://127.0.0.1:8080/cluster/source/0123456789abcdef0123456789abcdef0123456789abcdef/feed.m3u8',
      'objects',
    );
    assert.ok(job.id);
    assert.equal(detectors.status().active, 1);

    await detectors.remove(job.id);
    assert.equal(detectors.status().active, 0);
  });

  it('prunes expired detector jobs under pressure', async () => {
    let now = 1000;
    let stopped = false;
    const capacity = {
      pressured: false,
      analysisPressured: false,
      detectors: 2,
      memoryUsed: 100,
      memory: 1000,
    };
    const detectors = new Detectors('http://127.0.0.1:8080', capacity, {
      worker: () => ({
        state: 'running',
        lastFrame: now,
        lastResult: now,
        calibrated: true,
        stop: async () => {
          stopped = true;
        },
      }),
      now: () => now,
    });
    detectors.supported = true;

    detectors.start(
      'http://127.0.0.1:8080/cluster/source/0123456789abcdef0123456789abcdef0123456789abcdef/feed.m3u8',
    );
    assert.equal(detectors.jobs.size, 1);

    // Under pressure for > 20000ms prunes job
    capacity.analysisPressured = true;
    await detectors.prune();
    assert.equal(detectors.jobs.size, 1); // just started pressure

    now += 21000;
    await detectors.prune();
    assert.equal(detectors.jobs.size, 0);
    assert.equal(stopped, true);
  });
});
