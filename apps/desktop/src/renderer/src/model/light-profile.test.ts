/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { applyDemoAction, buildAction } from './actions';
import { resolveCapabilities } from './capabilities';
import { binaryStateDescription, deviceAppearance, deviceSurfaceVars } from './device-appearance';
import { lightColor } from './light-color';
import {
  lightActiveEffect,
  lightProfile,
  lightStateDescription,
  lightTemperature,
} from './light-profile';
import type { HassEntity, Snapshot } from './types';

const entity = (
  entity_id: string,
  state: string,
  attributes: Record<string, unknown> = {},
): HassEntity => ({
  entity_id,
  state,
  attributes,
  last_changed: '2026-10-17T18:00:00Z',
});
const services: Snapshot['services'] = {
  light: { turn_on: {}, turn_off: {} },
  switch: { turn_on: {}, turn_off: {} },
};

describe('light controls follow advertised capabilities', () => {
  it.each([
    [['rgb'], ['toggle', 'brightness', 'color']],
    [['color_temp'], ['toggle', 'brightness', 'temperature']],
    [['brightness'], ['toggle', 'brightness']],
    [['onoff'], ['toggle']],
    [
      ['rgb', 'color_temp'],
      ['toggle', 'brightness', 'color', 'temperature'],
    ],
  ])('exposes only the controls supported by %j', (modes, expected) => {
    const light = entity('light.example', 'on', {
      supported_color_modes: modes,
      brightness: 128,
      rgb_color: [255, 0, 0],
    });
    expect(resolveCapabilities(light, services)).toEqual(expected);
  });

  it('keeps a switch as a power control even if an integration supplies stray light attributes', () => {
    const plug = entity('switch.plug', 'on', { supported_color_modes: ['rgb'], brightness: 255 });
    expect(resolveCapabilities(plug, services)).toEqual(['toggle']);
  });

  it('does not claim brightness or color from stale attributes on an on/off light', () => {
    const relay = entity('light.relay', 'on', {
      supported_color_modes: ['onoff'],
      brightness: 255,
      rgb_color: [255, 0, 0],
    });
    expect(lightProfile(relay).kind).toBe('onoff');
    expect(lightStateDescription(relay)).toBe('On');
    expect(lightColor(relay)).toBeUndefined();
  });

  it('uses temperature for a white light and reports its actual brightness without adding a color picker', () => {
    const white = entity('light.white', 'on', {
      supported_color_modes: ['color_temp'],
      color_mode: 'color_temp',
      color_temp_kelvin: 2700,
      brightness: 128,
      rgb_color: [0, 0, 255],
    });
    expect(lightProfile(white)).toMatchObject({
      kind: 'temperature',
      color: false,
      brightness: true,
    });
    expect(lightColor(white)).toBe('rgb(255, 167, 87)');
    expect(lightStateDescription(white)).toBe('50% brightness · 2700 K');
    expect(lightTemperature(entity('light.legacy', 'on', { color_temp: 400 }))).toBe(2500);
  });

  it('does not fabricate brightness when the state does not report it', () => {
    expect(
      lightStateDescription(
        entity('light.dimmer', 'on', { supported_color_modes: ['brightness'] }),
      ),
    ).toBe('On');
    expect(
      lightStateDescription(
        entity('light.dimmer', 'off', { supported_color_modes: ['brightness'], brightness: 255 }),
      ),
    ).toBe('Off');
  });
});

