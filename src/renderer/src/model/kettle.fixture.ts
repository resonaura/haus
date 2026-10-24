import { createDemoSnapshot } from './demo';
import type { Snapshot } from './types';

export function kettleIdentityFixture(): Snapshot {
  const snapshot = createDemoSnapshot();
  snapshot.devices = [
    { id: 'original', name: 'Kitchen Kettle', model: 'xiaomi.kettle.v21', area_id: 'kitchen' },
    {
      id: 'bridge',
      name: 'Kitchen Kettle',
      model: 'xiaomi.kettle.v21',
      identifiers: [['mqtt', 'haus_kettle_123']],
    },
  ];
  snapshot.areas = [
    { area_id: 'kitchen', name: 'Kitchen' },
    { area_id: 'living', name: 'Living Room' },
  ];
  snapshot.entities = [
    {
      entity_id: 'button.kettle_info',
      device_id: 'original',
      platform: 'xiaomi_miot',
      entity_category: 'diagnostic',
    },
    { entity_id: 'water_heater.original', device_id: 'original', platform: 'xiaomi_miot' },
    { entity_id: 'climate.original', device_id: 'original', platform: 'xiaomi_miot' },
    { entity_id: 'water_heater.bridge', device_id: 'bridge', platform: 'mqtt' },
    { entity_id: 'climate.bridge', device_id: 'bridge', platform: 'mqtt' },
    {
      entity_id: 'sensor.bridge_connection',
      device_id: 'bridge',
      platform: 'mqtt',
      entity_category: 'diagnostic',
    },
  ];
  snapshot.states = [
    {
      entity_id: 'button.kettle_info',
      state: 'unknown',
      attributes: { app_link: 'mihome://device?did=123' },
      last_changed: '',
    },
    { entity_id: 'water_heater.original', state: 'unavailable', attributes: {}, last_changed: '' },
    { entity_id: 'climate.original', state: 'off', attributes: {}, last_changed: '' },
    {
      entity_id: 'water_heater.bridge',
      state: 'off',
      attributes: { temperature: 80, current_temperature: 21 },
      last_changed: '',
    },
    {
      entity_id: 'climate.bridge',
      state: 'off',
      attributes: { temperature: 7, current_temperature: null },
      last_changed: '',
    },
    { entity_id: 'sensor.bridge_connection', state: 'Connected', attributes: {}, last_changed: '' },
  ];
  return snapshot;
}
