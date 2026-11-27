/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { formatRatioValue } from './metrics.js';

export type ServerDiskPartitionRole =
  | 'efi'
  | 'reserved'
  | 'recovery'
  | 'data'
  | 'boot'
  | 'system'
  | 'kernel'
  | 'boot-state'
  | 'overlay'
  | 'swap'
  | 'home'
  | 'lvm'
  | 'raid'
  | 'encrypted';

export type ServerDiskMediaKind =
  'hdd' | 'ssd' | 'solid-state' | 'flash' | 'sd' | 'mmc' | 'optical';

export interface ServerDiskRecord {
  readonly id: string;
  readonly name: string;
  readonly kind?: 'disk' | 'volume';
  readonly type?: 'disk' | 'partition' | 'container' | 'volume';
  readonly physical?: boolean | null;
  readonly parentId?: string | null;
  readonly parentIds?: readonly string[];
  readonly mountpoint: string | null;
  readonly mountpoints?: readonly string[];
  readonly filesystem: string | null;
  readonly totalBytes: number | null;
  readonly usedBytes: number | null;
  readonly availableBytes: number | null;
  readonly scope?: 'host' | 'container';
  readonly partitionRole?: ServerDiskPartitionRole;
  readonly partitionNumber?: number;
  readonly device?: string;
  readonly readOnly?: boolean;
  readonly transport?: string;
  readonly mediaKind?: ServerDiskMediaKind;
  readonly removable?: boolean;
  readonly hotplug?: boolean;
}

export interface ServerDiskSpaceSegment {
  readonly id: string;
  readonly label: string;
  readonly bytes: number | null;
  readonly targetId?: string;
  readonly tone: 'allocation' | 'used' | 'other' | 'available' | 'unknown';
}

export interface ServerDiskSpace {
  readonly title: string;
  readonly totalBytes: number | null;
  readonly segments: readonly ServerDiskSpaceSegment[];
  readonly note: string;
  readonly proportional: boolean;
}

export function orderServerDisks(disks: readonly ServerDiskRecord[]): ServerDiskRecord[] {
  const ids = new Set(disks.map((disk) => disk.id));
  const roots = disks.filter((disk) => !disk.parentId || !ids.has(disk.parentId));
  const output: ServerDiskRecord[] = [];
  const seen = new Set<string>();
  const append = (disk: ServerDiskRecord) => {
    if (seen.has(disk.id)) return;
    seen.add(disk.id);
    output.push(disk);
    disks.filter((child) => child.parentId === disk.id).forEach(append);
  };
  roots.forEach(append);
  disks.forEach(append);
  return output;
}

