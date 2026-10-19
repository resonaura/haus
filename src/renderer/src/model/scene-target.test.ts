import { expect, it } from 'vitest';
import { captureSceneTarget, patchSceneTarget } from './scene-target';
import type { HassEntity } from './types';
it('keeps the original draft intact while replacing competing light colour modes', () => {
  const original = {
    state: 'on',
    brightness: 125,
    xy_color: [0.4, 0.5],
    color_temp: 300,
    effect: 'steady',
  };
  expect(patchSceneTarget(original, 'rgb_color', [255, 0, 0])).toEqual({
    state: 'on',
    brightness: 125,
    effect: 'steady',
    rgb_color: [255, 0, 0],
  });
  expect(original.color_temp).toBe(300);
});
it('captures relevant settings without copying metadata or a stale colour mode into a new scene', () => {
  const entity = {
    entity_id: 'light.test',
    last_changed: '2026-01-01T00:00:00Z',
    state: 'on',
    attributes: {
      friendly_name: 'Test',
      color_mode: 'color_temp',
      color_temp_kelvin: 2500,
      rgb_color: [255, 0, 0],
      brightness: 100,
      access_token: 'fixture',
    },
  } as HassEntity;
  expect(captureSceneTarget(entity)).toEqual({
    state: 'on',
    color_temp_kelvin: 2500,
    brightness: 100,
  });
});
