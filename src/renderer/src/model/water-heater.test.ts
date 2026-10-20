import { describe, expect, it } from 'vitest';
import { buildAction, createDemoSnapshot, resolveCapabilities, applyDemoAction } from './index';
import { OptimisticState } from './optimistic';
import { heaterModeLabel, isKettle, knownTemperature } from './water-heater';
import type { HassEntity } from './types';

function fixture() {
  const snapshot = createDemoSnapshot();
  const entity: HassEntity = {
    entity_id: 'water_heater.kettle',
    state: 'off',
    attributes: {
      supported_features: 3,
      current_temperature: 21,
      temperature: 80,
      min_temp: 40,
      max_temp: 99,
      operation_mode: 'off',
      operation_list: ['off', 'electric', 'performance'],
    },
    last_changed: '',
  };
  snapshot.states.push(entity);
  snapshot.services.water_heater = { set_temperature: {}, set_operation_mode: {} };
  return { snapshot, entity };
}

describe('water heater controls', () => {
  it('uses model-aware Heat and Boil labels without changing generic heater semantics', () => {
    const { entity } = fixture();
    expect(isKettle({ model: 'xiaomi.kettle.v21', state: entity })).toBe(true);
    expect(isKettle({ model: 'boiler', state: entity })).toBe(false);
    expect(heaterModeLabel('performance', true)).toBe('Boil');
    expect(heaterModeLabel('electric', true)).toBe('Heat');
    expect(heaterModeLabel('performance', false)).toBe('Performance');
    expect(knownTemperature(null)).toBeUndefined();
    expect(knownTemperature(NaN)).toBeUndefined();
    expect(knownTemperature(0)).toBe(0);
  });
  it('separates target adjustment from activation and validates supported modes', () => {
    const { entity } = fixture();
    expect(buildAction(entity, 'water-temperature', 100)).toMatchObject({
      service: 'set_temperature',
      service_data: { temperature: 99 },
    });
    expect(buildAction(entity, 'heater-mode', 'performance')).toMatchObject({
      service: 'set_operation_mode',
      service_data: { operation_mode: 'performance' },
    });
    expect(() => buildAction(entity, 'heater-mode', 'on')).toThrow();
    expect(() =>
      buildAction(
        { ...entity, attributes: { ...entity.attributes, read_only: true } },
        'heater-mode',
        'performance',
      ),
    ).toThrow('read-only');
  });
  it('only exposes capabilities backed by the entity and hides read-only commands', () => {
    const { snapshot, entity } = fixture();
    expect(resolveCapabilities(entity, snapshot.services)).toEqual([
      'water-temperature',
      'heater-mode',
    ]);
    expect(
      resolveCapabilities(
        { ...entity, attributes: { ...entity.attributes, supported_features: 1 } },
        snapshot.services,
      ),
    ).toEqual(['water-temperature']);
    expect(
      resolveCapabilities(
        { ...entity, attributes: { ...entity.attributes, read_only: true } },
        snapshot.services,
      ),
    ).toEqual([]);
  });
  it('retains a pending mode through an early report and applies the same intent in demo', () => {
    const { snapshot, entity } = fixture();
    const action = buildAction(entity, 'heater-mode', 'performance');
    const engine = new OptimisticState();
    const id = engine.begin(snapshot, action, 100);
    engine.acknowledge(id, 'mode', snapshot, 110);
    engine.reconcile(entity, 'mode', 120);
    expect(engine.project(snapshot).states.at(-1)).toMatchObject({
      state: 'performance',
      attributes: { operation_mode: 'performance' },
    });
    const result = applyDemoAction(snapshot, action);
    engine.reconcile(result.states.at(-1)!, 'mode', 130);
    expect(engine.size).toBe(0);
    expect(entity.state).toBe('off');
  });
  it('confirms HA water heaters that expose operation mode only as their state', () => {
    const { snapshot, entity } = fixture();
    delete entity.attributes.operation_mode;
    const engine = new OptimisticState();
    const id = engine.begin(snapshot, buildAction(entity, 'heater-mode', 'electric'), 100);
    engine.acknowledge(id, 'mode', snapshot, 110);
    engine.reconcile({ ...entity, state: 'electric' }, 'mode', 120);
    expect(engine.size).toBe(0);
  });
});
