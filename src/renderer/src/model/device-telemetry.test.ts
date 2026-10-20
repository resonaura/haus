import { expect, it } from 'vitest';
import { createDemoSnapshot } from './demo';
import { normalizeHome } from './normalize';
import { buildHomeView } from './home-view';
import { defaults } from './preferences';
import type { HassEntity } from './types';
import { describeAccessory } from './presentation';
const entity = (entity_id: string, state: string, attributes = {}): HassEntity => ({
  entity_id,
  state,
  attributes,
  last_changed: '',
});
function scaleFixture() {
  const snapshot = createDemoSnapshot();
  snapshot.areas = [
    { area_id: 'living', name: 'Living Room' },
    { area_id: 'bath', name: 'Bathroom' },
  ];
  snapshot.devices = [{ id: 'scale', name: 'Living Room Scale', area_id: 'living' }];
  snapshot.states = [
    entity('sensor.living_room_scale_weight', 'unavailable', {
      device_class: 'weight',
      unit_of_measurement: 'kg',
    }),
    entity('sensor.living_room_scale_last_weight', '67.8', { unit_of_measurement: 'kg' }),
  ];
  snapshot.entities = [
    { entity_id: snapshot.states[0].entity_id, platform: 'eufylife_ble', device_id: 'scale' },
    { entity_id: snapshot.states[1].entity_id, platform: 'template' },
  ];
  return snapshot;
}
it('keeps session players accessible but out of the physical home and offline alerts, while preserving real Apple TV/Fire devices', () => {
  const snapshot = createDemoSnapshot();
  snapshot.states = [
    entity('media_player.appletv', 'idle'),
    entity('media_player.chrome', 'unavailable'),
    entity('media_player.bedroom_apple_tv', 'idle'),
    entity('media_player.fire_tv', 'idle'),
  ];
  snapshot.devices = [
    { id: 'apple', name: 'Bedroom Apple TV', area_id: 'bedroom' },
    { id: 'fire', name: 'Fire TV', area_id: 'living' },
  ];
  snapshot.entities = [
    { entity_id: snapshot.states[0].entity_id, platform: 'jellyfin' },
    { entity_id: snapshot.states[1].entity_id, platform: 'jellyfin' },
    { entity_id: snapshot.states[2].entity_id, platform: 'apple_tv', device_id: 'apple' },
    { entity_id: snapshot.states[3].entity_id, platform: 'androidtv', device_id: 'fire' },
  ];
  const model = normalizeHome(snapshot);
  expect(model.accessories).toHaveLength(4);
  expect(model.accessories.filter((a) => a.defaultHidden).map((a) => a.id)).toEqual([
    'media_player.appletv',
    'media_player.chrome',
  ]);
  expect(model.attention).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ entityId: 'media_player.chrome' })]),
  );
  const input = {
    model,
    snapshot,
    preferences: defaults,
    route: { kind: 'home' },
    search: '',
    selectedLightGroup: null,
  };
  expect(buildHomeView(input).homeAccessories.map((a) => a.id)).toEqual([
    'media_player.bedroom_apple_tv',
    'media_player.fire_tv',
  ]);
  expect(
    buildHomeView({
      ...input,
      preferences: { ...defaults, unhiddenApp: ['media_player.appletv'] },
    }).homeAccessories.map((a) => a.id),
  ).toContain('media_player.appletv');
});
it('attaches last weight to its exact physical source, inherits the room and keeps the cached measurement while BLE is asleep', () => {
  const snapshot = scaleFixture();
  const original = JSON.stringify(snapshot);
  const model = normalizeHome(snapshot);
  expect(model.accessories).toHaveLength(1);
  expect(model.accessories[0]).toMatchObject({
    deviceId: 'scale',
    areaId: 'living',
    name: 'Living Room Scale',
    primaryEntityId: 'sensor.living_room_scale_weight',
  });
  expect(model.accessories[0].entityIds).toContain('sensor.living_room_scale_weight');
  expect(model.accessories[0].state.state).toBe('unavailable');
  expect(describeAccessory(model.accessories[0])).toBe('Last 67.8kg');
  expect(model.attention).toHaveLength(0);
  expect(JSON.stringify(snapshot)).toBe(original);
  snapshot.states[0].state = '75';
  expect(normalizeHome(snapshot).accessories[0].primaryEntityId).toBe(
    'sensor.living_room_scale_weight',
  );
});
it.each(['room', 'unit', 'platform', 'name-only'])(
  'does not attach a measurement with a conflicting %s',
  (reason) => {
    const snapshot = scaleFixture();
    if (reason === 'room') snapshot.entities[1].area_id = 'bath';
    if (reason === 'unit') snapshot.states[1].attributes.unit_of_measurement = 'lb';
    if (reason === 'platform') snapshot.entities[1].platform = 'mqtt';
    if (reason === 'name-only')
      snapshot.states[1].entity_id = snapshot.entities[1].entity_id = 'sensor.other_last_weight';
    expect(normalizeHome(snapshot).accessories).toHaveLength(2);
  },
);