export function serverDiskDepth(
  disk: ServerDiskRecord,
  disks: readonly ServerDiskRecord[],
): number {
  const seen = new Set([disk.id]);
  let current = disk;
  let depth = 0;
  while (current.parentId) {
    const parent = disks.find((item) => item.id === current.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    depth += 1;
    current = parent;
  }
  return depth;
}

export function serverPartitionPurpose(disk: ServerDiskRecord): string | undefined {
  return disk.partitionRole
    ? {
        efi: 'EFI System Partition',
        reserved: 'Microsoft Reserved Partition',
        recovery: 'Recovery',
        data: 'Data',
        boot: 'Boot',
        system: 'Operating system',
        kernel: 'Kernel',
        'boot-state': 'Boot state',
        overlay: 'System overlay',
        swap: 'Swap',
        home: 'Home folders',
        lvm: 'Logical volume',
        raid: 'RAID',
        encrypted: 'Encrypted storage',
      }[disk.partitionRole]
    : undefined;
}

export function serverDiskDisplayName(disk: ServerDiskRecord): string {
  if (disk.partitionRole === 'efi') return 'EFI System Partition';
  return disk.partitionRole === 'reserved' ? 'Microsoft Reserved Partition' : disk.name;
}

export function serverStorageMediaLabel(disk: ServerDiskRecord): string | undefined {
  const kind = disk.mediaKind
    ? {
        hdd: 'HDD',
        ssd: 'SSD',
        'solid-state': 'Solid-state storage',
        flash: 'Flash drive',
        sd: 'SD card',
        mmc: 'MMC storage',
        optical: 'Optical media',
      }[disk.mediaKind]
    : undefined;
  const bus = disk.transport
    ? {
        usb: 'USB',
        sata: 'SATA',
        ata: 'ATA',
        nvme: 'NVMe',
        sas: 'SAS',
        scsi: 'SCSI',
        mmc: 'MMC',
        sdio: 'SDIO',
        sd: 'SD',
        thunderbolt: 'Thunderbolt',
        'apple-fabric': 'Apple Fabric',
        ieee1394: 'FireWire',
        fc: 'Fibre Channel',
        fcoe: 'FCoE',
      }[disk.transport]
    : undefined;
  return [bus, kind].filter(Boolean).join(' · ') || undefined;
}

export function serverDiskTreeSubtitle(item: ServerDiskRecord): string {
  const subtitle =
    item.physical === true
      ? serverStorageMediaLabel(item) || 'Physical disk'
      : item.type === 'partition'
        ? serverPartitionPurpose(item) || 'Partition'
        : item.type === 'container'
          ? serverPartitionPurpose(item) || 'Storage container'
          : item.type === 'disk' || item.kind === 'disk'
            ? 'Storage device'
            : item.filesystem || 'Volume';
  if (subtitle !== serverDiskDisplayName(item)) return subtitle;
  return [item.partitionNumber ? `Partition ${item.partitionNumber}` : 'Partition', item.filesystem]
    .filter(Boolean)
    .join(' · ');
}

export function visibleServerDisks(
  disks: readonly ServerDiskRecord[],
  collapsed: ReadonlySet<string>,
): ServerDiskRecord[] {
  const byId = new Map(disks.map((disk) => [disk.id, disk]));
  return orderServerDisks(disks).filter((disk) => {
    const seen = new Set([disk.id]);
    let parent = disk.parentId ?? null;
    while (parent && !seen.has(parent)) {
      if (collapsed.has(parent)) return false;
      seen.add(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
    return true;
  });
}

const cleanByteCount = (n: number | null | undefined): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;

const parentSet = (disk: ServerDiskRecord) =>
  new Set([disk.parentId, ...(disk.parentIds ?? [])].filter((id): id is string => Boolean(id)));

function filesystemSpace(disk: ServerDiskRecord, inherited: boolean): ServerDiskSpace {
  const total = cleanByteCount(disk.totalBytes);
  const used = cleanByteCount(disk.usedBytes);
  const available = cleanByteCount(disk.availableBytes);
  const known = (used ?? 0) + (available ?? 0);
  const proportional = total !== null && total > 0 && known <= total;
  const segments: ServerDiskSpaceSegment[] = [
    { id: 'used', label: 'Used', bytes: used, tone: 'used' },
  ];
  if (proportional && total > known) {
    segments.push({
      id: 'other',
      label: used !== null && available !== null ? 'Other allocated' : 'Unreported',
      bytes: total - known,
      tone: used !== null && available !== null ? 'other' : 'unknown',
    });
  }
  segments.push({ id: 'available', label: 'Available', bytes: available, tone: 'available' });
  return {
    title: 'Space usage',
    totalBytes: total,
    segments,
    proportional,
    note: !proportional
      ? 'Filesystem usage is unavailable or inconsistent with the reported capacity.'
      : used === null || available === null
        ? 'Filesystem usage is incomplete. Unreported space is not assumed to be free.'
        : inherited
          ? `Measured filesystem on this partition · ${serverDiskDisplayName(disk)}. Partition capacity can differ from filesystem capacity.`
          : 'Measured filesystem usage. Other allocated space includes capacity unavailable to normal files.',
  };
}

/** Partition capacities and filesystem usage describe different layers (1:1 with Electron). */
export function computeServerDiskSpace(
  disk: ServerDiskRecord,
  disks: readonly ServerDiskRecord[],
): ServerDiskSpace {
  const unique = [...new Map(disks.map((item) => [item.id, item])).values()];
  const children = unique.filter((child) => child.id !== disk.id && parentSet(child).has(disk.id));
  const ownUsage =
    cleanByteCount(disk.usedBytes) !== null || cleanByteCount(disk.availableBytes) !== null;
  const firstChild = children[0];
  const filesystem =
    !ownUsage &&
    disk.type === 'partition' &&
    children.length === 1 &&
    firstChild?.type === 'volume' &&
    parentSet(firstChild).size === 1
      ? firstChild
      : disk;
  const filesystemUsage =
    cleanByteCount(filesystem.usedBytes) !== null ||
    cleanByteCount(filesystem.availableBytes) !== null;
  if (
    filesystemUsage &&
    (!children.length || disk.type === 'volume' || disk.type === 'partition')
  ) {
    return filesystemSpace(filesystem, filesystem.id !== disk.id);
  }

  const shared = disk.type === 'container';
  if (children.length) {
    const total = cleanByteCount(disk.totalBytes);
    const segments: ServerDiskSpaceSegment[] = children.map((child) => ({
      id: child.id,
      label: serverDiskDisplayName(child),
      bytes:
        parentSet(child).size > 1
          ? null
          : cleanByteCount(shared ? child.usedBytes : child.totalBytes),
      targetId: child.id,
      tone: 'allocation',
    }));
    const available = shared ? cleanByteCount(disk.availableBytes) : null;
    if (available !== null) {
      segments.push({
        id: 'available',
        label: 'Available in pool',
        bytes: available,
        tone: 'available',
      });
    }
    const known = segments.reduce((sum, segment) => sum + (segment.bytes ?? 0), 0);
    const proportional = total !== null && total > 0 && known <= total;
    if (proportional && known < total) {
      segments.push({
        id: 'unreported',
        label: 'Other / unreported',
        bytes: total - known,
        tone: 'unknown',
      });
    }
    return {
      title: shared ? 'Volume allocations' : 'Partition layout',
      totalBytes: total,
      segments,
      proportional,
      note: !proportional
        ? 'Reported allocations cannot be scaled to the available capacity information.'
        : shared
          ? 'Reported volume usage within this pool. Shared capacity is counted once; unreported space is not assumed to be free.'
          : 'Allocated partition capacity, not file usage. Other / unreported includes space outside the reported allocations.',
    };
  }
  return filesystemSpace(disk, false);
}

export function summarizeServerDisks(disks: readonly ServerDiskRecord[]): {
  readonly totalBytes: number;
  readonly usedBytes: number;
  readonly availableBytes: number;
  readonly usageRatio: number | null;
  readonly volumeCount: number;
  readonly deviceCount: number;
  readonly reportedItems: number;
  readonly separateVolumes: boolean;
  readonly largestMounted?: ServerDiskRecord;
} {
  const unique = [...new Map(disks.map((item) => [item.id, item])).values()];
  const ids = new Set(unique.map((d) => d.id));
  const physicalRoots = unique.filter(
    (d) =>
      (d.physical === true || d.type === 'disk' || d.kind === 'disk') &&
      (!d.parentId || !ids.has(d.parentId)),
  );
  const mounted = unique
    .filter((d) => Boolean(d.mountpoint) && cleanByteCount(d.totalBytes) !== null)
    .sort((a, b) => (b.totalBytes ?? 0) - (a.totalBytes ?? 0));
  const largestMounted = mounted[0];

  if (physicalRoots.length > 0) {
    const totalBytes = physicalRoots.reduce(
      (sum, d) => sum + (cleanByteCount(d.totalBytes) ?? 0),
      0,
    );
    const allRootsReportUsage = physicalRoots.every(
      (d) => cleanByteCount(d.usedBytes) !== null && cleanByteCount(d.availableBytes) !== null,
    );
    const usedBytes = allRootsReportUsage
      ? physicalRoots.reduce((sum, d) => sum + (d.usedBytes ?? 0), 0)
      : (cleanByteCount(largestMounted?.usedBytes) ?? 0);
    const availableBytes = allRootsReportUsage
      ? physicalRoots.reduce((sum, d) => sum + (d.availableBytes ?? 0), 0)
      : (cleanByteCount(largestMounted?.availableBytes) ?? 0);
    const denom = allRootsReportUsage ? totalBytes : (largestMounted?.totalBytes ?? totalBytes);
    return {
      totalBytes,
      usedBytes,
      availableBytes,
      usageRatio: formatRatioValue(usedBytes, denom),
      volumeCount: unique.length,
      deviceCount: physicalRoots.length,
      reportedItems: unique.length,
      separateVolumes: false,
      ...(allRootsReportUsage ? {} : largestMounted ? { largestMounted } : {}),
    };
  }

  let totalBytes = 0;
  let usedBytes = 0;
  let availableBytes = 0;
  for (const disk of unique) {
    if (typeof disk.totalBytes === 'number' && disk.totalBytes > 0) totalBytes += disk.totalBytes;
    if (typeof disk.usedBytes === 'number' && disk.usedBytes >= 0) usedBytes += disk.usedBytes;
    if (typeof disk.availableBytes === 'number' && disk.availableBytes >= 0) {
      availableBytes += disk.availableBytes;
    }
  }
  const separateVolumes =
    unique.length > 1 && unique.every((d) => d.scope === 'container' || (!d.physical && !d.type));
  return {
    totalBytes,
    usedBytes,
    availableBytes,
    usageRatio: formatRatioValue(
      separateVolumes ? (largestMounted?.usedBytes ?? usedBytes) : usedBytes,
      separateVolumes ? (largestMounted?.totalBytes ?? totalBytes) : totalBytes,
    ),
    volumeCount: unique.length,
    deviceCount: 0,
    reportedItems: unique.length,
    separateVolumes,
    ...(largestMounted ? { largestMounted } : {}),
  };
}
