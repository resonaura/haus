/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { required } from '../support/report.js';

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { macDisks } from '../../src/index.js';

import { filesystem } from './support.js';
test('macOS APFS container and volumes remain attached through the physical partition', async () => {
  const rows = [
    {
      DeviceIdentifier: 'disk0',
      Size: 2000,
      OSInternal: true,
      Content: 'GUID_partition_scheme',
      Partitions: [{ DeviceIdentifier: 'disk0s2', Size: 1800, Content: 'Apple_APFS' }],
    },
    {
      DeviceIdentifier: 'disk3',
      Size: 1800,
      Content: 'Apple_APFS_Container',
      APFSPhysicalStores: [{ DeviceIdentifier: 'disk0s2' }],
      APFSVolumes: [
        {
          DeviceIdentifier: 'disk3s1',
          Size: 1800,
          VolumeName: 'Data',
          CapacityInUse: 600,
          MountPoint: '/System/Volumes/Data',
        },
      ],
    },
  ];
  const disks = await macDisks({
    run: async (file) =>
      file.endsWith('diskutil') ? '<plist/>' : JSON.stringify({ AllDisksAndPartitions: rows }),
    filesystem,
  });
  assert.deepEqual(
    disks.map((disk) => disk.type),
    ['disk', 'partition', 'container', 'volume'],
  );
  assert.equal(disks.filter((disk) => disk.kind === 'disk').length, 1);
  assert.equal(required(disks.find((disk) => disk.id === 'disk:disk3')).parentId, 'disk:disk0s2');
  assert.equal(required(disks.at(-1)).parentId, 'disk:disk3');
  assert.equal(required(disks.at(-1)).usedBytes, 600);
});

test('missing APFS volume allocation never borrows pool-wide statfs use', async () => {
  const disks = await macDisks({
    run: async (file) =>
      file.endsWith('diskutil')
        ? '<plist/>'
        : JSON.stringify({
            AllDisksAndPartitions: [
              {
                DeviceIdentifier: 'disk3',
                Content: 'Apple_APFS_Container',
                Size: 1000,
                APFSVolumes: [
                  {
                    DeviceIdentifier: 'disk3s1',
                    VolumeName: 'Data',
                    Content: 'apfs',
                    Size: 1000,
                    MountPoint: '/Data',
                  },
                ],
              },
            ],
          }),
    filesystem,
  });
  assert.equal(disks[1].usedBytes, null);
  assert.equal(disks[1].availableBytes, 350);
});
