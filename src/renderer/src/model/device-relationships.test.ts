import { describe, expect, it } from 'vitest';
import { createDemoSnapshot, normalizeHome } from './index';
import { buildHomeView } from './home-view';
import { sanitizePreferences } from './preferences';
const state = (entity_id: string, name: string) => ({
  entity_id,
  state: 'off',
  attributes: { friendly_name: name },
  last_changed: '2026-10-18T12:00:00Z',
});
describe('physical device relationships', () => {
  it('joins a proxy camera, its internal transport and MQTT controls without hiding the camera with an old child preference', () => {
    const snapshot = createDemoSnapshot();
    snapshot.devices.push(
      { id: 'proxy', name_by_user: 'Garden Camera', area_id: 'outdoor' },
      { id: 'mqtt', name: 'Garden Camera', model: 'G5', area_id: 'outdoor' },
    );
    for (const [id, device] of [
      ['camera.garden', 'proxy'],
      ['camera.garden_internal', 'mqtt'],
      ['switch.garden_tracking', 'mqtt'],
      ['light.garden_spotlight', 'mqtt'],
    ]) {
      snapshot.states.push(state(id, 'Garden Camera'));
      snapshot.entities.push({
        entity_id: id,
        device_id: device,
        platform: device === 'mqtt' ? 'mqtt' : 'generic',
      });
    }
    const model = normalizeHome(snapshot);
    const camera = model.accessories.find((a) => a.primaryEntityId === 'camera.garden')!;
    expect(camera.entityIds).toEqual(
      expect.arrayContaining([
        'camera.garden_internal',
        'switch.garden_tracking',
        'light.garden_spotlight',
      ]),
    );
    expect(model.cameras.map((c) => c.entity_id)).not.toContain('camera.garden_internal');
    expect(model.accessories.some((a) => a.primaryEntityId === 'switch.garden_tracking')).toBe(
      false,
    );
    const view = buildHomeView({
      snapshot,
      model,
      preferences: sanitizePreferences({ hiddenApp: ['switch.garden_tracking'] }),
      route: { kind: 'home' },
      search: '',
      selectedLightGroup: null,
    });
    expect(view.homeCameras.map((c) => c.entity_id)).toContain('camera.garden');
  });
  it('keeps identically named cameras in different areas separate', () => {
    const snapshot = createDemoSnapshot();
    snapshot.devices.push(
      { id: 'a', name: 'Camera', area_id: 'one' },
      { id: 'b', name: 'Camera', area_id: 'two' },
    );
    for (const [id, device] of [
      ['camera.one', 'a'],
      ['camera.two', 'b'],
    ]) {
      snapshot.states.push(state(id, 'Camera'));
      snapshot.entities.push({ entity_id: id, device_id: device });
    }
    expect(
      normalizeHome(snapshot).accessories.filter((a) =>
        ['camera.one', 'camera.two'].includes(a.primaryEntityId),
      ),
    ).toHaveLength(2);
  });
  it('presents a physical surge protector as one accessory with independent socket controls', () => {
    const snapshot = createDemoSnapshot();
    snapshot.devices.push({ id: 'strip', name: 'Desk Surge Protector', model: 'SW023' });
    for (const id of ['switch.strip_one', 'switch.strip_two', 'switch.strip_usb']) {
      snapshot.states.push(state(id, id));
      snapshot.entities.push({ entity_id: id, device_id: 'strip' });
    }
    const strips = normalizeHome(snapshot).accessories.filter((a) => a.deviceId === 'strip');
    expect(strips).toHaveLength(1);
    expect(strips[0].powerStrip).toBe(true);
    expect(strips[0].entityIds).toHaveLength(3);
  });
});
