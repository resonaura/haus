import { diskDisplayName } from './presentation';
import type { ServerDisk } from './types';

export interface DiskSpaceSegment {
  id: string;
  label: string;
  bytes: number | null;
  targetId?: string;
  tone: 'allocation' | 'used' | 'other' | 'available' | 'unknown';
}
export interface DiskSpace {
  title: string;
  totalBytes: number | null;
  segments: DiskSpaceSegment[];
  note: string;
  proportional: boolean;
}
const count = (n: number | null | undefined): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
const parents = (disk: ServerDisk) =>
  new Set([disk.parentId, ...(disk.parentIds ?? [])].filter(Boolean));

/** Partition capacities and filesystem usage describe different layers. */
export function diskSpace(disk: ServerDisk, disks: ServerDisk[]): DiskSpace {
  const unique = [...new Map(disks.map((item) => [item.id, item])).values()];
  const children = unique.filter((child) => child.id !== disk.id && parents(child).has(disk.id));
  const ownUsage = count(disk.usedBytes) !== null || count(disk.availableBytes) !== null;
  // A partition's measured filesystem is often a separate inventory row. Do
  // not make users select that row just to see its usage, or add both totals.
  const filesystem =
    !ownUsage &&
    disk.type === 'partition' &&
    children.length === 1 &&
    children[0].type === 'volume' &&
    parents(children[0]).size === 1
      ? children[0]
      : disk;
  const filesystemUsage =
    count(filesystem.usedBytes) !== null || count(filesystem.availableBytes) !== null;
  if (filesystemUsage && (!children.length || disk.type === 'volume' || disk.type === 'partition'))
    return filesystemSpace(filesystem, filesystem.id !== disk.id);

  const shared = disk.type === 'container';
  if (children.length) {
    const total = count(disk.totalBytes);
    const segments: DiskSpaceSegment[] = children.map((child) => ({
      id: child.id,
      label: diskDisplayName(child),
      // A mapped volume backed by several devices is not wholly allocated
      // from each parent. A shared pool's volume capacity is not its usage.
      bytes: parents(child).size > 1 ? null : count(shared ? child.usedBytes : child.totalBytes),
      targetId: child.id,
      tone: 'allocation',
    }));
    const available = shared ? count(disk.availableBytes) : null;
    if (available !== null)
      segments.push({
        id: 'available',
        label: 'Available in pool',
        bytes: available,
        tone: 'available',
      });
    const known = segments.reduce((sum, segment) => sum + (segment.bytes ?? 0), 0);
    const proportional = total !== null && total > 0 && known <= total;
    if (proportional && known < total)
      segments.push({
        id: 'unreported',
        label: 'Other / unreported',
        bytes: total - known,
        tone: 'unknown',
      });
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

function filesystemSpace(disk: ServerDisk, inherited: boolean): DiskSpace {
  const total = count(disk.totalBytes),
    used = count(disk.usedBytes),
    available = count(disk.availableBytes);
  const known = (used ?? 0) + (available ?? 0);
  const proportional = total !== null && total > 0 && known <= total;
  const segments: DiskSpaceSegment[] = [{ id: 'used', label: 'Used', bytes: used, tone: 'used' }];
  if (proportional && total > known)
    segments.push({
      id: 'other',
      label: used !== null && available !== null ? 'Other allocated' : 'Unreported',
      bytes: total - known,
      tone: used !== null && available !== null ? 'other' : 'unknown',
    });
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
          ? `Measured filesystem on this partition · ${diskDisplayName(disk)}. Partition capacity can differ from filesystem capacity.`
          : 'Measured filesystem usage. Other allocated space includes capacity unavailable to normal files.',
  };
}
