import { describe, expect, it } from 'vitest';
import { LightOutputMemory, sanitizeLightMemory } from './light-memory';
import { OptimisticState } from './optimistic';
import { createDemoSnapshot } from './demo';
import { buildAction } from './actions';
import { lightColor } from './light-color';
import type { HassEntity } from './types';

const lit = (attributes: Record<string, unknown> = {}): HassEntity => ({
  entity_id: 'light.bed',
  state: 'on',
  last_changed: '2026-10-17T00:00:00Z',
  attributes: {
    supported_color_modes: ['rgb', 'color_temp'],
    color_mode: 'rgb',
    rgb_color: [128, 64, 255],
    brightness: 153,
    ...attributes,
  },
});
const off = (): HassEntity => ({
  ...lit(),
  state: 'off',
  attributes: {
    supported_color_modes: ['rgb', 'color_temp'],
    brightness: null,
    rgb_color: null,
    color_mode: null,
    color_temp_kelvin: null,
  },
});

describe('remembered light output', () => {
  it('predicts the real remembered color and brightness after HA clears all off-state output attributes', () => {
    const engine = new OptimisticState();
    engine.lightMemory.remember(lit());
    const snapshot = createDemoSnapshot();
    snapshot.states = [off()];
    const token = engine.begin(snapshot, buildAction(snapshot.states[0], 'toggle'));
    const expected = engine.project(snapshot).states[0];
    expect(expected.state).toBe('on');
    expect(expected.attributes.brightness).toBe(153);
    expect(lightColor(expected)).toBe('rgb(128, 64, 255)');
    engine.reject(token);
    expect(engine.project(snapshot).states[0].attributes.rgb_color).toBeNull();
    expect(engine.lightMemory.export()['light.bed'].attributes.rgb_color).toEqual([128, 64, 255]);
  });

  it('restores temperature-only lights and lets command parameters override remembered output', () => {
    const engine = new OptimisticState();
    engine.lightMemory.remember(
      lit({
        supported_color_modes: ['color_temp'],
        color_mode: 'color_temp',
        color_temp_kelvin: 2700,
      }),
    );
    const snapshot = createDemoSnapshot();
    snapshot.states = [{ ...off(), attributes: { supported_color_modes: ['color_temp'] } }];
    engine.begin(snapshot, buildAction(snapshot.states[0], 'brightness', 80));
    expect(engine.project(snapshot).states[0].attributes).toMatchObject({
      color_temp_kelvin: 2700,
      color_mode: 'color_temp',
      brightness: 204,
    });
    expect(engine.project(snapshot).states[0].attributes.rgb_color).toBeUndefined();
  });

  it('persists only output parameters, hydrates across launches, and isolates different homes', () => {
    const memory = new LightOutputMemory();
    memory.hydrate('home-a', {});
    memory.remember(
      lit({ diagnostic_token: 'private', entity_picture: '/private', unrelated: true }),
    );
    const saved = JSON.parse(JSON.stringify(memory.export()));
    expect(saved['light.bed'].attributes).not.toHaveProperty('diagnostic_token');
    const restored = new LightOutputMemory();
    restored.hydrate('home-a', saved);
    expect(restored.restore(off()).rgb_color).toEqual([128, 64, 255]);
    restored.hydrate('home-b', {});
    expect(restored.restore(off()).rgb_color).toBeUndefined();
    expect(restored.needsHistory(off())).toBe(true);
  });

  it('never replaces a newer confirmed value with old history or a null off-state', () => {
    const memory = new LightOutputMemory();
    memory.remember(lit());
    memory.remember({ ...lit({ rgb_color: [255, 0, 0] }), last_changed: '2026-10-16T00:00:00Z' });
    memory.remember(off());
    expect(memory.restore(off()).rgb_color).toEqual([128, 64, 255]);
    expect(
      sanitizeLightMemory({ 'switch.desk': { attributes: { brightness: 100 }, updatedAt: 100 } }),
    ).toEqual({});
  });

  it('fills a cold-start pending prediction when history arrives, without changing the requested color', () => {
    const engine = new OptimisticState();
    const snapshot = createDemoSnapshot();
    snapshot.states = [off()];
    engine.begin(snapshot, buildAction(snapshot.states[0], 'color', '#ff8000'));
    engine.lightMemory.remember(lit());
    expect(engine.project(snapshot).states[0].attributes).toMatchObject({
      brightness: 153,
      rgb_color: [255, 128, 0],
    });
  });
  it('keeps confirmed output through partial on-reports without overriding new device values', () => {
    const memory = new LightOutputMemory();
    memory.remember(lit());
    const partial = { ...off(), state: 'on' };
    memory.remember(partial);
    expect(lightColor(memory.complete(partial))).toBe('rgb(128, 64, 255)');
    expect(memory.complete(partial).attributes.brightness).toBe(153);
    const authoritative = lit({ rgb_color: [255, 0, 0], brightness: 0 });
    expect(memory.complete(authoritative).attributes).toMatchObject({
      rgb_color: [255, 0, 0],
      brightness: 0,
    });
  });
});
