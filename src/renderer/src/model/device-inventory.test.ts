import { expect, it } from 'vitest';
import { createDemoSnapshot, normalizeHome, type HassEntity } from './index';
const entity = (entity_id: string, state: string, attributes = {}): HassEntity => ({
  entity_id,
  state,
  attributes,
  last_changed: '',
});
it('keeps stateless Hue remotes with their keys and battery, and chooses physical hub telemetry over service switches', () => {
  const snapshot = createDemoSnapshot();
  snapshot.devices = [
    { id: 'remote', name: 'Bedroom Wall Switch', model: 'Hue dimmer switch', area_id: 'bedroom' },
    { id: 'hub', name: 'Bedroom Hub', model: 'Hue Bridge', area_id: 'bedroom' },
  ];
  snapshot.states = [
    entity('event.wall_button_1', 'unknown', { event_types: ['initial_press'] }),
    entity('event.wall_button_2', 'unknown'),
    entity('sensor.wall_battery', '87', { device_class: 'battery' }),
    entity('switch.hub_automation', 'on'),
    entity('sensor.hub_connectivity', 'connected'),
  ];
  snapshot.entities = snapshot.states.map((item) => ({
    entity_id: item.entity_id,
    device_id: item.entity_id.includes('hub') ? 'hub' : 'remote',
    entity_category:
      item.entity_id.includes('connectivity') || item.entity_id.includes('battery')
        ? 'diagnostic'
        : null,
  }));
  const accessories = normalizeHome(snapshot).accessories;
  const remote = accessories.find((item) => item.deviceId === 'remote')!;
  expect(remote.buttonController).toBe(true);
  expect(remote.primaryEntityId).toMatch(/^event\./);
  expect(remote.entityIds).toContain('event.wall_button_2');
  expect(remote.batteryLevel).toBe(87);
  const hub = accessories.find((item) => item.deviceId === 'hub')!;
  expect(hub.physicalHub).toBe(true);
  expect(hub.primaryEntityId).toBe('sensor.hub_connectivity');
});
it('joins exact clock integration twins and leaves settings inside the light', () => {
  const snapshot = createDemoSnapshot();
  snapshot.devices = [
    { id: 'clock', name: 'Bedroom Nixie Clock', model: 'RGB Tube Clock', area_id: 'bedroom' },
    { id: 'light', name: 'Bedroom Nixie Clock', model: 'Light', area_id: 'bedroom' },
  ];
  snapshot.states = [entity('light.nixie', 'on'), entity('switch.nixie_24_hour', 'on')];
  snapshot.entities = [
    { entity_id: 'light.nixie', device_id: 'light' },
    { entity_id: 'switch.nixie_24_hour', device_id: 'clock' },
  ];
  const model = normalizeHome(snapshot);
  expect(model.accessories).toHaveLength(1);
  expect(model.accessories[0].entityIds).toContain('switch.nixie_24_hour');
});
it('prioritizes security detections over auxiliary temperature and hides service rooms', () => {
  const snapshot = createDemoSnapshot();
  snapshot.areas.push({ area_id: 'system', name: 'System' });
  snapshot.devices = [{ id: 'motion', name: 'Hallway Motion', area_id: 'hallway' }];
  snapshot.states = [
    entity('sensor.motion_temperature', '21', { device_class: 'temperature' }),
    entity('binary_sensor.motion', 'off', { device_class: 'motion' }),
  ];
  snapshot.entities = snapshot.states.map((item) => ({
    entity_id: item.entity_id,
    device_id: 'motion',
  }));
  const model = normalizeHome(snapshot);
  expect(model.accessories[0].primaryEntityId).toBe('binary_sensor.motion');
  expect(model.rooms.some((room) => room.id === 'system')).toBe(false);
});
