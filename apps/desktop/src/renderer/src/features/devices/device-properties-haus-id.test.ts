/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createDemoSnapshot, normalizeHome, resolveDeviceHausId, type Snapshot } from '../../model';
import { buildInventory } from '../../model/inventory';
import { RegistryController } from '../../ha/registry';
import { AccessoryDetails } from './AccessoryDetails';
import { SecondaryEntity } from './SecondaryEntity';
import { CameraDeviceSettings } from '../cameras/CameraDeviceSettings';
import { CameraParameter } from '../cameras/CameraParameter';
import { InventoryRow } from '../connections/InventoryRow';
import { DeviceInventory } from '../connections/DeviceInventory';
import { IntegrationEntryCard } from '../connections/details/IntegrationEntryCard';
import { IntegrationDetails } from '../connections/IntegrationDetails';
import { HausIdProperties } from '../../components/ui/haus-id';

function buildFixtureSnapshot(): Snapshot {
  return {
    areas: [{ area_id: 'living', name: 'Гостиная' }],
    devices: [
      {
        id: 'dev_lamp',
        name: 'Floor Lamp',
        area_id: 'living',
        manufacturer: 'Hue',
        model: 'LCT015',
        config_entries: ['entry_hue'],
      },
      {
        id: 'dev_cam',
        name: 'Porch Camera',
        area_id: 'living',
        manufacturer: 'UniFi',
        model: 'G5',
        config_entries: ['entry_hue'],
      },
      {
        id: 'dev_empty',
        name: 'Zigbee Bridge',
        area_id: 'living',
        manufacturer: 'Sonoff',
        model: 'ZB-P',
        config_entries: ['entry_hue'],
      },
    ],
    entities: [
      { entity_id: 'light.floor_lamp', device_id: 'dev_lamp' },
      { entity_id: 'sensor.floor_lamp_power', device_id: 'dev_lamp' },
      { entity_id: 'camera.porch_camera', device_id: 'dev_cam' },
    ],
    states: [
      {
        entity_id: 'light.floor_lamp',
        state: 'on',
        attributes: { friendly_name: 'Floor Lamp' },
        last_changed: '2026-11-14T10:00:00Z',
        last_updated: '2026-11-14T10:00:00Z',
      },
      {
        entity_id: 'sensor.floor_lamp_power',
        state: '9.5',
        attributes: { friendly_name: 'Floor Lamp Power', unit_of_measurement: 'W' },
        last_changed: '2026-11-14T10:00:00Z',
      },
      {
        entity_id: 'camera.porch_camera',
        state: 'idle',
        attributes: { friendly_name: 'Porch Camera' },
        last_changed: '2026-11-14T10:00:00Z',
      },
    ],
    services: {},
    config: { location_name: 'Haus' },
    user: { name: 'Tester', is_admin: true },
  };
}

