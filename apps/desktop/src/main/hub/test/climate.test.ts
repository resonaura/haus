/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import { translateService } from '../commands';
import { buildView } from '../entities';
import { parseDevices, parseStates } from '../types';

describe('Desktop Climate Compatibility & Commands (P18.6.2.4)', () => {
  const devices = parseDevices({
    devices: [
      {
        id: 'tv_place_ac',
        name: 'TV Place AC',
        category: 'climate',
        roomId: 'tv_place',
        availability: 'online',
        endpoints: [
          {
            id: 'ep_climate',
            name: 'TV Place AC',
            capabilities: [
              {
                id: 'climate',
                kind: 'climate',
                operations: [
                  'set_temperature',
                  'set_hvac_mode',
                  'set_fan_mode',
                  'set_swing_mode',
                  'turn_on',
                  'turn_off',
                ],
                choices: ['cool', 'heat', 'fan_only', 'dry', 'heat_cool', 'off'],
                minimum: 10,
                maximum: 30,
                step: 1,
              },
              {
                id: 'target_temperature',
                kind: 'numeric',
                operations: ['set'],
                minimum: 10,
                maximum: 30,
                step: 1,
              },
              {
                id: 'current_temperature',
                kind: 'numeric',
                operations: [],
              },
            ],
          },
        ],
      },
    ],
  });

  const states = parseStates({
    states: {
      ep_climate: {
        state: 'cool',
        hvac_mode: 'cool',
        on_off: true,
        current_temperature: 24.5,
        target_temperature: 22.0,
        fan_mode: 'auto',
        fan_modes: ['quiet', 'low', 'medium_low', 'medium', 'medium_high', 'high', 'auto'],
        swing_mode: 'stopped',
        swing_modes: ['stopped', 'rangefull'],
      },
    },
  });

  it('projects Sensibo AC to HA climate entity with comprehensive attributes', () => {
    const view = buildView(devices, states);
    const entity = view.states.find((s) => s.entity_id === 'climate.tv_place_ac');
    expect(entity).toBeDefined();
    expect(entity?.state).toBe('cool');
    expect(entity?.attributes.friendly_name).toBe('TV Place AC');
    expect(entity?.attributes.current_temperature).toBe(24.5);
    expect(entity?.attributes.temperature).toBe(22.0);
    expect(entity?.attributes.min_temp).toBe(10);
    expect(entity?.attributes.max_temp).toBe(30);
    expect(entity?.attributes.target_temp_step).toBe(1);
    expect(entity?.attributes.hvac_modes).toEqual([
      'cool',
      'heat',
      'fan_only',
      'dry',
      'heat_cool',
      'off',
    ]);
    expect(entity?.attributes.fan_mode).toBe('auto');
    expect(entity?.attributes.fan_modes).toEqual([
      'quiet',
      'low',
      'medium_low',
      'medium',
      'medium_high',
      'high',
      'auto',
    ]);
    expect(entity?.attributes.swing_mode).toBe('stopped');
    expect(entity?.attributes.swing_modes).toEqual(['stopped', 'rangefull']);
    // Features: 1 (target temp) + 8 (fan mode) + 32 (swing mode) = 41
    expect(entity?.attributes.supported_features).toBe(41);
  });

  it('translates climate service calls into HubCommands', () => {
    const view = buildView(devices, states);
    const target = { entity_id: 'climate.tv_place_ac' };

    // 1. set_temperature
    const tempCmd = translateService(
      view.bindings,
      { service: 'set_temperature', target, service_data: { temperature: 23 } },
      () => true,
    );
    expect(tempCmd).toEqual([
      {
        deviceId: 'tv_place_ac',
        endpointId: 'ep_climate',
        capability: 'target_temperature',
        command: 'set',
        parameters: { value: 23, target_temperature: 23 },
      },
    ]);

    // 2. set_hvac_mode
    const hvacCmd = translateService(
      view.bindings,
      { service: 'set_hvac_mode', target, service_data: { hvac_mode: 'heat' } },
      () => true,
    );
    expect(hvacCmd).toEqual([
      {
        deviceId: 'tv_place_ac',
        endpointId: 'ep_climate',
        capability: 'hvac_mode',
        command: 'set',
        parameters: { value: 'heat', hvac_mode: 'heat' },
      },
    ]);

    // 3. set_fan_mode
    const fanCmd = translateService(
      view.bindings,
      { service: 'set_fan_mode', target, service_data: { fan_mode: 'quiet' } },
      () => true,
    );
    expect(fanCmd).toEqual([
      {
        deviceId: 'tv_place_ac',
        endpointId: 'ep_climate',
        capability: 'fan_mode',
        command: 'set',
        parameters: { value: 'quiet', fan_mode: 'quiet' },
      },
    ]);

    // 4. set_swing_mode
    const swingCmd = translateService(
      view.bindings,
      { service: 'set_swing_mode', target, service_data: { swing_mode: 'rangefull' } },
      () => true,
    );
    expect(swingCmd).toEqual([
      {
        deviceId: 'tv_place_ac',
        endpointId: 'ep_climate',
        capability: 'swing_mode',
        command: 'set',
        parameters: { value: 'rangefull', swing_mode: 'rangefull' },
      },
    ]);

    // 5. turn_on / turn_off
    const onCmd = translateService(
      view.bindings,
      { service: 'turn_on', target, service_data: {} },
      () => true,
    );
    expect(onCmd).toEqual([
      {
        deviceId: 'tv_place_ac',
        endpointId: 'ep_climate',
        capability: 'on_off',
        command: 'turn_on',
      },
    ]);

    const offCmd = translateService(
      view.bindings,
      { service: 'turn_off', target, service_data: {} },
      () => true,
    );
    expect(offCmd).toEqual([
      {
        deviceId: 'tv_place_ac',
        endpointId: 'ep_climate',
        capability: 'on_off',
        command: 'turn_off',
      },
    ]);

    // 6. Unsupported service
    expect(() =>
      translateService(
        view.bindings,
        { service: 'set_preset_mode', target, service_data: { preset_mode: 'eco' } },
        () => true,
      ),
    ).toThrow('This climate device does not support set_preset_mode.');
  });
});
