/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';

import { linuxDisks, macDisks, parseMeminfo, windowsTelemetry } from '../../src/index.js';

import { type Invocation } from '../support/report.js';

test('Linux memory distinguishes available cache and swap; block disks retain volume parents', async () => {
  const info = parseMeminfo(
    'MemTotal:       1000 kB\nMemAvailable:    400 kB\nSwapTotal:       200 kB\nSwapFree:        150 kB\n',
  );
  assert.ok(info.memory);
  assert.equal(info.memory.usedBytes, 600 * 1024);
  assert.equal(info.swap.usedBytes, 50 * 1024);
  const disks = await linuxDisks({
    run: async () =>
      JSON.stringify({
        blockdevices: [
          {
            name: 'nvme0n1',
            type: 'disk',
            size: 1000,
            model: 'Home SSD',
            children: [
              {
                name: 'nvme0n1p1',
                type: 'part',
                size: 900,
                fstype: 'ext4',
                mountpoints: ['/data'],
                label: 'Video',
              },
            ],
          },
        ],
      }),
    filesystem: async () => ({
      blocks: 900,
      bsize: 1,
      bfree: 400,
      bavail: 350,
    }),
  });
  assert.equal(disks[0].kind, 'disk');
  assert.equal(disks[1].parentId, disks[0].id);
  assert.equal(disks[2].mountpoint, '/data');
  assert.equal(disks[2].usedBytes, 500);
  assert.equal(disks[2].availableBytes, 350);
});
test('macOS disk hierarchy converts a read-only plist over stdin; Windows CIM reports memory/swap/disks', async () => {
  const calls: Invocation[] = [];
  const disks = await macDisks({
    run: async (file, args, options) => {
      calls.push({ file, args, options: options ?? {} });
      return file.endsWith('diskutil')
        ? '<plist>private disk metadata</plist>'
        : JSON.stringify({
            AllDisksAndPartitions: [
              {
                DeviceIdentifier: 'disk0',
                Size: 1000,
                Partitions: [
                  {
                    DeviceIdentifier: 'disk0s1',
                    Size: 900,
                    MountPoint: '/Volumes/Video',
                    VolumeName: 'Video',
                    Content: 'apfs',
                  },
                ],
              },
            ],
          });
    },
    filesystem: async () => ({
      blocks: 900,
      bsize: 1,
      bfree: 400,
      bavail: 350,
    }),
  });
  const input = calls[1].options.input;
  assert.ok(typeof input === 'string');
  assert.ok(input.startsWith('<plist>'));
  assert.equal(disks[1].parentId, 'disk:disk0');
  assert.equal(disks[1].kind, 'volume');
  assert.equal(disks[1].mountpoint, '/Volumes/Video');
  const windows = await windowsTelemetry(async (file, args) => {
    assert.equal(file, 'powershell.exe');
    assert.ok(args.includes('-NonInteractive'));
    return JSON.stringify({
      MemoryTotal: 1000,
      MemoryInstalled: 1024,
      MemoryFree: 400,
      SwapTotal: 500,
      SwapFree: 300,
      Battery: [{ EstimatedChargeRemaining: 55, BatteryStatus: 6 }],
      Disks: [
        {
          DeviceID: 'C:',
          VolumeName: 'System',
          FileSystem: 'NTFS',
          Size: 10000,
          FreeSpace: 4000,
        },
      ],
    });
  });
  assert.ok(windows.memory);
  assert.equal(windows.memory.usedBytes, 600);
  assert.ok(windows.memory);
  assert.equal(windows.memory.installedBytes, 1024);
  assert.equal(windows.swap.usedBytes, 200);
  assert.deepEqual(windows.battery, { level: 55, charging: true });
  assert.equal(windows.disks[0].mountpoint, 'C:\\');
});
