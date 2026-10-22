import {
  chronologicalRecordings,
  type CameraAvailability,
  type CameraEvent,
} from './camera-history';
export type FilmstripItem =
  | { type: 'recording'; event: CameraEvent }
  | { type: 'offline'; period: CameraAvailability; periods?: number };
export function filmstripLayout(events: CameraEvent[], offline: CameraAvailability[]) {
  const ordered: FilmstripItem[] = [
    ...chronologicalRecordings(events).map((event) => ({ type: 'recording' as const, event })),
    ...offline
      .filter((p) => p.state === 'offline' && p.endAt > p.startAt)
      .map((period) => ({ type: 'offline' as const, period })),
  ].sort(
    (a, b) =>
      (a.type === 'recording' ? a.event.startAt : a.period.startAt) -
      (b.type === 'recording' ? b.event.startAt : b.period.startAt),
  );
  // A run with no recorded video is one quiet card, even if the helper observed
  // several separate outages. The day ruler keeps their individual intervals.
  const items: FilmstripItem[] = [];
  for (const item of ordered) {
    const previous = items.at(-1);
    if (
      item.type === 'offline' &&
      previous?.type === 'offline' &&
      item.period.cameraId === previous.period.cameraId
    ) {
      previous.period = {
        ...previous.period,
        endAt: Math.max(previous.period.endAt, item.period.endAt),
      };
      previous.periods = (previous.periods ?? 1) + 1;
    } else items.push({ ...item });
  }
  const offsets = new Float64Array(items.length);
  const widths = new Uint8Array(items.length);
  const byId = new Map<string, number>();
  let size = 0;
  items.forEach((item, i) => {
    offsets[i] = size;
    widths[i] = item.type === 'recording' ? 86 : 58;
    size += widths[i] + 5;
    if (item.type === 'recording') byId.set(item.event.id, i);
  });
  // Keep the live playhead one ordinary card gap after the final clip.
  return { items, offsets, widths, byId, size: items.length ? size : 0 };
}
export type FilmstripLayout = ReturnType<typeof filmstripLayout>;
/** First item whose right edge reaches x; O(log n), including gaps and empty collections. */
export function filmstripIndex(layout: FilmstripLayout, x: number) {
  let low = 0,
    high = layout.items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (layout.offsets[mid] + layout.widths[mid] < x) low = mid + 1;
    else high = mid;
  }
  return low;
}
export function filmstripRange(
  layout: FilmstripLayout,
  left: number,
  width: number,
  overscan = 180,
  center = width / 2,
) {
  const start = filmstripIndex(layout, Math.max(0, left - center - overscan));
  const end = Math.min(
    layout.items.length,
    filmstripIndex(layout, left + width - center + overscan) + 1,
  );
  return { start, end };
}
export function filmstripTarget(
  layout: FilmstripLayout,
  id: string | undefined,
  seconds: number,
  duration: number,
) {
  const index = id ? layout.byId.get(id) : undefined;
  return index === undefined
    ? layout.size
    : layout.offsets[index] +
        layout.widths[index] * Math.min(1, Math.max(0, seconds / Math.max(0.01, duration)));
}
