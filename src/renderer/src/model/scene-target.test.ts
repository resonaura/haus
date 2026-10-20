import { expect, it } from 'vitest';
import {
  captureSceneTarget,
  patchSceneTarget,
  sceneTargetEntity,
  sceneTargetSummary,
} from './scene-target';
import { lightColor } from './light-color';
import type { HassEntity } from './types';
it('keeps the original draft intact while replacing competing light colour modes', () => {
  const original = {
    state: 'on',
    brightness: 125,
    xy_color: [0.4, 0.5],
    color_temp: 300,
    effect: 'steady',
    color_mode: 'color_temp',
  };
  expect(patchSceneTarget(original, 'rgb_color', [255, 0, 0])).toEqual({
    state: 'on',
    brightness: 125,
    effect: 'steady',
    color_mode: 'rgb',
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
    color_mode: 'color_temp',
  });
});

it('captures the native colour representation instead of HA-derived alternatives', () => {
  const entity = {
    entity_id: 'light.hue',
    state: 'on',
    last_changed: '',
    attributes: {
      color_mode: 'xy',
      xy_color: [0.3, 0.6],
      hs_color: [120, 100],
      rgb_color: [0, 255, 0],
      color_temp_kelvin: 2700,
      brightness: 150,
    },
  };
  expect(captureSceneTarget(entity)).toEqual({
    state: 'on',
    color_mode: 'xy',
    xy_color: [0.3, 0.6],
    brightness: 150,
  });
  expect(patchSceneTarget(captureSceneTarget(entity), 'color_temp_kelvin', 3000)).toEqual({
    state: 'on',
    color_mode: 'color_temp',
    color_temp_kelvin: 3000,
    brightness: 150,
  });
});

it('converts legacy mired capture and ignores obsolete colours on a dimmer', () => {
  const entity = {
    entity_id: 'light.white',
    state: 'on',
    last_changed: '',
    attributes: {
      color_mode: 'color_temp',
      color_temp: 400,
      rgb_color: [0, 0, 255],
      brightness: 100,
    },
  };
  expect(captureSceneTarget(entity)).toEqual({
    state: 'on',
    color_mode: 'color_temp',
    color_temp_kelvin: 2500,
    brightness: 100,
  });
  expect(
    captureSceneTarget({
      ...entity,
      attributes: { ...entity.attributes, color_mode: 'brightness' },
    }),
  ).toEqual({
    state: 'on',
    color_mode: 'brightness',
    brightness: 100,
  });
  expect(
    captureSceneTarget({ ...entity, attributes: { ...entity.attributes, color_mode: 'onoff' } }),
  ).toEqual({ state: 'on', color_mode: 'onoff' });
  expect(sceneTargetSummary('light.white', { state: 'on', color_temp: 400 })).toBe('on · 2500 K');
});

it('previews stored HS and XY targets without the current light temperature or stale RGB', () => {
  const entity = {
    entity_id: 'light.hue',
    state: 'off',
    last_changed: '',
    attributes: {
      color_mode: 'color_temp',
      color_temp_kelvin: 2700,
      rgb_color: [255, 120, 0],
      supported_color_modes: ['xy', 'color_temp'],
    },
  };
  const hs = sceneTargetEntity(entity, { state: 'on', hs_color: [240, 100] });
  expect(hs.attributes).toEqual({
    color_mode: 'hs',
    hs_color: [240, 100],
    supported_color_modes: ['xy', 'color_temp'],
  });
  expect(lightColor(hs)).toBe('hsl(240, 100%, 50%)');
  const xy = sceneTargetEntity(entity, { state: 'on', xy_color: [0.3, 0.6] });
  expect(xy.attributes.color_mode).toBe('xy');
  expect(lightColor(xy)).toBe('rgb(0, 255, 0)');
  expect(entity.attributes.color_mode).toBe('color_temp');
});

it('replaces a stored colour mode when a user chooses a new colour', () => {
  expect(
    patchSceneTarget(
      { state: 'on', color_mode: 'color_temp', color_temp_kelvin: 3000, effect: 'slow' },
      'rgb_color',
      [255, 0, 0],
    ),
  ).toEqual({
    state: 'on',
    color_mode: 'rgb',
    rgb_color: [255, 0, 0],
    effect: 'slow',
  });
});
