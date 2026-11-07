/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { required } from '../support/report.js';
import { snapshot } from '../support/report.js';

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { HostTelemetry, sanitizeHostReport } from '../../src/index.js';

test('unavailable native Windows queries leave an explicit WSL fallback without invented physical disks', async () => {
  const commands: string[] = [];
  const system = {
    cpus: () => [{ model: 'CPU', times: { user: 1, idle: 9 } }],
    totalmem: () => 1000,
    freemem: () => 500,
    release: () => '6.6.87.2-microsoft-standard-WSL2',
    hostname: () => 'host',
    arch: () => 'x64',
    uptime: () => 100,
    loadavg: () => [0, 0, 0],
  };
  const telemetry = new HostTelemetry({
    platform: 'linux',
    container: false,
    system,
    read: async () => '',
    run: async (file) => {
      commands.push(file);
      return JSON.stringify({
        blockdevices: [{ name: 'sda', type: 'disk', size: 1000, tran: 'scsi' }],
      });
    },
  });
  await telemetry.initialize({ poll: false });
  assert.equal(snapshot(telemetry.status()).platform, 'linux');
  assert.match(snapshot(telemetry.status()).release, /WSL2/);
  assert.equal(snapshot(telemetry.status()).disks[0].physical, false);
  assert.deepEqual(commands, [
    'lsblk',
    '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
    '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
    '/usr/bin/wslpath',
    '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
  ]);
  telemetry.stop();
});

test('WSL collector uses real Windows disk relationships but retains Linux scope and WSL filesystem details', async () => {
  let now = 1000,
    failed = false;
  const system = {
    cpus: () => [{ model: 'CPU', times: { user: 1, idle: 9 } }],
    totalmem: () => 1000,
    freemem: () => 500,
    release: () => '6.6.87.2-microsoft-standard-WSL2',
    hostname: () => 'host',
    arch: () => 'x64',
    uptime: () => 100,
    loadavg: () => [0, 0, 0],
  };
  const telemetry = new HostTelemetry({
    platform: 'linux',
    container: false,
    system,
    now: () => now,
    read: async () => '',
    list: async () => [],
    run: async (file) => {
      if (file === 'lsblk')
        return JSON.stringify({
          blockdevices: [
            {
              name: 'sda',
              type: 'disk',
              size: 1081,
              tran: 'scsi',
              fstype: 'ext4',
              mountpoints: ['/'],
            },
          ],
        });
      if (failed) throw Error('CIM temporarily unavailable');
      if (file === '/usr/bin/wslpath') throw Error('Interop root unavailable');
      assert.equal(file, '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe');
      return JSON.stringify({
        Disks: [
          {
            Index: 0,
            Model: 'Actual SSD',
            Size: 256,
            Partitions: [
              {
                Index: 0,
                Size: 254,
                Volumes: [{ DeviceID: 'C:', Size: 254, FreeSpace: 62 }],
              },
            ],
          },
        ],
      });
    },
  });
  await telemetry.initialize({ poll: false });
  const report = snapshot(telemetry.status());
  assert.equal(report.platform, 'linux');
  assert.match(report.release, /WSL2/);
  assert.deepEqual(
    report.disks.map((disk) => disk.type),
    ['disk', 'partition', 'volume', 'container'],
  );
  assert.equal(report.disks[0].physical, true);
  assert.equal(report.disks[0].totalBytes, 256);
  assert.equal(required(report.disks.at(-1)).id, 'wsl:root');
  assert.equal(required(report.disks.at(-1)).mountpoint, '/');
  assert.equal(required(report.disks.at(-1)).physical, false);
  now = 2000;
  failed = true;
  await telemetry.sample();
  assert.equal(snapshot(telemetry.status()), report);
  assert.equal(snapshot(telemetry.status()).sampledAt, new Date(1000).toISOString());
  now = 40000;
  await telemetry.sample();
  await telemetry.inventoryRefresh;
  assert.throws(() => sanitizeHostReport(snapshot(telemetry.status()), now), /invalid_host_report/);
  failed = false;
  now = 50000;
  await telemetry.sample();
  await telemetry.inventoryRefresh;
  assert.equal(snapshot(telemetry.status()).sampledAt, new Date(now).toISOString());
  telemetry.stop();
});
