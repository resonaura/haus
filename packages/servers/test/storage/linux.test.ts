/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { required } from '../support/report.js';

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { linuxDisks, linuxDiskPurpose, sanitizeHostReport } from '../../src/index.js';

import { filesystem, collect } from './support.js';
test('Ubuntu disk purposes follow actual GPT/filesystem/mount metadata and retain unmounted EFI', async () => {
  const disks = await collect(
    [
      {
        name: 'sda',
        type: 'disk',
        size: 256000,
        tran: 'sata',
        children: [
          {
            name: 'sda1',
            type: 'part',
            size: 1000,
            fstype: 'vfat',
            parttype: 'c12a7328-f81f-11d2-ba4b-00a0c93ec93b',
            ro: false,
            mountpoints: ['/boot/efi'],
          },
          {
            name: 'sda2',
            type: 'part',
            size: 255000,
            fstype: 'ext4',
            mountpoints: ['/'],
            ro: false,
          },
        ],
      },
      {
        name: 'sdb',
        type: 'disk',
        size: 6000000,
        tran: 'usb',
        children: [
          {
            name: 'sdb1',
            type: 'part',
            size: 5999000,
            fstype: 'ext4',
            label: 'Backup',
            parttype: '0fc63daf-8483-4772-8e79-3d69d8477de4',
            mountpoints: ['/export/Backup', '/mnt/backup'],
          },
        ],
      },
      {
        name: 'sdc',
        type: 'disk',
        size: 1000000,
        tran: 'sata',
        children: [
          {
            name: 'sdc1',
            type: 'part',
            size: 1000,
            fstype: 'vfat',
            parttype: 'c12a7328-f81f-11d2-ba4b-00a0c93ec93b',
            mountpoints: [null],
          },
          {
            name: 'sdc2',
            type: 'part',
            size: 999000,
            fstype: 'ntfs',
            partlabel: 'Data',
            parttype: 'ebd0a0a2-b9e5-4433-87c0-68b6b72699c7',
            mountpoints: ['/export/NVR', '/mnt/nvr'],
          },
        ],
      },
    ],
    {
      read: async (path) => {
        assert.match(path, /^\/sys\/class\/block\/sd[a-c][12]\/partition$/);
        return path.includes('2/') ? '2\n' : '1\n';
      },
    },
  );
  assert.equal(disks.filter((d) => d.physical === true).length, 3);
  assert.equal(required(disks.find((d) => d.id === 'block:sda2')).partitionRole, 'system');
  assert.equal(required(disks.find((d) => d.id === 'block:sdc1')).partitionRole, 'efi');
  assert.equal(required(disks.find((d) => d.id === 'block:sdc1')).usedBytes, null);
  assert.equal(required(disks.find((d) => d.id === 'block:sdc1')).partitionNumber, 1);
  assert.equal(required(disks.find((d) => d.id === 'block:sdc2')).name, 'Data');
  assert.equal(required(disks.find((d) => d.id === 'block:sdc2')).partitionNumber, 2);
  const volume = required(disks.find((d) => d.mountpoint === '/mnt/nvr'));
  assert.equal(volume.device, '/dev/sdc2');
  assert.deepEqual(volume.mountpoints, ['/export/NVR', '/mnt/nvr']);
  assert.equal(disks.filter((d) => d.device === '/dev/sdc2' && d.type === 'volume').length, 1);
  assert.equal(volume.partitionRole, 'data');
  const clean = sanitizeHostReport({
    sampledAt: new Date().toISOString(),
    scope: 'host',
    cpu: { logicalCores: 4 },
    memory: { totalBytes: 1000, usedBytes: 500, availableBytes: 500 },
    disks,
  });
  assert.equal(required(clean.disks.find((d) => d.id === 'block:sda2')).partitionRole, 'system');
  assert.equal(
    required(required(clean.disks.find((d) => d.mountpoint === '/mnt/nvr')).mountpoints).length,
    2,
  );
});

test('swap, home and layered storage purposes are explicit while unknown unmounted storage remains unknown', () => {
  assert.equal(linuxDiskPurpose({ fstype: 'swap' }), 'swap');
  assert.equal(linuxDiskPurpose({ fstype: 'ext4' }, ['/home']), 'home');
  assert.equal(linuxDiskPurpose({ fstype: 'crypto_LUKS' }), 'encrypted');
  assert.equal(linuxDiskPurpose({ type: 'crypt' }), 'encrypted');
  assert.equal(linuxDiskPurpose({ type: 'lvm' }), 'lvm');
  assert.equal(linuxDiskPurpose({ type: 'raid1' }), 'raid');
  assert.equal(linuxDiskPurpose({}), undefined);
});

