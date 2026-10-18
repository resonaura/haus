import { describe, expect, it } from 'vitest';
import { createDemoSnapshot, normalizeHome } from './index';
import { sceneViews } from './scene-presentation';
import { accessoryVisibilityIds, visibilityTarget } from './visibility';

describe('scene visibility on a shared HA device', () => {
  const snapshot = createDemoSnapshot();
  snapshot.devices.push({ id: 'hue-bridge', name: 'Hue Bridge' });
  snapshot.states.push(
    { entity_id: 'light.hue_room', state: 'on', attributes: {}, last_changed: '' },
    {
      entity_id: 'scene.hue_relax',
      state: 'unknown',
      attributes: { friendly_name: 'Relax' },
      last_changed: '',
    },
    {
      entity_id: 'scene.hue_read',
      state: 'unknown',
      attributes: { friendly_name: 'Read' },
      last_changed: '',
    },
  );
  snapshot.entities.push(
    { entity_id: 'light.hue_room', device_id: 'hue-bridge', platform: 'hue' },
    { entity_id: 'scene.hue_relax', device_id: 'hue-bridge', platform: 'hue' },
    { entity_id: 'scene.hue_read', device_id: 'hue-bridge', platform: 'hue' },
  );
  const model = normalizeHome(snapshot);

  it('hides only the selected scene from Home, retaining its sibling and the device', () => {
    const target = visibilityTarget('scene.hue_relax', model.accessories);
    expect(
      model.accessories.find((item) => item.entityIds.includes('scene.hue_relax'))?.primaryEntityId,
    ).toBe('light.hue_room');
    expect(target).toEqual({
      accessory: undefined,
      id: 'scene.hue_relax',
      entityIds: ['scene.hue_relax'],
    });
    const views = sceneViews(model.scenes, new Set(), new Set([target.id]));
    expect(views.home.some((scene) => scene.entity_id === 'scene.hue_relax')).toBe(false);
    expect(views.home.some((scene) => scene.entity_id === 'scene.hue_read')).toBe(true);
    expect(views.visible.some((scene) => scene.entity_id === target.id)).toBe(true);
    const bridge = model.accessories.find((item) => item.deviceId === 'hue-bridge')!;
    expect(accessoryVisibilityIds(bridge)).not.toContain(target.id);
  });

  it('hides a scene across Haus and restores it without changing its independent Home setting', () => {
    const target = visibilityTarget('scene.hue_relax', model.accessories);
    const homeHidden = new Set([target.id]);
    const views = sceneViews(model.scenes, new Set([target.id]), homeHidden);
    expect(views.visible.some((scene) => scene.entity_id === target.id)).toBe(false);
    expect(views.hidden.map((scene) => scene.entity_id)).toEqual([target.id]);
    const restored = sceneViews(model.scenes, new Set(), homeHidden);
    expect(restored.visible.some((scene) => scene.entity_id === target.id)).toBe(true);
    expect(restored.home.some((scene) => scene.entity_id === target.id)).toBe(false);
  });

  it('still resolves a device sub-entity to its whole accessory', () => {
    const bridge = model.accessories.find((item) => item.deviceId === 'hue-bridge')!;
    expect(visibilityTarget('light.hue_room', model.accessories).accessory).toBe(bridge);
    expect(visibilityTarget(bridge, model.accessories).id).toBe(bridge.primaryEntityId);
    expect(visibilityTarget(bridge, model.accessories).entityIds).toEqual(['light.hue_room']);
  });
});
