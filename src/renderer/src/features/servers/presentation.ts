import type { HomeServer, ResourceSample, ServerDisk } from './types';

export const GIB = 1024 ** 3;
export const STATUS_FRESH_MS = 20000;
export const TELEMETRY_FRESH_MS = 30000;
export function statusIsFresh(receivedAt: number | null, failed: boolean, now: number) {
  return receivedAt !== null && !failed && now - receivedAt < STATUS_FRESH_MS;
}
export function telemetryIsFresh(server: HomeServer, statusFresh: boolean, now: number) {
  const sampledAt = server.host?.sampledAt ? Date.parse(server.host.sampledAt) : NaN;
  return (
    statusFresh &&
    server.online &&
    Number.isFinite(sampledAt) &&
    now - sampledAt < TELEMETRY_FRESH_MS &&
    sampledAt - now < 5000
  );
}
export function serviceSampleIsFresh(sampledAt: string | null | undefined, now: number) {
  if (sampledAt === undefined) return true;
  const sampled = sampledAt ? Date.parse(sampledAt) : NaN;
  return Number.isFinite(sampled) && now - sampled < TELEMETRY_FRESH_MS && sampled - now < 5000;
}
export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0)
    return 'Unavailable';
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.max(
    0,
    Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024))),
  );
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: index > 1 ? 1 : 0 }).format(value / 1024 ** index)} ${units[index]}`;
}
export function ratio(used: number | null | undefined, total: number | null | undefined) {
  return typeof used === 'number' &&
    Number.isFinite(used) &&
    typeof total === 'number' &&
    Number.isFinite(total) &&
    total > 0
    ? Math.min(1, Math.max(0, used / total))
    : null;
}
export function percent(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${Math.round(value * 100)}%`;
}
export function uptime(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0)
    return 'Unavailable';
  if (seconds >= 86400)
    return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
  if (seconds >= 3600)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.max(0, Math.floor(seconds / 60))}m`;
}
export function resourceSample(server: HomeServer, now: number): ResourceSample {
  const host = server.host;
  const fresh = telemetryIsFresh(server, true, now);
  return {
    time: now,
    cpu: fresh ? (host?.cpu.usage ?? null) : null,
    memory: fresh ? ratio(host?.memory.usedBytes, host?.memory.totalBytes) : null,
    swap: fresh && host?.swap.supported ? ratio(host.swap.usedBytes, host.swap.totalBytes) : null,
  };
}
export function appendSample(history: ResourceSample[], next: ResourceSample) {
  return [...history.filter((sample) => sample.time > next.time - 300000), next].slice(-60);
}
// Keep each physical device followed by its volumes. Never add their capacities together.
export function orderDisks(disks: ServerDisk[]) {
  const ids = new Set(disks.map((disk) => disk.id));
  const roots = disks.filter((disk) => !disk.parentId || !ids.has(disk.parentId));
  const output: ServerDisk[] = [];
  const seen = new Set<string>();
  const append = (disk: ServerDisk) => {
    if (seen.has(disk.id)) return;
    seen.add(disk.id);
    output.push(disk);
    disks.filter((child) => child.parentId === disk.id).forEach(append);
  };
  roots.forEach(append);
  disks.forEach(append);
  return output;
}
export function diskDepth(disk: ServerDisk, disks: ServerDisk[]) {
  const seen = new Set([disk.id]);
  let current = disk,
    depth = 0;
  while (current.parentId) {
    const parent = disks.find((item) => item.id === current.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    depth += 1;
    current = parent;
  }
  return depth;
}
export function diskOtherAllocated(disk: ServerDisk) {
  if (disk.totalBytes === null || disk.usedBytes === null || disk.availableBytes === null)
    return null;
  return Math.max(0, disk.totalBytes - disk.usedBytes - disk.availableBytes);
}
export function partitionPurpose(disk: ServerDisk) {
  return disk.partitionRole
    ? {
        efi: 'EFI System Partition',
        reserved: 'Microsoft Reserved',
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
export function allocatedSpace(server: HomeServer) {
  const storage = server.storage;
  return storage && Object.hasOwn(storage, 'availableBytes') ? storage.availableBytes : undefined;
}
export function quotaRange(server: HomeServer) {
  const disk = server.host?.disks.find((item) => item.availableBytes !== null);
  const available = server.storage?.freeBytes ?? disk?.availableBytes ?? 0;
  const used = server.storage?.usedBytes ?? 0;
  const current = server.settings?.storageLimitBytes ?? 0;
  return Math.max(1, Math.ceil((available + used) / GIB), Math.ceil(current / GIB));
}
