/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readFile, statfs } from 'node:fs/promises';
import { command } from './services.js';
import { storageMedia, udevMediaAttributes } from './storage.js';
import { stripControl } from './sanitize.js';
import type { HostDisk } from './types.js';

const clean = (value: unknown, length = 240) =>
  typeof value === 'string' ? stripControl(value).slice(0, length) : null;

const positive = (value: unknown) =>
  value !== null &&
  value !== undefined &&
  !(typeof value === 'string' && !value.trim()) &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0
    ? Number(value)
    : null;

const unescapeMount = (value: string) =>
  value.replace(/\\(040|011|012|134)/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));

export async function volumeAt(
  path: string,
  {
    filesystem = statfs,
    scope = 'host',
    name,
    id,
    filesystemType = null,
    parentId = null,
    parentIds = parentId ? [parentId] : [],
  }: {
    filesystem?: (
      path: string,
    ) => Promise<{ blocks: number; bsize: number; bfree: number; bavail: number }>;
    scope?: string;
    name?: string | null;
    id?: string | null;
    filesystemType?: string | null;
    parentId?: string | null;
    parentIds?: string[];
  } = {},
): Promise<HostDisk> {
  const stats = await filesystem(path);
  const totalBytes = stats.blocks * stats.bsize;
  return {
    id: id || `volume:${path}`,
    name: clean(name || path),
    kind: 'volume',
    type: 'volume',
    physical: false,
    parentId,
    parentIds,
    mountpoint: clean(path),
    filesystem: clean(filesystemType),
    totalBytes,
    usedBytes: Math.max(0, totalBytes - stats.bfree * stats.bsize),
    availableBytes: Math.max(0, stats.bavail * stats.bsize),
    scope,
  };
}

export function linuxDiskPurpose(row: Record<string, unknown>, mounts: string[] = []) {
  if (
    String(row.parttype ?? '').toLowerCase() === 'c12a7328-f81f-11d2-ba4b-00a0c93ec93b' ||
    mounts.includes('/boot/efi')
  )
    return 'efi';
  if (String(row.parttype ?? '').toLowerCase() === 'de94bba4-06d1-4d40-a16a-bfd50179d6ac')
    return 'recovery';
  if (String(row.parttype ?? '').toLowerCase() === 'e3c9e316-0b5c-4db8-817d-f92df00215ae')
    return 'reserved';
  if (row.fstype === 'swap') return 'swap';
  if (row.fstype === 'crypto_LUKS' || row.type === 'crypt') return 'encrypted';
  if (row.type === 'lvm') return 'lvm';
  if (/^raid|^md$/.test(String(row.type ?? ''))) return 'raid';
  if (mounts.includes('/')) return 'system';
  if (mounts.includes('/boot')) return 'boot';
  if (mounts.includes('/home')) return 'home';
  if (
    mounts.length ||
    ['0fc63daf-8483-4772-8e79-3d69d8477de4', 'ebd0a0a2-b9e5-4433-87c0-68b6b72699c7'].includes(
      String(row.parttype ?? '').toLowerCase(),
    )
  )
    return 'data';
}