test('Linux storage layers preserve disk/partition/encryption/LVM parents without counting them as physical disks', async () => {
  const disks = await collect([
    {
      name: 'nvme0n1',
      type: 'disk',
      size: 2000,
      tran: 'nvme',
      children: [
        {
          name: 'nvme0n1p3',
          type: 'part',
          size: 1800,
          children: [
            {
              name: 'cryptroot',
              type: 'crypt',
              size: 1799,
              children: [
                {
                  name: 'vg-root',
                  type: 'lvm',
                  size: 1600,
                  fstype: 'ext4',
                  mountpoints: ['/', '/export/Home'],
                },
              ],
            },
          ],
        },
      ],
    },
  ]);
  assert.deepEqual(
    disks.map((disk) => disk.type),
    ['disk', 'partition', 'container', 'container', 'volume'],
  );
  assert.equal(disks.filter((disk) => disk.kind === 'disk').length, 1);
  assert.equal(disks.filter((disk) => disk.physical === true).length, 1);
  assert.deepEqual(
    disks.map((disk) => disk.parentId),
    [null, 'block:nvme0n1', 'block:nvme0n1p3', 'block:cryptroot', 'block:vg-root'],
  );
  assert.equal(disks[4].mountpoint, '/');
  assert.equal(disks[4].availableBytes, 350);
  assert.deepEqual(disks[4].mountpoints, ['/', '/export/Home']);
  assert.equal(disks[1].usedBytes, null);
});

test('shared RAID/multipath layers keep all physical parents and a stable primary without duplicate rows', async () => {
  const raid = {
    name: 'md0',
    type: 'raid1',
    size: 1000,
    children: [
      {
        name: 'crypt-media',
        type: 'crypt',
        size: 999,
        fstype: 'ext4',
        mountpoints: ['/media'],
      },
    ],
  };
  const disks = await collect([
    { name: 'sda', type: 'disk', size: 1000, tran: 'sata', children: [raid] },
    { name: 'sdb', type: 'disk', size: 1000, tran: 'usb', children: [raid] },
    {
      name: 'sdz',
      type: 'disk',
      size: 1000,
      tran: 'fc',
      children: [{ name: 'mpatha', type: 'mpath', size: 1000 }],
    },
  ]);
  assert.equal(new Set(disks.map((disk) => disk.id)).size, disks.length);
  const mapped = required(disks.find((disk) => disk.id === 'block:md0'));
  assert.equal(mapped.type, 'container');
  assert.equal(mapped.kind, 'volume');
  assert.equal(mapped.physical, false);
  assert.equal(mapped.parentId, 'block:sda');
  assert.deepEqual(mapped.parentIds, ['block:sda', 'block:sdb']);
  assert.equal(required(disks.find((disk) => disk.id === 'block:mpatha')).type, 'container');
  assert.equal(disks.filter((disk) => disk.kind === 'disk').length, 3);
});

test('unknown and virtual block devices do not claim physical hardware; WSL stays virtual', async () => {
  const blockdevices = [
    { name: 'sda', type: 'disk', size: 1000 },
    {
      name: 'vda',
      type: 'disk',
      size: 1000,
      subsystems: 'block:virtio:pci',
      tran: 'scsi',
    },
    {
      name: 'sdb',
      type: 'disk',
      size: 1000,
      model: 'VMware Virtual disk',
      tran: 'scsi',
    },
    { name: 'mystery', type: 'unknown', size: 1000 },
    { name: 'loop0', type: 'loop', size: 1000 },
    { name: 'sr0', type: 'rom', size: 1000 },
  ];
  const disks = await collect(blockdevices);
  assert.deepEqual(
    disks.map((disk) => disk.physical),
    [null, false, false, false],
  );
  assert.equal(required(disks.at(-1)).type, 'container');
  const wsl = await collect([{ name: 'sdc', type: 'disk', tran: 'scsi', size: 1000 }], {
    virtualized: true,
  });
  assert.equal(wsl[0].physical, false);
});

test('fallback mount inventory remains volumes and never invents physical parents', async () => {
  const disks = await linuxDisks({
    run: async () => {
      throw new Error('missing lsblk');
    },
    read: async () =>
      '/dev/mapper/root / ext4 rw 0 0\nserver:/media /mnt/media nfs4 rw 0 0\nproc /proc proc rw 0 0\n',
    filesystem,
  });
  assert.equal(disks.length, 2);
  assert.ok(
    disks.every(
      (disk) => disk.type === 'volume' && disk.physical === false && disk.parentId === null,
    ),
  );
  assert.ok(disks.every((disk) => disk.parentIds.length === 0));
});
