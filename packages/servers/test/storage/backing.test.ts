/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { type Invocation, record, required, encodedScript } from '../support/report.js';

import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
  StorageBacking,
  sanitizeStorageBacking,
  wslStorageBacking,
  sanitizeHostReport,
} from '../../src/index.js';

const backing = (at = 10000, changes = {}) => ({
  source: 'wsl-vhd',
  device: 2112,
  sampledAt: new Date(at).toISOString(),
  totalBytes: 256000,
  availableBytes: 62000,
  volume: 'C:',
  ...changes,
});

test('WSL resolves only its exact distribution/VHD and hosting volume with bounded read-only queries', async () => {
  const calls: Invocation[] = [];
  const value = await wslStorageBacking({
    now: () => 10000,
    inspect: async (path) => {
      assert.equal(path, '/');
      return { dev: 2112 };
    },
    run: async (file, args, options) => {
      calls.push({ file, args, options: options ?? {} });
      if (file === '/usr/bin/wslpath') return '\\\\wsl.localhost\\Ubuntu\\\n';
      return JSON.stringify({
        AvailableBytes: 62000,
        TotalBytes: 256000,
        Volume: 'C:',
      });
    },
  });
  assert.deepEqual(value, backing());
  assert.equal(calls[1].options.timeout, 8000);
  assert.equal(calls[1].options.maxBuffer, 16384);
  const script = encodedScript(calls[1].args);
  assert.match(script, /\$_.DistributionName -ceq \$name/);
  assert.match(script, /Get-Volume -FilePath \$file/);
  assert.match(script, /\$base\.StartsWith/);
  assert.doesNotMatch(script, /-replace/);
  assert.match(script, /Test-Path -LiteralPath \$file -PathType Leaf/);
  assert.doesNotMatch(script, /Set-|Remove-|Resize-|Invoke-|Format-/);
  assert.ok(!JSON.stringify(value).includes('BasePath'));
  await assert.rejects(
    wslStorageBacking({ run: async () => 'C:\\wrong' }),
    /wsl_distribution_unknown/,
  );
});

test('backing capacity validates timestamps, byte counts and volume labels instead of leaking image paths', () => {
  assert.equal(
    record(sanitizeStorageBacking(backing(10000, { secret: 'path' }), 10000)).secret,
    undefined,
  );
  for (const change of [
    { device: -1 },
    { device: '2112' },
    { totalBytes: null },
    { availableBytes: 256001 },
    { availableBytes: -1 },
    { availableBytes: NaN },
    { sampledAt: new Date(41001).toISOString() },
    { sampledAt: new Date(8999).toISOString() },
  ])
    assert.throws(
      () => sanitizeStorageBacking(backing(10000, change), 40000),
      /invalid_storage_backing/,
    );
  assert.equal(
    sanitizeStorageBacking(backing(10000, { volume: 'private file path' }), 10000).volume,
    'Windows volume',
  );
});

test('admission binds the data mount to its device, requires a post-start sample and never revives stale sparse capacity', async () => {
  let at = 10000,
    dev = 2112,
    report: Record<string, unknown> | null | undefined;
  const guard = new StorageBacking('/data/blobs', () => report, {
    now: () => at,
    inspect: async () => ({ dev }),
    required: true,
  });
  assert.equal(record(required(await guard.capacity())).state, 'unavailable');
  report = { storageBacking: backing(9999) };
  assert.equal(record(required(await guard.capacity())).state, 'unavailable');
  report.storageBacking = backing();
  assert.equal(record(required(await guard.capacity())).availableBytes, 62000);
  at = 10010;
  report.storageBacking = backing(10010, {
    volume: 'D:',
    availableBytes: 40000,
  });
  assert.equal(record(required(await guard.capacity())).volume, 'D:');
  report.storageBacking = backing(10000);
  assert.equal(record(required(await guard.capacity())).state, 'unavailable');
  report.storageBacking = backing(10010);
  dev = 3000;
  assert.equal(record(required(await guard.capacity())).state, 'unavailable');
  dev = 2112;
  at = 40011;
  assert.equal(record(required(await guard.capacity())).state, 'unavailable');
  report.storageBacking = backing(at);
  assert.equal(record(required(await guard.capacity())).state, 'fresh');
  report = null;
  assert.equal(record(required(await guard.capacity())).state, 'unavailable');
  const ordinary = new StorageBacking('/data', () => null, {
    inspect: async () => ({ dev: 1 }),
  });
  assert.equal(await ordinary.capacity(), null);
});

test('host sanitizer whitelists the backing mapping and discards invalid/stale readings', () => {
  const host = {
    sampledAt: new Date(10000).toISOString(),
    scope: 'host',
    cpu: { logicalCores: 4 },
    memory: { totalBytes: 1000, usedBytes: 500, availableBytes: 500 },
    storageBacking: { ...backing(), imagePath: 'secret' },
  };
  const clean = sanitizeHostReport(host, 10000);
  assert.deepEqual(clean.storageBacking, backing());
  assert.ok(!JSON.stringify(clean).includes('secret'));
  assert.equal(
    sanitizeHostReport({ ...host, storageBacking: backing(-30000) }, 10000).storageBacking,
    undefined,
  );
});
