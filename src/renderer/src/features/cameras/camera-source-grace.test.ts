import { describe, expect, it } from 'vitest';
import { cameraSourceAvailable, CameraSourceGrace } from './camera-source-grace';

describe('camera source availability grace', () => {
  it('keeps an established live source through a bounded HA availability wobble', () => {
    const source = new CameraSourceGrace('streaming');
    expect(source.observe('unavailable', 1000)).toBe(true);
    expect(source.remaining(1000)).toBe(30_000);
    expect(source.observe('unknown', 20_000)).toBe(true);
    expect(source.remaining(20_000)).toBe(11_000);
    expect(source.observe('unavailable', 30_999)).toBe(true);
    expect(source.observe('unavailable', 31_000)).toBe(false);
  });

  it('recovers immediately when Home Assistant reports the source again', () => {
    const source = new CameraSourceGrace('streaming');
    expect(source.observe('unavailable', 100)).toBe(true);
    expect(source.observe('idle', 500)).toBe(true);
    expect(source.remaining(500)).toBe(0);
    expect(source.observe('unknown', 600)).toBe(true);
  });

  it('keeps an initial outage blocked and an explicit off state immediate', () => {
    expect(cameraSourceAvailable('unavailable')).toBe(false);
    const initial = new CameraSourceGrace('unavailable');
    expect(initial.observe('unknown', 1)).toBe(false);

    const disabled = new CameraSourceGrace('streaming');
    expect(disabled.observe('off', 1)).toBe(false);
    expect(disabled.observe('unavailable', 2)).toBe(false);
    expect(disabled.observe('idle', 3)).toBe(true);
  });
});
