/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import { translateService } from '../commands';
import { buildView } from '../entities';
import { parseDevices, parseStates } from '../types';

describe('Desktop Eero Network, Updates & Client Diagnostics (P18.6.2.6)', () => {
  const devices = parseDevices({
    devices: [
      {
        id: 'crawford_network_router',
        name: 'Crawford',
        category: 'network',
        roomId: 'system',
        availability: 'online',
        endpoints: [
          {
            id: 'select.crawford_preferred_update_time',
            name: 'Update Time',
            capabilities: [
              {
                id: 'select',
                kind: 'enum',
                operations: ['set', 'select_option'],
                choices: ['morning', 'afternoon', 'night'],
              },
            ],
          },
          {
            id: 'switch.crawford_guest_network',
            name: 'Guest Network',
            capabilities: [
              {
                id: 'on_off',
                kind: 'binary',
                operations: ['turn_on', 'turn_off', 'set'],
              },
            ],
          },
          {
            id: 'button.crawford_reboot',
            name: 'Reboot',
            capabilities: [
              {
                id: 'press',
                kind: 'action',
                operations: ['press'],
              },
            ],
          },
        ],
      },
      {
        id: 'tv_place_mesh_node',
        name: 'TV Place eero',
        category: 'network',
        roomId: 'tv_place',
        availability: 'online',
        endpoints: [
          {
            id: 'update.tv_place_eero_firmware',
            name: 'TV Place Firmware',
            capabilities: [
              {
                id: 'update',
                kind: 'update',
                operations: ['install'],
              },
            ],
          },
        ],
      },
      {
        id: 'andrii_profile',
        name: 'Andrii',
        category: 'network',
        roomId: 'system',
        availability: 'online',
        endpoints: [
          {
            id: 'device_tracker.andrii',
            name: 'Andrii Presence',
            capabilities: [
              {
                id: 'device_tracker',
                kind: 'event',
                operations: [],
                choices: ['home', 'not_home'],
              },
            ],
          },
        ],
      },
    ],
  });

  const states = parseStates({
    states: {
      'select.crawford_preferred_update_time': {
        select: 'night',
        state: 'night',
        options: ['morning', 'afternoon', 'night'],
      },
      'switch.crawford_guest_network': {
        on_off: false,
        state: 'off',
      },
      'button.crawford_reboot': {
        state: 'unknown',
      },
      'update.tv_place_eero_firmware': {
        update: true,
        state: 'on',
        installed_version: 'v6.16.0',
        latest_version: 'v6.17.0',
        title: 'eeroOS',
      },
      'device_tracker.andrii': {
        device_tracker: 'home',
        state: 'home',
        source_type: 'router',
      },
    },
  });

  it('projects network, update, select, and device_tracker entities into CompatView', () => {
    const view = buildView(devices, states);

    // 1. Select entity
    const selectEntity = view.states.find((s) => s.entity_id === 'select.crawford_network_router');
    expect(selectEntity).toBeDefined();
    expect(selectEntity?.state).toBe('night');
    expect(selectEntity?.attributes.options).toEqual(['morning', 'afternoon', 'night']);

    // 2. Switch entity
    const switchEntity = view.states.find((s) => s.entity_id === 'switch.crawford_network_router');
    expect(switchEntity).toBeDefined();
    expect(switchEntity?.state).toBe('off');

    // 3. Button entity
    const buttonEntity = view.states.find((s) => s.entity_id === 'button.crawford_network_router');
    expect(buttonEntity).toBeDefined();

    // 4. Update entity
    const updateEntity = view.states.find((s) => s.entity_id === 'update.tv_place_mesh_node');
    expect(updateEntity).toBeDefined();
    expect(updateEntity?.state).toBe('on');
    expect(updateEntity?.attributes.installed_version).toBe('v6.16.0');
    expect(updateEntity?.attributes.latest_version).toBe('v6.17.0');
    expect(updateEntity?.attributes.title).toBe('eeroOS');

    // 5. Device tracker entity
    const trackerEntity = view.states.find((s) => s.entity_id === 'device_tracker.andrii_profile');
    expect(trackerEntity).toBeDefined();
    expect(trackerEntity?.state).toBe('home');
    expect(trackerEntity?.attributes.source_type).toBe('router');
  });

  it('translates update install, select option, and button press service calls', () => {
    const view = buildView(devices, states);
    const isOn = (id: string) => view.states.find((s) => s.entity_id === id)?.state === 'on';

    // 1. Update install
    const updateCommands = translateService(
      view.bindings,
      {
        service: 'install',
        target: { entity_id: 'update.tv_place_mesh_node' },
      },
      isOn,
    );
    expect(updateCommands).toHaveLength(1);
    expect(updateCommands[0]).toEqual({
      deviceId: 'tv_place_mesh_node',
      endpointId: 'update.tv_place_eero_firmware',
      capability: 'update',
      command: 'install',
    });

    // 2. Select option
    const selectCommands = translateService(
      view.bindings,
      {
        service: 'select_option',
        service_data: { option: 'morning' },
        target: { entity_id: 'select.crawford_network_router' },
      },
      isOn,
    );
    expect(selectCommands).toHaveLength(1);
    expect(selectCommands[0]).toEqual({
      deviceId: 'crawford_network_router',
      endpointId: 'select.crawford_preferred_update_time',
      capability: 'select',
      command: 'set',
      parameters: { value: 'morning', option: 'morning' },
    });

    // 3. Button press
    const buttonCommands = translateService(
      view.bindings,
      {
        service: 'press',
        target: { entity_id: 'button.crawford_network_router' },
      },
      isOn,
    );
    expect(buttonCommands).toHaveLength(1);
    expect(buttonCommands[0]).toEqual({
      deviceId: 'crawford_network_router',
      endpointId: 'button.crawford_reboot',
      capability: 'press',
      command: 'press',
    });
  });
});
