/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import { translateService } from '../commands';
import { buildView } from '../entities';
import { parseDevices, parseStates } from '../types';

describe('Desktop Hue Scenes & Light Effects (P18.6.2.5)', () => {
  const devices = parseDevices({
    devices: [
      {
        id: 'bedroom_scene_device',
        name: 'Bedroom Scenes',
        category: 'generic',
        roomId: 'bedroom',
        availability: 'online',
        endpoints: [
          {
            id: 'scene.bedroom_hue_concentrate',
            name: 'Bedroom Concentrate',
            capabilities: [
              {
                id: 'scene',
                kind: 'action',
                operations: ['turn_on', 'activate'],
              },
            ],
          },
        ],
      },
      {
        id: 'guinea_pigs_lamp_device',
        name: 'Guinea Pigs Lamp',
        category: 'lighting',
        roomId: 'living_room',
        availability: 'online',
        endpoints: [
          {
            id: 'light.guinea_pigs_lamp',
            name: 'Guinea Pigs Lamp',
            capabilities: [
              {
                id: 'on_off',
                kind: 'binary',
                operations: ['turn_on', 'turn_off', 'set'],
                effectList: ['off', 'candle', 'fire', 'prism'],
              },
              {
                id: 'brightness',
                kind: 'numeric',
                operations: ['set'],
              },
            ],
          },
        ],
      },
    ],
  });

  const states = parseStates({
    states: {
      'scene.bedroom_hue_concentrate': {
        state: 'available',
        group_name: 'Bedroom',
        brightness: 254,
        speed: 0.5,
        is_dynamic: false,
      },
      'light.guinea_pigs_lamp': {
        state: 'on',
        on_off: true,
        brightness: 204,
        effect: 'candle',
      },
    },
  });

  it('projects Hue scenes and light effects into desktop entities', () => {
    const view = buildView(devices, states);

    // Verify scene entity
    const sceneEntity = view.states.find((s) => s.entity_id === 'scene.bedroom_scene_device');
    expect(sceneEntity).toBeDefined();
    expect(sceneEntity?.attributes.group_name).toBe('Bedroom');
    expect(sceneEntity?.attributes.brightness).toBe(254);
    expect(sceneEntity?.attributes.speed).toBe(0.5);

    // Verify light entity with effects
    const lightEntity = view.states.find((s) => s.entity_id === 'light.guinea_pigs_lamp_device');
    expect(lightEntity).toBeDefined();
    expect(lightEntity?.state).toBe('on');
    expect(lightEntity?.attributes.effect).toBe('candle');
    expect(lightEntity?.attributes.effect_list).toEqual(['off', 'candle', 'fire', 'prism']);
  });

  it('translates scene.turn_on and light.turn_on with effects into HubCommands', () => {
    const view = buildView(devices, states);

    // 1. scene.turn_on
    const sceneCmd = translateService(
      view.bindings,
      {
        service: 'turn_on',
        target: { entity_id: 'scene.bedroom_scene_device' },
        service_data: {},
      },
      () => true,
    );
    expect(sceneCmd).toEqual([
      {
        deviceId: 'bedroom_scene_device',
        endpointId: 'scene.bedroom_hue_concentrate',
        capability: 'scene',
        command: 'turn_on',
      },
    ]);

    // 2. light.turn_on with effect
    const lightCmd = translateService(
      view.bindings,
      {
        service: 'turn_on',
        target: { entity_id: 'light.guinea_pigs_lamp_device' },
        service_data: { effect: 'fire', brightness_pct: 80 },
      },
      () => true,
    );
    expect(lightCmd).toEqual([
      {
        deviceId: 'guinea_pigs_lamp_device',
        endpointId: 'light.guinea_pigs_lamp',
        capability: 'on_off',
        command: 'turn_on',
        parameters: {
          effect: 'fire',
          brightness: 204,
        },
      },
    ]);
  });
});
