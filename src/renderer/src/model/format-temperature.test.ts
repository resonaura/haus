import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from './demo';
import { normalizeHome } from './normalize';
import { describeAccessory } from './presentation';
import { formatTemperature } from './format-temperature';

describe('formatTemperature', () => {
  it('removes floating point tails while keeping useful decimal precision', () => {
    const formatted = formatTemperature('21.3999996185303');
    expect(formatted).toBeDefined();
    expect(Number(formatted)).toBe(21.4);
  });

  it('respects Home Assistant display precision without forcing trailing zeroes', () => {
    expect(Number(formatTemperature(21.3999996185303, 2))).toBe(21.4);
    expect(Number(formatTemperature(21.5, 0))).toBe(22);
  });

  it('shows a rounded temperature sensor value on its device card', () => {
    const snapshot = createDemoSnapshot();
    const entityId = 'sensor.narnia_temperature';
    snapshot.states.push({
      entity_id: entityId,
      state: '21.3999996185303',
      attributes: { device_class: 'temperature', unit_of_measurement: '°C' },
      last_changed: '',
    });
    const accessory = normalizeHome(snapshot).accessories.find((item) => item.id === entityId);
    expect(accessory).toBeDefined();
    expect(describeAccessory(accessory!)).toBe('21.4°C');
  });

  it.each([undefined, null, '', 'unknown', 'unavailable', NaN, Infinity])(
    'does not format an unknown reading (%s)',
    (value) => {
      expect(formatTemperature(value)).toBeUndefined();
    },
  );
});
