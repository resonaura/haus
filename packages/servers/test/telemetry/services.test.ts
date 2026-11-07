/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command, dockerTelemetry, memorySize, pm2Telemetry } from '../../src/index.js';

test('Docker inventory tolerates slow daemon replies within a bounded background budget', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'haus-slow-docker-'));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const fixture = join(root, 'daemon.ts');
  await writeFile(
    fixture,
    `
    const operation = process.argv[2];
    if (['ps', 'stats', 'info'].includes(operation))
      await new Promise(resolve => setTimeout(resolve, 2800));
    console.log(JSON.stringify(operation === 'ps'
      ? {ID:'fixture',Names:'home-service',Image:'fixture',State:'running',Status:'Up'}
      : operation === 'stats'
        ? {ID:'fixture',CPUPerc:'25%',MemUsage:'64MiB / 1GiB'}
        : {OSType:'linux'}));
  `,
  );
  const docker = await dockerTelemetry((_file, args, options) =>
    command(process.execPath, [fixture, ...args], options),
  );
  assert.equal(docker.available, true);
  assert.equal(docker.cpuPercentBasis, 'core');
  assert.equal(docker.containers[0].cpuPercent, 25);
  assert.equal(docker.containers[0].memoryUsedBytes, 64 * 1024 ** 2);
}, 15_000);

test('Docker/PM2 collectors expose status only and never start a stopped PM2 daemon', async () => {
  const docker = await dockerTelemetry(async (file, args) => {
    assert.equal(file, 'docker');
    assert.ok(!args.includes('inspect'));
    return args[0] === 'ps'
      ? JSON.stringify({
          ID: 'abc',
          Names: 'haus',
          Image: 'haus:latest',
          State: 'running',
          Status: 'Up',
        })
      : JSON.stringify({
          ID: 'abc',
          CPUPerc: '12.5%',
          MemUsage: '125MiB / 1GiB',
        });
  });
  assert.equal(docker.containers[0].cpuPercent, 12.5);
  assert.equal(docker.containers[0].memoryUsedBytes, 125 * 1024 ** 2);
  assert.equal(memorySize('1.5 GB'), 1500000000);
  const pm2 = await pm2Telemetry({
    read: async () => '42',
    alive: () => {},
    now: 10000,
    run: async () =>
      JSON.stringify([
        {
          pm_id: 1,
          name: 'helper',
          pid: 43,
          monit: { cpu: 4, memory: 1024 },
          pm2_env: {
            status: 'online',
            pm_uptime: 5000,
            restart_time: 2,
            SECRET: 'private',
            args: 'private',
          },
        },
      ]),
  });
  assert.equal(pm2.processes[0].uptimeSeconds, 5);
  assert.equal(pm2.processes[0].restarts, 2);
  assert.ok(!JSON.stringify(pm2).includes('private'));
  let invoked = false;
  const stopped = await pm2Telemetry({
    read: async () => {
      throw new Error('ENOENT');
    },
    run: async () => {
      invoked = true;
      return '[]';
    },
  });
  assert.equal(stopped.available, false);
  assert.equal(invoked, false);
});
