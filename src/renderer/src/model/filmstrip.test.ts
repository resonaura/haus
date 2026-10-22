import { describe, it, expect } from 'vitest';
import { filmstripLayout, filmstripRange, filmstripTarget, filmstripIndex } from './filmstrip';
import type { CameraEvent } from './camera-history';
const event = (i: number): CameraEvent => ({
  id: String(i),
  cameraId: 'camera.test',
  startAt: i * 1000,
  endAt: (i + 1) * 1000,
  status: 'ready',
  kinds: ['motion'],
  duration: 20,
  bytes: 1,
});
describe('bounded camera filmstrip', () => {
  it('only mounts a small window of a hundred thousand clips', () => {
    const layout = filmstripLayout(
      Array.from({ length: 100000 }, (_, i) => event(i)),
      [],
    );
    const range = filmstripRange(layout, layout.offsets[50000], 1200);
    expect(range.end - range.start).toBeLessThan(22);
    expect(range.start).toBeLessThan(50000);
    expect(range.end).toBeGreaterThan(50000);
    expect(filmstripIndex(layout, layout.offsets[99999])).toBe(99999);
  });
  it('keeps the live edge at the end and does not invent playback time during a stall', () => {
    const layout = filmstripLayout([event(0), event(1)], []);
    expect(filmstripTarget(layout, undefined, 0, 0)).toBe(layout.size);
    expect(filmstripTarget(layout, '0', 10, 20)).toBe(43);
    expect(filmstripTarget(layout, '0', 10, 20)).toBe(43);
    expect(filmstripTarget(layout, '1', 999, 20)).toBe(layout.size - 5);
    expect(filmstripIndex(layout, filmstripTarget(layout, undefined, 0, 0))).toBe(
      layout.items.length,
    );
  });
  it('virtualizes around a fixed bar playhead as playback controls change viewport width', () => {
    const layout = filmstripLayout(
      Array.from({ length: 100 }, (_, i) => event(i)),
      [],
    );
    const left = layout.offsets[50] + 43;
    // The bar center stays at x=400; its left edge slides from 8 to 50.
    for (let gutter = 0; gutter <= 42; gutter += 3) {
      const viewportLeft = 8 + gutter;
      const center = 400 - viewportLeft;
      const width = 742 - gutter;
      const range = filmstripRange(layout, left, width, 0, center);
      expect(range.start).toBe(filmstripIndex(layout, left - center));
      expect(range.end).toBe(filmstripIndex(layout, left + width - center) + 1);
      expect(viewportLeft + center + layout.offsets[50] + 43 - left).toBe(400);
      expect(range.start).toBeLessThan(50);
      expect(range.end).toBeGreaterThan(50);
    }
  });
  it('includes offline intervals, gaps, and empty histories', () => {
    const empty = filmstripLayout([], []);
    expect(filmstripRange(empty, 0, 800)).toEqual({ start: 0, end: 0 });
    const layout = filmstripLayout(
      [event(0), event(2)],
      [{ cameraId: 'camera.test', startAt: 1000, endAt: 2000, state: 'offline' }],
    );
    expect(layout.items[1].type).toBe('offline');
    expect(layout.widths[1]).toBe(58);
    expect(filmstripIndex(layout, 88)).toBe(1);
  });
  it('collapses consecutive offline observations into one card without merging across footage', () => {
    const periods = [1, 2, 4, 5].map((i) => ({
      cameraId: 'camera.test',
      startAt: i * 1000,
      endAt: i * 1000 + 500,
      state: 'offline' as const,
    }));
    const layout = filmstripLayout([event(0), event(3)], periods);
    expect(layout.items.map((item) => item.type)).toEqual([
      'recording',
      'offline',
      'recording',
      'offline',
    ]);
    expect(layout.items[1]).toMatchObject({ periods: 2 });
    expect(periods[0].endAt).toBe(1500);
  });
});
