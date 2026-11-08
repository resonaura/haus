/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { expect, test } from 'vitest';
import assert from 'node:assert/strict';
import { parseHostCpuModel, parseHostProc } from '../../src/os.js';

const meminfo = 'MemTotal: 8000 kB\nMemAvailable: 3000 kB\nSwapTotal: 2000 kB\nSwapFree: 1500 kB\n';

test('host CPU/memory parsing measures kernel totals and does not substitute core container memory', () => {
  const sample = parseHostProc(
    'cpu 100 20 30 400 10 2 3 0 0 0\ncpu0 1\ncpu1 1\n',
    meminfo,
    '100.25 2',
  );
  assert.deepEqual(sample.cpuTimes, { total: 565, idle: 410 });
  assert.equal(sample.logicalCores, 2);
  assert.equal(sample.memory.totalBytes, 8000 * 1024);
  assert.equal(sample.memory.usedBytes, 5000 * 1024);
  assert.equal(sample.swap.usedBytes, 500 * 1024);
  assert.equal(sample.uptimeSeconds, 100.25);
  assert.equal(parseHostProc('', '', '').memory.totalBytes, null);
});

test('identifies Raspberry Pi ARM CPU models from Linux procfs core identifiers', () => {
  assert.equal(
    parseHostCpuModel(
      'processor : 0\nCPU implementer : 0x41\nCPU part : 0xd08\n' +
        'processor : 1\nCPU implementer : 0x41\nCPU part : 0xd08\n',
    ),
    'ARM Cortex-A72',
  );
  assert.equal(
    parseHostCpuModel('processor : 0\nCPU implementer : 0x41\nCPU part : 0xd0b\n'),
    'ARM Cortex-A76',
  );
  assert.equal(parseHostCpuModel(''), null);
});

test.each(['', ' ', '\n\t'])(
  'does not report a fresh boot when uptime is missing (%j)',
  (uptime) => {
    expect(parseHostProc('', meminfo, uptime).uptimeSeconds).toBeNull();
  },
);

test('preserves a measured zero uptime and rejects malformed or negative samples', () => {
  expect(parseHostProc('', meminfo, '0 12').uptimeSeconds).toBe(0);
  expect(parseHostProc('', meminfo, '-1').uptimeSeconds).toBeNull();
  expect(parseHostProc('', meminfo, 'invalid').uptimeSeconds).toBeNull();
  expect(parseHostProc('', meminfo, 'Infinity').uptimeSeconds).toBeNull();
});

test('keeps fallback memory totals, missing counters and unavailable swap honest', () => {
  const sample = parseHostProc(
    'cpu 1 2 3\n',
    'MemTotal: 100 kB\nMemFree: 10 kB\nBuffers: 5 kB\nCached: 25 kB\n',
    '3',
  );
  expect(sample.cpuTimes).toBeNull();
  expect(sample.logicalCores).toBeNull();
  expect(sample.memory).toEqual({ totalBytes: 102400, availableBytes: 40960, usedBytes: 61440 });
  expect(sample.swap).toEqual({ supported: false, totalBytes: null, usedBytes: null });
});
