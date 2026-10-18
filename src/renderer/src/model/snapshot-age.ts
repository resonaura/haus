/** Age of the last successfully displayed snapshot, not the last polling attempt. */
export function snapshotAgeSeconds(updatedAt: number, now: number): number | undefined {
  return updatedAt > 0 && Number.isFinite(updatedAt) && Number.isFinite(now)
    ? Math.max(0, Math.floor((now - updatedAt) / 1000))
    : undefined;
}
