import type { ServerDisk, ServerHost } from './types';

const validBytes = (value: number | null) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

// Whole devices are independent capacity units. Their partitions, APFS
// containers and mounted volumes may repeat the same bytes and must not be added.
export function diskSummary(disks: ServerDisk[]) {
  const unique = [...new Map(disks.map((disk) => [disk.id, disk])).values()];
  const ids = new Set(unique.map((disk) => disk.id));
  const roots = unique.filter(
    (disk) => ![disk.parentId, ...(disk.parentIds ?? [])].some((id) => id && ids.has(id)),
  );
  const devices = roots.filter(
    (disk) => disk.type === 'disk' || disk.kind === 'disk' || disk.physical === true,
  );
  // A single reported volume is safe to display. Several unlinked volumes can
  // share a backing filesystem, so their capacities remain separate in Disks.
  const independent = devices.length ? devices : roots.length === 1 ? roots : [];
  const sum = (field: 'totalBytes' | 'usedBytes' | 'availableBytes') =>
    independent.length && independent.every((disk) => validBytes(disk[field]))
      ? independent.reduce((total, disk) => total + disk[field]!, 0)
      : null;
  return {
    deviceCount: devices.length,
    reportedItems: unique.length,
    capacityBytes: sum('totalBytes'),
    usedBytes: sum('usedBytes'),
    availableBytes: sum('availableBytes'),
    separateVolumes: !devices.length && roots.length > 1,
    largestMounted: unique
      .filter(
        (disk) =>
          disk.mountpoint &&
          validBytes(disk.totalBytes) &&
          validBytes(disk.usedBytes) &&
          (disk.totalBytes ?? 0) > 0,
      )
      .sort((a, b) => b.totalBytes! - a.totalBytes!)[0],
  };
}

export function serviceSummary(host: ServerHost | null) {
  const docker = host?.docker;
  const pm2 = host?.pm2;
  return {
    docker: docker?.available
      ? {
          total: docker.containers.length,
          active: docker.containers.filter((item) => item.state === 'running').length,
          attention: docker.containers.filter(
            (item) =>
              item.state === 'dead' ||
              item.state === 'restarting' ||
              /\bunhealthy\b/i.test(item.status),
          ).length,
        }
      : null,
    pm2: pm2?.available
      ? {
          total: pm2.processes.length,
          active: pm2.processes.filter((item) => item.status === 'online').length,
          attention: pm2.processes.filter((item) => item.status === 'errored').length,
        }
      : null,
  };
}
