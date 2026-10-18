import { describe, expect, it } from 'vitest';
import { createDemoSnapshot, normalizeHome } from './index';
import { buildHomeView } from './home-view';
import { sanitizePreferences, type Preferences } from './preferences';
import type { Snapshot } from './types';

const view = (snapshot: Snapshot, patch: Partial<Preferences> = {}) =>
  buildHomeView({
    snapshot,
    model: normalizeHome(snapshot),
    preferences: { ...sanitizePreferences({}), ...patch },
    route: { kind: 'home' },
    search: '',
    selectedLightGroup: null,
  });

describe('home view boundaries', () => {
  it('hides a camera from Home independently of its room and app visibility', () => {
    const snapshot = createDemoSnapshot();
    const camera = snapshot.states.find((item) => item.entity_id.startsWith('camera.'))!;
    const baseline = view(snapshot);
    const owner = baseline.cameraOwner(camera)!;
    expect(owner).toBeDefined();
    const hidden = view(snapshot, { hiddenHome: [owner.primaryEntityId] });
    expect(hidden.appCameras.map((item) => item.entity_id)).toContain(camera.entity_id);
    expect(hidden.homeCameras.map((item) => item.entity_id)).not.toContain(camera.entity_id);
    expect(hidden.camerasForRoom(owner.areaId!).map((item) => item.entity_id)).toContain(
      camera.entity_id,
    );
    expect(hidden.homeCamerasForRoom(owner.areaId!).map((item) => item.entity_id)).not.toContain(
      camera.entity_id,
    );
  });

  it('removes a hidden scene from every Home placement but retains it in the scene library', () => {
    const snapshot = createDemoSnapshot();
    const scene = snapshot.states.find((item) => item.entity_id.startsWith('scene.'))!;
    const hidden = view(snapshot, { hiddenHome: [scene.entity_id] });
    expect(hidden.appScenes.map((item) => item.entity_id)).toContain(scene.entity_id);
    expect(hidden.sortedHomeScenes.map((item) => item.entity_id)).not.toContain(scene.entity_id);
    for (const room of hidden.orderedRooms)
      expect(hidden.scenesForRoom(room.id, true).map((item) => item.entity_id)).not.toContain(
        scene.entity_id,
      );
    const appHidden = view(snapshot, { hiddenApp: [scene.entity_id] });
    expect(appHidden.appScenes.map((item) => item.entity_id)).not.toContain(scene.entity_id);
    expect(appHidden.hiddenSceneMatches.map((item) => item.entity_id)).toContain(scene.entity_id);
  });

  it('does not reorder devices or mutate HA data when live states change', () => {
    const snapshot = createDemoSnapshot();
    const original = structuredClone(snapshot);
    const first = view(snapshot);
    expect(snapshot).toEqual(original);
    const light = snapshot.states.find((item) => item.entity_id.startsWith('light.'))!;
    light.state = light.state === 'on' ? 'off' : 'on';
    const next = view(snapshot);
    expect(next.navigationRooms.map((room) => room.id)).toEqual(
      first.navigationRooms.map((room) => room.id),
    );
    expect(next.homeAccessories.map((item) => item.id)).toEqual(
      first.homeAccessories.map((item) => item.id),
    );
  });

  it('keeps the last known room icon, device order and grouping choices through preference migration', () => {
    const preferences = sanitizePreferences({
      theme: 'dark',
      hidden: ['light.old'],
      hiddenHome: ['scene.relax'],
      roomIcons: { bedroom: 'bedroom', broken: 7 },
      deviceOrder: { bedroom: ['a', null, 'b'] },
      autoGroupLights: false,
      disabledLightGroups: ['group'],
      manualUsage: { a: { count: 2, lastUsed: 100 }, bad: { count: -1, lastUsed: 0 } },
    });
    expect(preferences).toMatchObject({
      theme: 'dark',
      hiddenApp: ['light.old'],
      hiddenHome: ['scene.relax'],
      roomIcons: { bedroom: 'bedroom' },
      deviceOrder: { bedroom: ['a', 'b'] },
      autoGroupLights: false,
      disabledLightGroups: ['group'],
      manualUsage: { a: { count: 2, lastUsed: 100 } },
    });
    expect(preferences.roomIcons).not.toHaveProperty('broken');
    expect(preferences.manualUsage).not.toHaveProperty('bad');
  });
});
