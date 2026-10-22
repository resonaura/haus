import { describe, expect, it } from 'vitest';
import { snapTemperature, temperatureFromDialPoint } from './temperature-dial';

describe('kettle temperature dial', () => {
  it('snaps steps from the supported minimum and clamps to the range', () => {
    expect(snapTemperature(61.2, 40, 100, 0.5)).toBe(61);
    expect(snapTemperature(120, 40, 100, 1)).toBe(100);
  });

  it('maps the arc ends and midpoint to the temperature range', () => {
    expect(temperatureFromDialPoint(37.7, 142.3, 40, 100, 1)).toBe(40);
    expect(temperatureFromDialPoint(90, 16, 40, 100, 1)).toBe(70);
    expect(temperatureFromDialPoint(142.3, 142.3, 40, 100, 1)).toBe(100);
  });
});
