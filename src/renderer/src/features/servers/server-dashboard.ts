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
    (disk) =>
      disk.physical !== false &&
      (disk.type === 'disk' || disk.kind === 'disk' || disk.physical === true),
  );
  const byId = new Map(unique.map((disk) => [disk.id, disk]));
  const hasPhysicalParent = (disk: ServerDisk) => {
    const pending = [disk.id];
    const seen = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const item = byId.get(id);
      if (item?.physical === true) return true;
      if (item?.parentId) pending.push(item.parentId);
      pending.push(...(item?.parentIds ?? []));
    }
    return false;
  };
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
      // A sparse WSL filesystem can advertise a much larger virtual capacity
      // than its Windows SSD. Prefer measured use on a physical disk's volume.
      .sort(
        (a, b) =>
          Number(hasPhysicalParent(b)) - Number(hasPhysicalParent(a)) ||
          b.totalBytes! - a.totalBytes!,
      )[0],
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
