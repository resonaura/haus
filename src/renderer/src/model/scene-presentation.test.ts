import { describe, expect, it } from 'vitest';
import {
  scenePresentation,
  sceneViews,
  sceneLightingIsDark,
  sortScenesByName,
} from './scene-presentation';
import type { HassEntity } from './types';

const scene = (id: string, name: string): HassEntity => ({
  entity_id: `scene.${id}`,
  state: 'unknown',
  attributes: { friendly_name: name },
  last_changed: '',
});

describe('Home scene order', () => {
  it('keeps rooms together, then sorts titles ignoring case, prefixes and Hue badges', () => {
    const scenes = [
      scene('bedroom_relax', 'Bedroom (hue) Relax'),
      scene('narnia_bright', 'Narnia Bright'),
      scene('bedroom_bright', 'Bedroom (hue) bright'),
    ];
    const ordered = sortScenesByName(scenes, (item) =>
      item.entity_id.includes('bedroom') ? 'Bedroom' : 'Narnia',
    );
    expect(ordered.map((item) => item.entity_id)).toEqual([
      'scene.bedroom_bright',
      'scene.bedroom_relax',
      'scene.narnia_bright',
    ]);
    expect(scenes[0].entity_id).toBe('scene.bedroom_relax');
  });
  it('keeps numbered scene names in natural order', () => {
    expect(
      sortScenesByName([scene('ten', 'Evening 10'), scene('two', 'Evening 2')]).map(
        (item) => item.entity_id,
      ),
    ).toEqual(['scene.two', 'scene.ten']);
  });
});

describe('scene presentation', () => {
  it('moves the Hue marker out of the name without changing the server entity', () => {
    const original = scene('relax', 'Bedroom (hue) Relax');
    expect(scenePresentation(original, 'Bedroom')).toEqual({
      name: 'Bedroom Relax',
      title: 'Relax',
      source: 'Hue',
    });
    expect(original.attributes.friendly_name).toBe('Bedroom (hue) Relax');
  });
  it('handles marker capitalization and keeps unrelated parenthetical titles', () => {
    expect(scenePresentation(scene('read', '( HUE ) Read (evening)'))).toEqual({
      name: 'Read (evening)',
      title: 'Read (evening)',
      source: 'Hue',
    });
    expect(scenePresentation(scene('hue', 'Hue sunset'))).toMatchObject({
      title: 'Hue sunset',
      source: undefined,
    });
  });
  it('can identify the integration from registry metadata', () => {
    const item = scene('relax', 'Living Room Relax');
    expect(
      scenePresentation(item, 'Living Room', { entity_id: item.entity_id, platform: 'hue' }),
    ).toMatchObject({ title: 'Relax', source: 'Hue' });
  });
});

describe('scene visibility', () => {
  const scenes = [scene('one', 'One'), scene('two', 'Two'), scene('three', 'Three')];
  it('hides a scene from Home while retaining it in the library and rooms', () => {
    const views = sceneViews(scenes, new Set(), new Set(['scene.one']));
    expect(views.home.map((s) => s.entity_id)).toEqual(['scene.two', 'scene.three']);
    expect(views.visible).toEqual(scenes);
    expect(views.hidden).toEqual([]);
  });
  it('hides a scene throughout Haus and makes it available for restoration', () => {
    const views = sceneViews(scenes, new Set(['scene.two']), new Set());
    expect(views.visible.map((s) => s.entity_id)).toEqual(['scene.one', 'scene.three']);
    expect(views.home).toEqual(views.visible);
    expect(views.hidden.map((s) => s.entity_id)).toEqual(['scene.two']);
  });
  it('preserves the independent Home setting when restoring a scene to Haus', () => {
    const homeHidden = new Set(['scene.one']);
    expect(sceneViews(scenes, new Set(['scene.one']), homeHidden).visible).not.toContain(scenes[0]);
    const restored = sceneViews(scenes, new Set(), homeHidden);
    expect(restored.visible).toContain(scenes[0]);
    expect(restored.home).not.toContain(scenes[0]);
  });
});

describe('dark scene artwork', () => {
  it('dims all-off and very low-light scenes, but keeps a lit target bright', () => {
    expect(sceneLightingIsDark({ 'light.one': 'off', 'light.two': { state: 'off' } })).toBe(true);
    expect(sceneLightingIsDark({ 'light.one': { state: 'on', brightness: 8 } })).toBe(true);
    expect(
      sceneLightingIsDark({ 'light.one': 'off', 'light.two': { state: 'on', brightness: 150 } }),
    ).toBe(false);
    expect(sceneLightingIsDark(undefined)).toBeUndefined();
  });
});
