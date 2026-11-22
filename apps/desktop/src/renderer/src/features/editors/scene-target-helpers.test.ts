/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import type { HassEntity, HausAccessory } from '../../model';
import {
  describeSceneTarget,
  inferSceneTargetDomain,
  missingSceneTargetAccessory,
  missingSceneTargetColor,
  missingSceneTargetName,
  replaceSceneEntity,
  scenePreviewAccessory,
  toggleSceneTargetState,
  transferSceneTarget,
} from './scene-target-helpers';

const entity = (
  entity_id: string,
  state = 'on',
  attributes: Record<string, unknown> = {},
): HassEntity => ({
  entity_id,
  state,
  attributes,
  last_changed: '',
});

describe('scene target helpers: unified preview, missing devices, and replacement', () => {
  it('infers domain, display name, and unavailable accessory for missing HA and Hub IDs', () => {
    expect(inferSceneTargetDomain('light.bedroom_lamp', { state: 'on' })).toBe('light');
    expect(inferSceneTargetDomain('ha:entry1:light.desk_lamp', { state: 'on' })).toBe('light');
    expect(inferSceneTargetDomain('ep_cover.living_blinds', { state: 'open' })).toBe('cover');
    expect(
      inferSceneTargetDomain('zigbee:0x1234:1', {
        state: 'on',
        brightness: 180,
        rgb_color: [255, 0, 0],
      }),
    ).toBe('light');
    expect(inferSceneTargetDomain('custom:node:2', { state: 'heat', temperature: 22 })).toBe(
      'climate',
    );

    expect(missingSceneTargetName('light.bedroom_ceiling_lamp')).toBe('Bedroom Ceiling Lamp');
    expect(missingSceneTargetName('ha:entry1:light.desk_lamp')).toBe('Desk Lamp');
    expect(missingSceneTargetName('ep_cover.living_blinds')).toBe('Living Blinds');

    const missing = missingSceneTargetAccessory('ha:entry1:light.desk_lamp', {
      state: 'on',
      brightness: 204,
      color_temp_kelvin: 2700,
    });
    expect(missing.availability).toBe('unavailable');
    expect(missing.category).toBe('lights');
    expect(missing.state.state).toBe('unavailable');
    expect(missing.name).toBe('Desk Lamp');
    expect(
      describeSceneTarget('ha:entry1:light.desk_lamp', undefined, {
        state: 'on',
        brightness: 204,
        color_temp_kelvin: 2700,
      }),
    ).toBe('Unavailable · On · 80% · 2700 K');
    expect(
      missingSceneTargetColor('ha:entry1:light.desk_lamp', {
        state: 'on',
        rgb_color: [255, 120, 40],
      }),
    ).toBe('rgb(255, 120, 40)');
  });

  it('builds a clean scene preview accessory without live-only overrides', () => {
    const liveClimate = entity('climate.bedroom', 'off', {
      friendly_name: 'Bedroom Thermostat',
      current_temperature: 24,
      temperature: 19,
      hvac_modes: ['off', 'heat', 'cool'],
    });
    const owner: HausAccessory = {
      id: 'dev-climate',
      primaryEntityId: 'climate.bedroom',
      entityIds: ['climate.bedroom'],
      category: 'climate',
      name: 'Bedroom Thermostat',
      availability: 'available',
      capabilities: [],
      state: liveClimate,
      secondaryEntities: [],
      powerStrip: true,
    };
    const preview = scenePreviewAccessory(
      'climate.bedroom',
      liveClimate,
      owner,
      { state: 'heat', temperature: 21 },
      true,
    );
    expect(preview.powerStrip).toBeUndefined();
    expect(preview.state.state).toBe('heat');
    expect(preview.state.attributes.current_temperature).toBeUndefined();
    expect(
      describeSceneTarget('climate.bedroom', liveClimate, { state: 'heat', temperature: 21 }),
    ).toBe('21° · Heat');
  });

  it('quick-toggles target states while keeping saved attributes', () => {
    const light = entity('light.lamp', 'on');
    expect(
      toggleSceneTargetState('light.lamp', light, {
        state: 'on',
        brightness: 180,
        color_temp_kelvin: 2700,
      }),
    ).toEqual({ state: 'off', brightness: 180, color_temp_kelvin: 2700 });
    expect(
      toggleSceneTargetState('light.lamp', light, {
        state: 'off',
        brightness: 180,
        color_temp_kelvin: 2700,
      }),
    ).toEqual({ state: 'on', brightness: 180, color_temp_kelvin: 2700 });
    expect(
      toggleSceneTargetState('cover.blinds', undefined, { state: 'open', current_position: 50 }),
    ).toEqual({
      state: 'closed',
    });
    expect(toggleSceneTargetState('lock.front', undefined, { state: 'locked' })).toEqual({
      state: 'unlocked',
    });
  });

  it('transfers saved values cleanly when replacing a missing device across capability profiles', () => {
    const ctAndRgbTarget = entity('light.new_bulb', 'off', {
      supported_color_modes: ['rgb', 'color_temp'],
      min_color_temp_kelvin: 2700,
      max_color_temp_kelvin: 5000,
      effect_list: ['Candle', 'Fireplace'],
    });
    expect(
      transferSceneTarget(
        {
          state: 'on',
          brightness: 200,
          color_temp_kelvin: 2200,
          color_mode: 'color_temp',
          effect: 'Candle',
        },
        ctAndRgbTarget,
      ),
    ).toEqual({
      state: 'on',
      brightness: 200,
      color_temp_kelvin: 2700,
      color_mode: 'color_temp',
      effect: 'Candle',
    });

    const rgbOnlyTarget = entity('light.rgb_strip', 'off', {
      supported_color_modes: ['rgb'],
    });
    const converted = transferSceneTarget(
      { state: 'on', brightness: 150, color_temp_kelvin: 2700, color_mode: 'color_temp' },
      rgbOnlyTarget,
    );
    expect(converted.state).toBe('on');
    expect(converted.brightness).toBe(150);
    expect(converted.color_mode).toBe('rgb');
    expect(Array.isArray(converted.rgb_color)).toBe(true);

    const dimmerOnly = entity('light.dimmer', 'off', {
      supported_color_modes: ['brightness'],
    });
    expect(
      transferSceneTarget(
        { state: 'on', brightness: 140, rgb_color: [255, 0, 0], effect: 'Candle' },
        dimmerOnly,
      ),
    ).toEqual({
      state: 'on',
      brightness: 140,
      color_mode: 'brightness',
    });

    const switchTarget = entity('switch.smart_plug', 'off');
    expect(transferSceneTarget({ state: 'on', brightness: 140 }, switchTarget)).toEqual({
      state: 'on',
    });

    const climateTarget = entity('climate.ac', 'off', {
      hvac_modes: ['off', 'cool', 'auto'],
      min_temp: 16,
      max_temp: 30,
      preset_modes: ['eco', 'boost'],
    });
    expect(
      transferSceneTarget({ state: 'heat', temperature: 32, preset_mode: 'eco' }, climateTarget),
    ).toEqual({
      state: 'auto',
      temperature: 30,
      preset_mode: 'eco',
    });

    const coverTarget = entity('cover.shades', 'closed');
    expect(transferSceneTarget({ state: 'open', current_position: 65 }, coverTarget)).toEqual({
      state: 'open',
      current_position: 65,
    });
  });

  it('replaces a missing entity key without mutating the scene map or other targets', () => {
    const original: Record<string, unknown> = {
      'ha:old:light.deleted': { state: 'on', brightness: 180, rgb_color: [255, 140, 80] },
      'light.existing': { state: 'off' },
    };
    const replacement = entity('light.floor_lamp', 'off', {
      supported_color_modes: ['rgb', 'color_temp'],
    });
    const next = replaceSceneEntity(original, 'ha:old:light.deleted', replacement);
    expect(next).toEqual({
      'light.existing': { state: 'off' },
      'light.floor_lamp': {
        state: 'on',
        brightness: 180,
        rgb_color: [255, 140, 80],
        color_mode: 'rgb',
      },
    });
    expect('ha:old:light.deleted' in original).toBe(true);
  });
});
