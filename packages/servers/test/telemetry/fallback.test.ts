/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { record, snapshot } from '../support/report.js';

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostTelemetry, readHostReport } from '../../src/index.js';

import { sample } from './support.js';
test('stale external telemetry falls back to container quotas and only the mounted data volume', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'haus-host-'));
  t.onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const report = join(directory, 'host.json');
  await writeFile(report, JSON.stringify(sample()));
  const capacity = {
    status: () => ({
      cpus: 0.5,
      cpu: 0.6,
      memoryBytes: 1000,
      memoryCurrentBytes: 400,
    }),
  };
  let commands = 0;
  const telemetry = await new HostTelemetry({
    dataPath: directory,
    collectorFile: report,
    container: true,
    capacity,
    nativeServices: true,
    run: async () => {
      commands++;
      throw new Error('forbidden');
    },
    read: async () => '0',
  }).initialize();
  t.onTestFinished(() => telemetry.stop());
  assert.equal(snapshot(telemetry.status()).scope, 'host');
  await writeFile(
    report,
    JSON.stringify({
      ...sample(),
      sampledAt: new Date(Date.now() - 60000).toISOString(),
    }),
  );
  await telemetry.sample();
  assert.equal(snapshot(telemetry.status()).scope, 'container');
  assert.equal(snapshot(telemetry.status()).cpu.logicalCores, 0.5);
  assert.equal(snapshot(telemetry.status()).cpu.usage, 0.6);
  assert.equal(snapshot(telemetry.status()).memory.totalBytes, 1000);
  assert.equal(snapshot(telemetry.status()).memory.usedBytes, 400);
  assert.equal(snapshot(telemetry.status()).disks.length, 1);
  assert.equal(record(snapshot(telemetry.status()).docker).available, false);
  assert.equal(commands, 0);
  await writeFile(report, 'x'.repeat(512 * 1024 + 1));
  await assert.rejects(readHostReport(report), /invalid_host_report/);
});
