import { describe, expect, it, vi } from 'vitest';
import type { HausNative } from '../../../shared/native';
import { createDemoSnapshot } from '../model';
import { hueSceneArtwork, loadHueSceneArtwork } from './hue-scenes';

function fixture() {
  const snapshot = createDemoSnapshot();
  snapshot.devices = ['Bedroom', 'Narnia'].map((name) => ({
    id: name,
    name,
    identifiers: [['hue', `${name}-group`]],
  }));
  snapshot.states = ['Bedroom', 'Narnia'].map((name) => ({
    entity_id: `scene.${name.toLowerCase()}_relax`,
    state: 'unknown',
    attributes: { friendly_name: `${name} Relax`, name: 'Relax', group_name: name },
    last_changed: '',
  }));
  snapshot.entities = snapshot.states.map((state, index) => ({
    entity_id: state.entity_id,
    device_id: snapshot.devices[index].id,
    unique_id: `${index}-scene`,
    config_entry_id: 'bridge',
    platform: 'hue',
  }));
  const resources = ['Bedroom', 'Narnia'].map((name, index) => ({
    id: 'redacted-uuid',
    type: 'scene',
    metadata: { name: 'Relax' },
    group: { rid: `${name}-group`, rtype: 'room' },
    actions: [{ action: { on: { on: true }, dimming: { brightness: 60 } } }],
    palette: {
      color: [{ color: { xy: index ? { x: 0.17, y: 0.08 } : { x: 0.6, y: 0.3 } } }],
    },
  }));
  return { snapshot, resources, diagnostics: { data: { full_state: resources } } };
}

describe('Hue scene artwork', () => {
  it('matches redacted scene IDs by their room and name, keeping same-name palettes separate', () => {
    const { snapshot, diagnostics } = fixture();
    const artwork = hueSceneArtwork(snapshot, 'bridge', diagnostics);
    expect(Object.keys(artwork)).toEqual(['scene.bedroom_relax', 'scene.narnia_relax']);
    expect(artwork['scene.bedroom_relax'].colors[0]).toMatch(/^rgb\(/);
    expect(artwork['scene.bedroom_relax'].colors).not.toEqual(artwork['scene.narnia_relax'].colors);
    expect(artwork['scene.bedroom_relax'].dark).toBe(false);
    expect(hueSceneArtwork(snapshot, 'other-bridge', diagnostics)).toEqual({});
  });

  it('can resolve a group by its name and rejects ambiguous matches', () => {
    const { snapshot, resources } = fixture();
    snapshot.devices = [];
    const full_state = [
      ...resources,
      { id: 'Bedroom-group', type: 'room', metadata: { name: 'Bedroom' } },
      { id: 'Narnia-group', type: 'zone', metadata: { name: 'Narnia' } },
    ];
    expect(Object.keys(hueSceneArtwork(snapshot, 'bridge', { data: { full_state } }))).toHaveLength(
      2,
    );
    full_state.push(resources[0]);
    expect(hueSceneArtwork(snapshot, 'bridge', { data: { full_state } })).not.toHaveProperty(
      'scene.bedroom_relax',
    );
  });

  it('reads white temperature palettes and dark actions without borrowing current lamp colors', () => {
    const { snapshot, resources } = fixture();
    const first = {
      ...resources[0],
      palette: { color_temperature: [{ color_temperature: { mirek: 400 } }] },
      actions: [{ action: { on: { on: false } } }],
    };
    const second = {
      ...resources[1],
      palette: {},
      actions: [{ action: { on: { on: true }, dimming: { brightness: 3 } } }],
    };
    const artwork = hueSceneArtwork(snapshot, 'bridge', { data: { full_state: [first, second] } });
    expect(artwork['scene.bedroom_relax']).toEqual({ colors: ['rgb(255, 159, 70)'], dark: true });
    expect(artwork['scene.narnia_relax']).toEqual({ colors: [], dark: true });
  });

  it('uses configured actions when the bridge has no palette', () => {
    const { snapshot, resources } = fixture();
    const resource = {
      ...resources[0],
      palette: {},
      actions: [
        { action: { on: { on: false }, color: { xy: { x: 0.17, y: 0.08 } } } },
        { action: { on: { on: true }, color_temperature: { mirek: 400 } } },
      ],
    };
    expect(hueSceneArtwork(snapshot, 'bridge', { data: { full_state: [resource] } })).toEqual({
      'scene.bedroom_relax': { colors: ['rgb(255, 159, 70)'], dark: false },
    });
  });

  it('loads only enabled Hue bridges through read-only authenticated requests', async () => {
    const { snapshot, diagnostics } = fixture();
    snapshot.user.is_admin = true;
    const request = vi.fn().mockResolvedValue([
      { entry_id: 'bridge', domain: 'hue' },
      { entry_id: 'disabled', domain: 'hue', disabled_by: 'user' },
      { entry_id: 'unrelated', domain: 'ipp' },
    ]);
    const management = vi.fn().mockResolvedValue(diagnostics);
    const api = { request, management } as Pick<HausNative, 'request' | 'management'>;
    expect(Object.keys(await loadHueSceneArtwork(snapshot, api))).toHaveLength(2);
    expect(request).toHaveBeenCalledWith({ type: 'config_entries/get' });
    expect(management.mock.calls).toEqual([
      [{ method: 'GET', path: 'diagnostics/config_entry/bridge' }],
    ]);
    request.mockClear();
    management.mockClear();
    snapshot.user.is_admin = false;
    expect(await loadHueSceneArtwork(snapshot, api)).toEqual({});
    expect(request).not.toHaveBeenCalled();
    expect(management).not.toHaveBeenCalled();
  });
});