export async function linuxDisks({
  run = command,
  filesystem = statfs,
  read = ((p: string, enc?: string) => readFile(p, (enc ?? 'utf8') as BufferEncoding)) as (
    path: string,
    encoding?: string,
  ) => Promise<string | Buffer>,
  virtualized = false,
}: {
  run?: (cmd: string, args: string[], options?: Record<string, unknown>) => Promise<string>;
  filesystem?: (
    path: string,
  ) => Promise<{ blocks: number; bsize: number; bfree: number; bavail: number }>;
  read?: (path: string, encoding?: string) => Promise<string | Buffer>;
  virtualized?: boolean;
} = {}): Promise<HostDisk[]> {
  try {
    const value = JSON.parse(
      await run('lsblk', [
        '--json',
        '--bytes',
        '--output',
        'NAME,TYPE,SIZE,FSTYPE,MOUNTPOINTS,LABEL,MODEL,TRAN,SUBSYSTEMS,PARTTYPE,PARTLABEL,RO,ROTA,RM,HOTPLUG',
      ]),
    );
    const disks: HostDisk[] = [];
    const seen = new Map<string, HostDisk>();
    const walk = async (row: Record<string, unknown>, parentId: string | null = null) => {
      if (!row || disks.length >= 128 || ['loop', 'rom'].includes(String(row.type))) return;
      const id = `block:${clean(row.name, 80)}`;
      if (seen.has(id)) {
        const existing = seen.get(id)!;
        if (parentId && parentId !== id && !existing.parentIds.includes(parentId))
          existing.parentIds.push(parentId);
        return;
      }
      const mounts = Array.isArray(row.mountpoints)
        ? (row.mountpoints as unknown[]).filter(
            (item): item is string => typeof item === 'string' && item.startsWith('/'),
          )
        : [];
      const type = row.type === 'disk' ? 'disk' : row.type === 'part' ? 'partition' : 'container';
      const virtual =
        virtualized ||
        /(?:virtio|virtual|qemu|vmware|xen|vmbus)/i.test(
          `${String(row.model || '')} ${String(row.subsystems || '')} ${String(row.tran || '')}`,
        );
      const physical =
        type !== 'disk' || virtual
          ? false
          : /^(?:ata|sata|sas|scsi|usb|nvme|mmc|ieee1394|fc|fcoe)$/i.test(String(row.tran || ''))
            ? true
            : null;
      const purpose = linuxDiskPurpose(row, mounts);
      let media: Record<string, unknown> = {};
      if (type === 'disk' && !virtual && /^[a-zA-Z0-9_!+-]{1,80}$/.test(String(row.name ?? ''))) {
        const deviceNumber = String(
          await read(`/sys/class/block/${row.name}/dev`, 'utf8').catch(() => ''),
        ).trim();
        const attributes = /^\d+:\d+$/.test(deviceNumber)
          ? udevMediaAttributes(
              String(await read(`/run/udev/data/b${deviceNumber}`, 'utf8').catch(() => '')),
            )
          : {};
        if (['mmc', 'sdio'].includes(String(row.tran)))
          attributes.MMC_TYPE ||= String(
            await read(`/sys/class/block/${row.name}/device/type`, 'utf8').catch(() => ''),
          ).trim();
        media = storageMedia({
          transport: typeof row.tran === 'string' ? row.tran : undefined,
          rotational: typeof row.rota === 'boolean' ? row.rota : undefined,
          removable: typeof row.rm === 'boolean' ? row.rm : undefined,
          hotplug: typeof row.hotplug === 'boolean' ? row.hotplug : undefined,
          attributes,
        });
      }
      let partitionNumber: number | undefined;
      if (type === 'partition' && /^[a-zA-Z0-9_!+-]{1,80}$/.test(String(row.name ?? ''))) {
        const number = Number(
          String(
            await read(`/sys/class/block/${row.name}/partition`, 'utf8').catch(() => ''),
          ).trim(),
        );
        if (Number.isSafeInteger(number) && number > 0) partitionNumber = number;
      }
      const disk: HostDisk = {
        id,
        name: clean(
          row.label ||
            row.partlabel ||
            (typeof row.model === 'string' ? row.model.trim() : null) ||
            row.name,
        ),
        kind: type === 'disk' ? 'disk' : 'volume',
        type,
        physical,
        parentId,
        parentIds: parentId ? [parentId] : [],
        mountpoint: null,
        filesystem: clean(row.fstype),
        totalBytes: positive(row.size),
        usedBytes: null,
        availableBytes: null,
        scope: 'host',
        ...media,
        ...(/^[a-zA-Z0-9_!+-]{1,80}$/.test(String(row.name ?? ''))
          ? { device: `/dev/${row.name}` }
          : {}),
        ...(purpose ? { partitionRole: purpose } : {}),
        ...(partitionNumber ? { partitionNumber } : {}),
        ...(typeof row.ro === 'boolean' ? { readOnly: row.ro } : {}),
      };
      seen.set(id, disk);
      disks.push(disk);
      const orderedMounts = [...mounts].sort(
        (a: string, b: string) => a.length - b.length || a.localeCompare(b),
      );
      for (const mount of orderedMounts.slice(0, 16)) {
        if (disks.length >= 128) break;
        if (seen.has(`volume:${mount}`)) continue;
        try {
          const volume = await volumeAt(mount, {
            filesystem,
            parentId: id,
            name: (typeof row.label === 'string' ? row.label : null) || mount,
            filesystemType: typeof row.fstype === 'string' ? row.fstype : null,
          });
          if (purpose) volume.partitionRole = purpose;
          volume.mountpoints = mounts
            .slice(0, 16)
            .map((val) => clean(val))
            .filter((val): val is string => Boolean(val));
          volume.device = (disk as { device?: string }).device;
          if (typeof row.ro === 'boolean') volume.readOnly = row.ro;
          seen.set(volume.id, volume);
          disks.push(volume);
          break;
        } catch {
          /* Unmounted between discovery and stat. */
        }
      }
      for (const child of ((row.children as Record<string, unknown>[]) || []).slice(0, 128))
        await walk(child, id);
    };
    for (const row of ((value.blockdevices as Record<string, unknown>[]) || []).slice(0, 128))
      await walk(row);
    if (disks.length) return disks.slice(0, 128);
  } catch {
    /* Minimal hosts may not install util-linux. */
  }
  const output = String(await read('/proc/self/mounts', 'utf8').catch(() => ''));
  const mounts: string[][] = output
    .split('\n')
    .map((line: string) => line.split(' '))
    .filter(
      ([device, mount, type]: string[]) =>
        mount?.startsWith('/') &&
        (device?.startsWith('/dev/') || ['zfs', 'btrfs', 'nfs', 'nfs4', 'cifs'].includes(type)),
    )
    .slice(0, 128);
  return (
    await Promise.all(
      mounts.map(async ([device, mount, type]: string[]) =>
        volumeAt(unescapeMount(mount), {
          filesystem,
          name: unescapeMount(device),
          filesystemType: type,
        }).catch(() => null),
      ),
    )
  ).filter((d): d is HostDisk => d !== null);
}

