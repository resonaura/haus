import { describe, expect, it } from 'vitest';
import { lightColor } from './light-color';
import type { HassEntity } from './types';
const color = (attributes: Record<string, unknown>) =>
  lightColor({
    entity_id: 'light.preview',
    state: 'on',
    attributes,
    last_changed: '',
  } as HassEntity);

describe('reported and scene light colours', () => {
  it('renders HA hue/saturation as HSV, preserving white and pastel targets', () => {
    expect(color({ color_mode: 'hs', hs_color: [48, 2] })).toBe('rgb(255, 254, 250)');
    expect(color({ hs_color: [0, 0] })).toBe('rgb(255, 255, 255)');
    expect(color({ hs_color: [255, 68] })).toBe('rgb(125, 82, 255)');
    expect(color({ hs_color: [360, 100] })).toBe('rgb(255, 0, 0)');
  });
  it('honours the stored colour mode over redundant or stale derived formats', () => {
    expect(color({ color_mode: 'hs', hs_color: [120, 100], rgb_color: [255, 0, 0] })).toBe(
      'rgb(0, 255, 0)',
    );
    expect(color({ color_mode: 'xy', xy_color: [0.3, 0.6], rgb_color: [255, 0, 0] })).toBe(
      'rgb(0, 255, 0)',
    );
    expect(
      color({ color_mode: 'color_temp', color_temp_kelvin: 2700, rgb_color: [0, 0, 255] }),
    ).toBe('rgb(255, 167, 87)');
    expect(color({ color_mode: 'brightness', rgb_color: [255, 0, 0] })).toBeUndefined();
  });
  it('supports white channels without accepting malformed colours', () => {
    expect(color({ color_mode: 'rgbw', rgbw_color: [0, 25, 100, 100] })).toBe('rgb(100, 125, 200)');
    expect(color({ color_mode: 'rgbww', rgbww_color: [0, 0, 0, 255, 0] })).toBe(
      'rgb(255, 255, 255)',
    );
    expect(color({ color_mode: 'hs', hs_color: [NaN, 5], rgb_color: [255, 0, 0] })).toBeUndefined();
  });
});
