import { describe, expect, it } from 'vitest';
import { normalizeHome } from './index';
import { deviceTelemetryRegistry } from './device-telemetry';
import type { Snapshot } from './types';
import { kettleIdentityFixture } from './kettle.fixture';

describe('physical kettle identity', () => {
  it('groups the bridge with its exact Xiaomi source, retaining legacy controls without duplicate tiles or writes', () => {
    const snapshot = kettleIdentityFixture();
    const before = structuredClone(snapshot);
    const home = normalizeHome(snapshot);
    expect(home.accessories).toHaveLength(1);
    expect(home.accessories[0]).toMatchObject({
      deviceId: 'original',
      primaryEntityId: 'water_heater.bridge',
      areaId: 'kitchen',
    });
    expect(home.accessories[0].entityIds).toContain('water_heater.original');
    expect(home.accessories[0].entityIds).toContain('climate.original');
    expect(deviceTelemetryRegistry(snapshot).get('climate.original')?.entity_category).toBe(
      'diagnostic',
    );
    expect(deviceTelemetryRegistry(snapshot).get('climate.bridge')?.entity_category).toBe(
      'diagnostic',
    );
    expect(snapshot).toEqual(before);
    snapshot.states.find((state) => state.entity_id === 'water_heater.original')!.state =
      'unavailable';
    expect(normalizeHome(snapshot).accessories[0].primaryEntityId).toBe('water_heater.bridge');
  });
  it('does not merge a similar name, different DID, conflicting explicit room or ambiguous device', () => {
    for (const change of [
      (s: Snapshot) => {
        s.devices[1].identifiers = [['mqtt', 'haus_kettle_456']];
      },
      (s: Snapshot) => {
        s.devices[1].area_id = 'living';
      },
      (s: Snapshot) => {
        s.entities.find((entry) => entry.entity_id === 'water_heater.bridge')!.area_id = 'living';
      },
      (s: Snapshot) => {
        s.devices.push({ ...s.devices[1], id: 'another' });
      },
    ]) {
      const snapshot = kettleIdentityFixture();
      change(snapshot);
      expect(deviceTelemetryRegistry(snapshot).get('water_heater.bridge')?.device_id).toBe(
        'bridge',
      );
    }
  });

  it('joins the exact Disabled Xiaomi entity to the active MQTT kettle after its Xiaomi app link is gone', () => {
    const snapshot = kettleIdentityFixture();
    snapshot.devices[0].name = 'Kettle';
    snapshot.devices[1].area_id = 'kitchen';
    snapshot.entities = snapshot.entities.map((entry) => {
      if (entry.entity_id === 'water_heater.original')
        return {
          ...entry,
          entity_id: 'water_heater.disabled_kitchen_kettle',
          name: 'Disabled: Kettle',
        };
      if (entry.entity_id === 'water_heater.bridge')
        return { ...entry, entity_id: 'water_heater.kitchen_kettle' };
      if (entry.entity_id === 'climate.bridge')
        return { ...entry, entity_id: 'climate.kitchen_kettle' };
      return entry;
    });
    snapshot.states = snapshot.states.map((state) => {
      if (state.entity_id === 'button.kettle_info') return { ...state, attributes: {} };
      if (state.entity_id === 'water_heater.original')
        return {
          ...state,
          entity_id: 'water_heater.disabled_kitchen_kettle',
          attributes: { friendly_name: 'Disabled: Kettle' },
        };
      if (state.entity_id === 'water_heater.bridge')
        return { ...state, entity_id: 'water_heater.kitchen_kettle' };
      if (state.entity_id === 'climate.bridge')
        return { ...state, entity_id: 'climate.kitchen_kettle' };
      return state;
    });

    const home = normalizeHome(snapshot);
    expect(home.accessories).toHaveLength(1);
    expect(home.accessories[0]).toMatchObject({
      primaryEntityId: 'water_heater.kitchen_kettle',
      areaId: 'kitchen',
      availability: 'available',
    });
    expect(home.accessories[0].secondaryEntities.map((entity) => entity.entity_id)).toContain(
      'water_heater.disabled_kitchen_kettle',
    );
    expect(home.accessories.map((accessory) => accessory.primaryEntityId)).toEqual([
      'water_heater.kitchen_kettle',
    ]);
    expect(
      deviceTelemetryRegistry(snapshot).get('water_heater.disabled_kitchen_kettle')
        ?.entity_category,
    ).toBe('diagnostic');
  });

  it('keeps an exact same-slug climate projection as diagnostic even when HA omitted its device registry entry', () => {
    const snapshot = kettleIdentityFixture();
    snapshot.entities = snapshot.entities.flatMap((entry) => {
      if (entry.entity_id === 'climate.bridge') return [];
      if (entry.entity_id === 'water_heater.original')
        return [
          {
            ...entry,
            entity_id: 'water_heater.disabled_kitchen_kettle',
            name: 'Disabled: Kettle',
          },
        ];
      if (entry.entity_id === 'water_heater.bridge')
        return [{ ...entry, entity_id: 'water_heater.kitchen_kettle' }];
      return [entry];
    });
    snapshot.states = snapshot.states.map((state) => {
      if (state.entity_id === 'button.kettle_info') return { ...state, attributes: {} };
      if (state.entity_id === 'water_heater.original')
        return {
          ...state,
          entity_id: 'water_heater.disabled_kitchen_kettle',
          attributes: { friendly_name: 'Disabled: Kettle' },
        };
      if (state.entity_id === 'water_heater.bridge')
        return { ...state, entity_id: 'water_heater.kitchen_kettle' };
      if (state.entity_id === 'climate.bridge')
        return { ...state, entity_id: 'climate.kitchen_kettle' };
      return state;
    });
    const registry = deviceTelemetryRegistry(snapshot);
    expect(registry.get('climate.kitchen_kettle')).toMatchObject({
      device_id: 'original',
      entity_category: 'diagnostic',
    });
    expect(normalizeHome(snapshot).accessories.map((item) => item.primaryEntityId)).toEqual([
      'water_heater.kitchen_kettle',
    ]);
  });

  it('does not use the disabled-ID fallback for a live or unmarked Xiaomi source', () => {
    for (const change of [
      (snapshot: Snapshot) => {
        snapshot.states.find(
          (state) => state.entity_id === 'water_heater.disabled_kitchen_kettle',
        )!.state = 'off';
      },
      (snapshot: Snapshot) => {
        snapshot.entities.find(
          (entry) => entry.entity_id === 'water_heater.disabled_kitchen_kettle',
        )!.name = 'Kettle';
        snapshot.states.find(
          (state) => state.entity_id === 'water_heater.disabled_kitchen_kettle',
        )!.attributes.friendly_name = 'Kettle';
      },
    ]) {
      const snapshot = kettleIdentityFixture();
      snapshot.entities = snapshot.entities.map((entry) => {
        if (entry.entity_id === 'water_heater.original')
          return {
            ...entry,
            entity_id: 'water_heater.disabled_kitchen_kettle',
            name: 'Disabled: Kettle',
          };
        if (entry.entity_id === 'water_heater.bridge')
          return { ...entry, entity_id: 'water_heater.kitchen_kettle' };
        return entry;
      });
      snapshot.states = snapshot.states.map((state) => {
        if (state.entity_id === 'button.kettle_info') return { ...state, attributes: {} };
        if (state.entity_id === 'water_heater.original')
          return {
            ...state,
            entity_id: 'water_heater.disabled_kitchen_kettle',
            attributes: { friendly_name: 'Disabled: Kettle' },
          };
        if (state.entity_id === 'water_heater.bridge')
          return { ...state, entity_id: 'water_heater.kitchen_kettle' };
        return state;
      });
      change(snapshot);
      expect(deviceTelemetryRegistry(snapshot).get('water_heater.kitchen_kettle')?.device_id).toBe(
        'bridge',
      );
    }
  });
});
