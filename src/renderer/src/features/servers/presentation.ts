import type { HomeServer, ResourceSample, ServerDisk } from './types';

export const GIB = 1024 ** 3;
export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable';
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.max(
    0,
    Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024))),
  );
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: index > 1 ? 1 : 0 }).format(value / 1024 ** index)} ${units[index]}`;
}
export function ratio(used: number | null | undefined, total: number | null | undefined) {
  return typeof used === 'number' && typeof total === 'number' && total > 0
    ? Math.min(1, Math.max(0, used / total))
    : null;
}
export function percent(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
}
export function uptime(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return 'Unavailable';
  if (seconds >= 86400)
    return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
  if (seconds >= 3600)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.max(0, Math.floor(seconds / 60))}m`;
}
export function resourceSample(server: HomeServer, now: number): ResourceSample {
  const host = server.host;
  return {
    time: now,
    cpu: server.online ? (host?.cpu.usage ?? null) : null,
    memory: server.online ? ratio(host?.memory.usedBytes, host?.memory.totalBytes) : null,
    swap:
      server.online && host?.swap.supported
        ? ratio(host.swap.usedBytes, host.swap.totalBytes)
        : null,
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
export function quotaRange(server: HomeServer) {
  const disk = server.host?.disks.find((item) => item.availableBytes !== null);
  const available = server.storage?.freeBytes ?? disk?.availableBytes ?? 0;
  const used = server.storage?.usedBytes ?? 0;
  const current = server.settings?.storageLimitBytes ?? 0;
  return Math.max(1, Math.ceil((available + used) / GIB), Math.ceil(current / GIB));
}