describe('active device appearance', () => {
  it.each([
    ['switch.plug', 'on'],
    ['media_player.tv', 'playing'],
    ['binary_sensor.door', 'on'],
    ['climate.home', 'heat'],
    ['sensor.printer', 'Printing'],
    ['sensor.router', 'online'],
  ])('uses the same neutral highlight for %s', (id, state) => {
    expect(deviceAppearance(entity(id, state))).toEqual({
      active: true,
      accent: 'var(--device-neutral)',
      actualColor: undefined,
    });
  });

  it('retains actual lamp color and a warm fallback for dimmable and on/off lights', () => {
    expect(
      deviceAppearance(
        entity('light.color', 'on', { color_mode: 'rgb', rgb_color: [127, 40, 255] }),
      ),
    ).toEqual({ active: true, accent: 'rgb(127, 40, 255)', actualColor: 'rgb(127, 40, 255)' });
    for (const mode of ['brightness', 'onoff']) {
      expect(
        deviceAppearance(entity('light.simple', 'on', { supported_color_modes: [mode] })),
      ).toEqual({ active: true, accent: 'var(--cat-lights)', actualColor: undefined });
    }
  });

  it('does not highlight an offline device or show its last light color as current', () => {
    expect(
      deviceAppearance(entity('light.offline', 'unavailable', { rgb_color: [255, 0, 0] })),
    ).toMatchObject({ active: false, actualColor: undefined });
  });

  it('uses a meaningful sensor state instead of on/off', () => {
    expect(
      binaryStateDescription(entity('binary_sensor.door', 'on', { device_class: 'door' })),
    ).toBe('Open');
    expect(
      binaryStateDescription(entity('binary_sensor.door', 'off', { device_class: 'door' })),
    ).toBe('Closed');
    expect(
      binaryStateDescription(entity('binary_sensor.leak', 'on', { device_class: 'moisture' })),
    ).toBe('Leak detected');
  });

  it('exposes light effect capabilities, active detection, visual motion appearance, and actions', () => {
    const lamp = entity('light.hue_lamp', 'on', {
      supported_color_modes: ['rgb', 'color_temp'],
      brightness: 204,
      color_mode: 'color_temp',
      color_temp_kelvin: 2700,
      effect_list: ['off', 'candle', 'fire', 'aurora'],
      effect: 'fire',
    });

    expect(resolveCapabilities(lamp, services)).toContain('effect');
    expect(lightActiveEffect(lamp)).toBe('fire');
    expect(lightStateDescription(lamp)).toBe('80% brightness · Fire');

    const appearance = deviceAppearance(lamp);
    expect(appearance.active).toBe(true);
    expect(appearance.effect).toMatchObject({
      id: 'fire',
      value: 'fire',
      label: 'Fire',
      icon: 'flame',
      motion: 'flicker',
    });
    expect(appearance.accent).toBe(appearance.effect?.palette[0]);
    expect(deviceSurfaceVars(appearance.accent, appearance.effect)).toMatchObject({
      '--device-color': appearance.effect?.palette[0],
      '--effect-c1': appearance.effect?.palette[0],
    });

    // Static or off effects are never treated as live animated effects.
    const stopped = entity('light.hue_lamp', 'on', {
      ...lamp.attributes,
      effect: 'off',
    });
    expect(lightActiveEffect(stopped)).toBeUndefined();
    expect(deviceAppearance(stopped).effect).toBeUndefined();
    expect(lightStateDescription(stopped)).toBe('80% brightness · 2700 K');

    expect(buildAction(lamp, 'effect', 'aurora')).toEqual({
      domain: 'light',
      service: 'turn_on',
      target: { entity_id: 'light.hue_lamp' },
      service_data: { effect: 'aurora' },
    });
    expect(() => buildAction(lamp, 'effect', 'unsupported_fx')).toThrow(
      'Choose an available light effect.',
    );

    const demoSnapshot: Snapshot = {
      config: { location_name: 'Demo', unit_system: { temperature: '°C' } },
      user: { name: 'Demo', is_admin: true },
      areas: [],
      devices: [],
      entities: [],
      states: [lamp],
      services,
    };
    const afterColor = applyDemoAction(demoSnapshot, buildAction(lamp, 'color', '#ff0000'));
    expect(afterColor.states[0]?.attributes.effect).toBe('off');
    const afterEffect = applyDemoAction(afterColor, buildAction(lamp, 'effect', 'aurora'));
    expect(afterEffect.states[0]?.attributes.effect).toBe('aurora');
  });
});
