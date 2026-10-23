/** Age of the last successfully displayed snapshot, not the last polling attempt. */
export function snapshotAgeSeconds(updatedAt: number, now: number): number | undefined {
  return updatedAt > 0 && Number.isFinite(updatedAt) && Number.isFinite(now)
    ? Math.max(0, Math.floor((now - updatedAt) / 1000))
    : undefined;
}

/** One compact unit keeps old-frame badges readable without widening camera tiles. */
export function formatSnapshotAge(seconds: number): string {
  for (const [duration, suffix] of [
    [365 * 86400, 'y'],
    [30 * 86400, 'mo'],
    [86400, 'd'],
    [3600, 'h'],
    [60, 'm'],
  ] as const) {
    if (seconds >= duration) return `${Math.floor(seconds / duration)}${suffix}`;
  }
  return `${Math.max(0, Math.floor(seconds))}s`;
}
