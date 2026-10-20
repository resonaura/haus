import { parseColor } from '@heroui/react';
import { expect, it } from 'vitest';
import { lightColor } from '../../model/light-color';
import { sceneTargetEntity } from '../../model/scene-target';

it.each([
  [{ hs_color: [240, 100] }, '#0000ff'],
  [{ xy_color: [0.3, 0.6] }, '#00ff00'],
  [{ rgb_color: [245, 111, 155] }, '#f56f9b'],
  [{ color_temp_kelvin: 2700 }, '#ffa757'],
])('opens the HeroUI colour picker for a stored %j target', (setting, expected) => {
  const preview = sceneTargetEntity(
    {
      entity_id: 'light.fixture',
      state: 'off',
      last_changed: '',
      attributes: { color_mode: 'color_temp', color_temp_kelvin: 3000, rgb_color: [255, 50, 0] },
    },
    { state: 'on', ...setting },
  );
  expect(parseColor(lightColor(preview)!).toString('hex').toLowerCase()).toBe(expected);
});
