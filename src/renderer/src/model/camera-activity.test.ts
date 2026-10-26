import { expect, it } from 'vitest';
import { createDemoSnapshot, normalizeHome, type HassEntity } from './index';
const entity = (entity_id: string, state: string, attributes = {}): HassEntity => ({
  entity_id,
  state,
  attributes,
  last_changed: '',
});
it('shows one canonical external activity sensor and includes it inside its exact camera', () => {
  const snapshot = createDemoSnapshot();
  snapshot.devices = [
    { id: 'camera', name: 'Outdoor Camera', area_id: 'outdoor' },
    {
      id: 'motion',
      name: 'Outdoor Camera Activity',
      manufacturer: 'Haus',
      model: 'Unified camera activity',
    },
  ];
  snapshot.states = [
    entity('camera.front', 'streaming'),
    entity('binary_sensor.front_motion', 'on', { device_class: 'motion' }),
    entity('binary_sensor.front_activity', 'off', {
      device_class: 'motion',
      haus_activity_version: 1,
      haus_camera: 'camera.front',
      native_sources: ['binary_sensor.front_motion'],
    }),
  ];
  snapshot.entities = snapshot.states.map((s) => ({
    entity_id: s.entity_id,
    device_id: s.entity_id.endsWith('activity') ? 'motion' : 'camera',
    platform: 'mqtt',
    unique_id: s.entity_id.endsWith('activity')
      ? 'haus_activity_0123456789abcdef0123'
      : s.entity_id,
  }));
  const model = normalizeHome(snapshot);
  expect(model.accessories).toHaveLength(2);
  const sensor = model.accessories.find(
    (item) => item.primaryEntityId === 'binary_sensor.front_activity',
  )!;
  expect(sensor.areaId).toBe('outdoor');
  expect(sensor.state.state).toBe('off');
  expect(
    model.accessories.find((item) => item.primaryEntityId === 'camera.front')!.entityIds,
  ).toContain(sensor.primaryEntityId);
  expect(model.accessories.flatMap((item) => item.entityIds)).not.toContain(
    'binary_sensor.front_motion',
  );
  expect(
    snapshot.states.find((item) => item.entity_id === 'binary_sensor.front_motion')!.state,
  ).toBe('on');
  snapshot.entities.at(-1)!.platform = 'template';
  expect(normalizeHome(snapshot).accessories.flatMap((item) => item.entityIds)).toContain(
    'binary_sensor.front_motion',
  );
});
