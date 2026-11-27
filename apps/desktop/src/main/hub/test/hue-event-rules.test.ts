/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import { automationToHaConfig, toHubTriggerList } from '../management/hub-rule-configs.js';
import type { CompatView } from '../types.js';

function createSwitchCompatView(): CompatView {
  const bindings = new Map([
    [
      'event.hue_dimmer_button_1',
      {
        deviceId: 'hue_dimmer_dev_1',
        endpointId: 'ep_hue_btn_1',
        capability: { id: 'button_event', kind: 'event', operations: ['observe'] },
        domain: 'event',
      },
    ],
    [
      'light.living_pendant',
      {
        deviceId: 'light_dev_1',
        endpointId: 'ep_light_1',
        capability: { id: 'power', kind: 'binary', operations: ['read', 'write'] },
        domain: 'light',
      },
    ],
  ]);

  return {
    states: [
      {
        entity_id: 'event.hue_dimmer_button_1',
        state: '2026-11-26T16:00:00Z',
        attributes: {
          friendly_name: 'Hue Dimmer Button 1',
          event_types: ['initial_press', 'repeat', 'short_release', 'long_release'],
        },
        last_changed: '2026-11-26T16:00:00Z',
        last_updated: '2026-11-26T16:00:00Z',
      },
    ],
    devices: [
      {
        id: 'hue_dimmer_dev_1',
        name: 'Hue Dimmer Switch',
        manufacturer: 'Signify Netherlands B.V.',
        model: 'Hue dimmer switch',
        identifiers: [['ha', 'ha_hue_source_id']],
      },
    ],
    entities: [
      {
        entity_id: 'event.hue_dimmer_button_1',
        device_id: 'hue_dimmer_dev_1',
        original_name: 'Button 1',
      },
    ],
    areas: [],
    bindings,
  };
}

describe('Hub rules compat: Hue switch & generic event triggers', () => {
  it('maps event.received, HA Hue device triggers, HA event.* state triggers, and bus events to Hub triggers', () => {
    const view = createSwitchCompatView();

    // 1. Multi-gesture event.received on Hue button endpoint
    const fromEventReceived = toHubTriggerList(
      {
        trigger: 'event.received',
        target: { entity_id: 'event.hue_dimmer_button_1' },
        options: { event_type: ['short_release', 'long_release'] },
      },
      view,
    );
    expect(fromEventReceived).toEqual([
      { type: 'event', eventType: 'short_release', endpointId: 'ep_hue_btn_1' },
      { type: 'event', eventType: 'long_release', endpointId: 'ep_hue_btn_1' },
    ]);

    // 2. HA Hue device trigger resolved through preserved device identity
    const fromHueDevice = toHubTriggerList(
      {
        trigger: 'device',
        domain: 'hue',
        device_id: 'ha_hue_source_id',
        type: 'short_release',
        subtype: '1',
      },
      view,
    );
    expect(fromHueDevice).toEqual([
      { type: 'event', eventType: 'short_release', endpointId: 'ep_hue_btn_1' },
    ]);

    // 3. HA event.* state trigger on event_type attribute
    const fromEventState = toHubTriggerList(
      {
        trigger: 'state',
        entity_id: 'event.hue_dimmer_button_1',
        attribute: 'event_type',
        to: 'initial_press',
      },
      view,
    );
    expect(fromEventState).toEqual([
      { type: 'event', eventType: 'initial_press', endpointId: 'ep_hue_btn_1' },
    ]);

    // 4. Generic bus event (hue_event) with payload data
    const fromBusEvent = toHubTriggerList(
      {
        trigger: 'event',
        event_type: 'hue_event',
        event_data: { id: 'living_switch', subtype: 1, type: 'short_release' },
      },
      view,
    );
    expect(fromBusEvent).toEqual([
      {
        type: 'event',
        eventType: 'hue_event',
        data: { id: 'living_switch', subtype: 1, type: 'short_release' },
      },
    ]);

    // 5. Round-trip Hub-native event rules back to editable HA-compat config
    const projected = automationToHaConfig(
      {
        id: 'hue_rule_1',
        name: 'Hue Button Toggle',
        enabled: true,
        mode: 'restart',
        triggers: [
          { type: 'event', eventType: 'short_release', endpointId: 'ep_hue_btn_1' },
          { type: 'event', eventType: 'hue_event', data: { subtype: 2 } },
        ],
        actions: [],
      },
      view,
    );
    expect(projected.triggers).toEqual([
      {
        trigger: 'event.received',
        target: { entity_id: 'event.hue_dimmer_button_1' },
        options: { event_type: ['short_release'] },
      },
      {
        trigger: 'event',
        event_type: 'hue_event',
        event_data: { subtype: 2 },
      },
    ]);
  });
});
