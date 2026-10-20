import { expect, it } from 'vitest';
import { isScenePickerTarget } from './scene-picker';
import type { HassEntity, HausAccessory } from './types';

const state = (id: string): HassEntity => ({
  entity_id: id,
  state: 'on',
  attributes: {},
  last_changed: '',
});
it('offers physical controls and individual outlets, excluding registry service entries', () => {
  for (const id of [
    'light.lamp',
    'switch.strip_socket_2',
    'climate.home',
    'input_boolean.guest_mode',
  ])
    expect(isScenePickerTarget(state(id))).toBe(true);
  for (const entry of [
    { disabled_by: 'user' },
    { hidden_by: 'integration' },
    { entity_category: 'diagnostic' },
    { entity_category: 'config' },
  ])
    expect(isScenePickerTarget(state('switch.test'), { entity_id: 'switch.test', ...entry })).toBe(
      false,
    );
  expect(
    isScenePickerTarget(state('switch.virtual_scene'), undefined, {
      isService: true,
    } as HausAccessory),
  ).toBe(false);
  expect(isScenePickerTarget(state('sensor.battery'))).toBe(false);
  const segment = state('light.lamp_segment_1');
  expect(
    isScenePickerTarget(segment, undefined, { primaryEntityId: 'light.lamp' } as HausAccessory),
  ).toBe(false);
  expect(isScenePickerTarget(state('climate.zone_1'))).toBe(true);
  expect(
    isScenePickerTarget(state('light.zone_1'), undefined, {
      primaryEntityId: 'light.zone_1',
    } as HausAccessory),
  ).toBe(true);
});