describe('Device properties UI displays Haus-style IDs across all device sources', () => {
  it('renders canonical Haus device, entity, and secondary entity IDs with copy controls in AccessoryDetails', () => {
    const snapshot = buildFixtureSnapshot();
    const model = normalizeHome(snapshot);
    const lamp = model.accessories.find((a) => a.deviceId === 'dev_lamp')!;

    const html = renderToStaticMarkup(
      createElement(AccessoryDetails, {
        accessory: lamp,
        entity: lamp.state,
        snapshot,
        stateLabel: 'On',
        pending: false,
        onSecondaryAction: vi.fn(),
      }),
    );

    expect(html).toContain('light::gostinaya:floor-lamp');
    expect(html).toContain('sensor::gostinaya:floor-lamp:power');
    expect(html).toContain('dev_lamp');
    expect(html).toContain('Copy Haus device ID');

    const secondaryHtml = renderToStaticMarkup(
      createElement(SecondaryEntity, {
        entity: snapshot.states[1],
        hausId: 'sensor::gostinaya:floor-lamp:power',
        disabled: false,
        onAction: vi.fn(),
      }),
    );
    expect(secondaryHtml).toContain('sensor::gostinaya:floor-lamp:power');

    const switchHtml = renderToStaticMarkup(
      createElement(SecondaryEntity, {
        entity: {
          entity_id: 'switch.ai_sound_detection',
          state: 'on',
          attributes: { friendly_name: 'AI Sound Detection' },
          last_changed: '2026-11-14T10:00:00Z',
        },
        disabled: false,
        onAction: vi.fn(),
      }),
    );
    expect(switchHtml).toMatch(
      /<button\b(?=[^>]* role="switch")(?=[^>]* aria-label="AI Sound Detection")(?=[^>]* aria-checked="true")[^>]*>/,
    );

    const numberHtml = renderToStaticMarkup(
      createElement(CameraParameter, {
        entity: {
          entity_id: 'number.cam_alarm_volume',
          state: '50',
          attributes: {
            friendly_name: 'Alarm Volume',
            min: 0,
            max: 100,
            step: 1,
            unit_of_measurement: '%',
          },
          last_changed: '2026-11-14T10:00:00Z',
        },
        onAction: vi.fn(),
      }),
    );
    expect(numberHtml).toContain('50%');
    expect(numberHtml).toContain('value="50"');

    const unknownNumberHtml = renderToStaticMarkup(
      createElement(CameraParameter, {
        entity: {
          entity_id: 'number.cam_alarm_volume',
          state: 'unknown',
          attributes: { friendly_name: 'Alarm Volume', min: 0, max: 100, step: 1 },
          last_changed: '2026-11-14T10:00:00Z',
        },
        onAction: vi.fn(),
      }),
    );
    expect(unknownNumberHtml).toContain('—');
  });

  it('renders canonical Haus IDs in CameraDeviceSettings for matched and virtual standalone cameras', () => {
    const snapshot = buildFixtureSnapshot();
    const model = normalizeHome(snapshot);
    const camAccessory = model.accessories.find(
      (a) => a.primaryEntityId === 'camera.porch_camera',
    )!;

    const matchedHtml = renderToStaticMarkup(
      createElement(CameraDeviceSettings, {
        entity: camAccessory.state,
        related: [camAccessory],
        hiddenFromHome: false,
        hiddenFromApp: false,
        onToggleHomeVisibility: vi.fn(),
        onToggleAppVisibility: vi.fn(),
        onAction: vi.fn(),
        onOpenRelated: vi.fn(),
        onError: vi.fn(),
      }),
    );
    expect(matchedHtml).toContain('camera::gostinaya:porch-camera');
    expect(matchedHtml.indexOf('camera-identifiers')).toBeGreaterThan(
      matchedHtml.indexOf('camera-visibility'),
    );
    expect(matchedHtml.indexOf('camera-identifiers')).toBeGreaterThan(
      matchedHtml.indexOf('camera-homekit-settings'),
    );

    const virtualHtml = renderToStaticMarkup(
      createElement(CameraDeviceSettings, {
        entity: {
          entity_id: 'camera.desk_virtual',
          state: 'streaming',
          attributes: { friendly_name: 'Desk Virtual Camera' },
          last_changed: '2026-11-14T10:00:00Z',
        },
        related: [],
        hiddenFromHome: false,
        hiddenFromApp: false,
        onToggleHomeVisibility: vi.fn(),
        onToggleAppVisibility: vi.fn(),
        onAction: vi.fn(),
        onOpenRelated: vi.fn(),
        onError: vi.fn(),
      }),
    );
    expect(virtualHtml).toContain('camera::home:desk-virtual-camera');
  });

  it('shows Haus IDs across DeviceInventory, IntegrationEntryCard, and dialog HausIdProperties for demo and entityless devices', () => {
    const snapshot = buildFixtureSnapshot();
    const model = normalizeHome(snapshot);
    const inventory = buildInventory(snapshot, model.accessories);
    const bridge = inventory.find((d) => d.id === 'dev_empty')!;
    expect(bridge.hausId).toBe('generic::gostinaya:zigbee-bridge');

    const rowHtml = renderToStaticMarkup(
      createElement(InventoryRow, {
        device: bridge,
        room: 'Гостиная',
        selecting: false,
        selected: false,
        onSelect: vi.fn(),
        onOpen: vi.fn(),
        onManage: vi.fn(),
      }),
    );
    expect(rowHtml).toContain('generic::gostinaya:zigbee-bridge');

    const propsHtml = renderToStaticMarkup(
      createElement(HausIdProperties, {
        deviceHausId: bridge.hausId,
        backendDeviceId: bridge.id,
      }),
    );
    expect(propsHtml).toContain('generic::gostinaya:zigbee-bridge');
    expect(propsHtml).toContain('dev_empty');

    const registry = new RegistryController({
      snapshot: () => snapshot,
      context: () => ({ mode: 'live', generation: 1, status: 'connected' }),
      commit: vi.fn(),
      request: async () => {
        throw new Error('not called');
      },
    });
    const inventoryHtml = renderToStaticMarkup(
      createElement(DeviceInventory, {
        snapshot,
        accessories: model.accessories,
        onOpen: vi.fn(),
        onAdd: vi.fn(),
        registry,
        notify: vi.fn(),
      }),
    );
    expect(inventoryHtml).toContain('generic::gostinaya:zigbee-bridge');
    expect(inventoryHtml).toContain('light::gostinaya:floor-lamp');

    const entry = {
      entry_id: 'entry_hue',
      domain: 'hue',
      title: 'Hue Bridge',
      source: 'user',
      state: 'loaded' as const,
      supports_options: false,
      supports_unload: true,
      supports_reconfigure: false,
      disabled_by: null,
    };

    const cardHtml = renderToStaticMarkup(
      createElement(IntegrationEntryCard, {
        entry,
        snapshot,
        progress: [],
        busy: false,
        searchQuery: 'zigbee-bridge',
        onFlow: vi.fn(),
        onChange: vi.fn(),
        onConfirm: vi.fn(),
        onEditDevice: vi.fn(),
      }),
    );
    expect(cardHtml).toContain('generic::gostinaya:zigbee-bridge');
    expect(cardHtml).not.toContain('Floor Lamp');

    vi.stubGlobal('document', { documentElement: { dataset: { theme: 'dark' } } });
    try {
      const detailsHtml = renderToStaticMarkup(
        createElement(IntegrationDetails, {
          domain: 'hue',
          name: 'Hue',
          entries: [entry],
          progress: [],
          issues: [],
          busy: false,
          feedback: { error: '', notice: '' },
          snapshot,
          onFlow: vi.fn(),
          onChange: vi.fn(),
          onConfirm: vi.fn(),
          onRefreshSnapshot: vi.fn(),
          onClose: vi.fn(),
        }),
      );
      expect(detailsHtml).toContain('light::gostinaya:floor-lamp');
    } finally {
      vi.unstubAllGlobals();
    }

    const demo = createDemoSnapshot();
    const demoModel = normalizeHome(demo);
    expect(demoModel.accessories.length).toBeGreaterThan(0);
    for (const acc of demoModel.accessories) {
      expect(acc.hausId).toMatch(/^[a-z0-9-]+::[a-z0-9-]+:[a-z0-9-]+$/);
    }
    for (const dev of demo.devices) {
      expect(resolveDeviceHausId(dev, demo)).toMatch(/^[a-z0-9-]+::[a-z0-9-]+:[a-z0-9-]+$/);
    }
  });
});