export async function plist(
  file: string,
  args: string[],
  run: (cmd: string, args: string[], options?: Record<string, unknown>) => Promise<string>,
) {
  const xml = await run(file, args);
  return JSON.parse(
    await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], {
      input: xml,
    }),
  );
}

export async function macDisks({
  run = command,
  filesystem = statfs,
}: {
  run?: (cmd: string, args: string[], options?: Record<string, unknown>) => Promise<string>;
  filesystem?: (
    path: string,
  ) => Promise<{ blocks: number; bsize: number; bfree: number; bavail: number }>;
} = {}): Promise<HostDisk[]> {
  const result = await plist('/usr/sbin/diskutil', ['list', '-plist'], run);
  const disks: HostDisk[] = [];
  const walk = async (row: Record<string, unknown>, parentId: string | null = null) => {
    if (!row || disks.length >= 128) return;
    const id = `disk:${row.DeviceIdentifier}`;
    const physicalStores = row.APFSPhysicalStores as Record<string, unknown>[] | undefined;
    const physicalStore = physicalStores?.[0]?.DeviceIdentifier;
    parentId ||= physicalStore ? `disk:${physicalStore}` : null;
    const volume = Boolean(row.VolumeName || row.MountPoint);
    const type =
      row.Content === 'Apple_APFS_Container'
        ? 'container'
        : volume
          ? 'volume'
          : parentId
            ? 'partition'
            : 'disk';
    const parentIds = (physicalStores || [])
      .map((store) =>
        typeof store.DeviceIdentifier === 'string' ? `disk:${store.DeviceIdentifier}` : null,
      )
      .filter((p): p is string => p !== null);
    if (parentId && !parentIds.includes(parentId)) parentIds.unshift(parentId);
    const disk: HostDisk = {
      id,
      name: clean(row.VolumeName || row.DeviceIdentifier),
      kind: type === 'disk' ? 'disk' : 'volume',
      type,
      physical: type === 'disk' ? (row.OSInternal === true ? true : null) : false,
      parentId,
      parentIds,
      mountpoint: clean(row.MountPoint),
      filesystem: clean(row.Content || (row.CapacityInUse !== undefined ? 'apfs' : null)),
      totalBytes: positive(row.Size),
      usedBytes: positive(row.CapacityInUse),
      availableBytes: null,
      scope: 'host',
    };
    if (row.MountPoint) {
      try {
        const mounted = await volumeAt(String(row.MountPoint), { filesystem });
        disk.totalBytes = mounted.totalBytes;
        disk.availableBytes = mounted.availableBytes;
        if (
          !/apfs/i.test(String(row.Content ?? '')) &&
          !Array.isArray(row.APFSVolumes) &&
          row.CapacityInUse === undefined
        )
          disk.usedBytes ??= mounted.usedBytes;
      } catch {
        /* Ejected volume. */
      }
    }
    disks.push(disk);
    const partitions = (row.Partitions as Record<string, unknown>[] | undefined) || [];
    const apfsVolumes = (row.APFSVolumes as Record<string, unknown>[] | undefined) || [];
    for (const child of [...partitions, ...apfsVolumes].slice(0, 128)) await walk(child, id);
  };
  const allDisks = (result.AllDisksAndPartitions as Record<string, unknown>[] | undefined) || [];
  for (const row of allDisks.slice(0, 128)) await walk(row);
  return disks.slice(0, 128);
}
