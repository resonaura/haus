import { describe, expect, it } from 'vitest';
import { buildAction } from './actions';
import { createDemoSnapshot } from './demo';
import { OptimisticState } from './optimistic';
import type { HassEntity } from './types';

function fixture(bridge = true) {
  const snapshot = createDemoSnapshot();
  snapshot.states = [
    {
      entity_id: 'water_heater.kettle',
      state: 'off',
      attributes: {
        operation_mode: 'off',
        operation_list: ['off', 'electric', 'performance'],
        current_temperature: 21,
        temperature: 80,
        temperature_unit: '°C',
        min_temp: 40,
        max_temp: 99,
        last_command: {
          sequence: 10,
          control: 'mode',
          status: 'observed',
          expected: { mode: 'off', power: false },
        },
      },
      last_changed: '',
    },
  ];
  snapshot.entities = [
    {
      entity_id: 'water_heater.kettle',
      platform: bridge ? 'mqtt' : 'other',
      unique_id: bridge ? 'haus_kettle_123_kettle' : 'heater-123',
    },
  ];
  const engine = new OptimisticState();
  const current = () => snapshot.states[0];
  const mode = (value: string) => buildAction(current(), 'heater-mode', value);
  const report = (patch: Partial<HassEntity>, at: number) => {
    const before = current();
    const next = {
      ...before,
      ...patch,
      attributes: { ...before.attributes, ...patch.attributes },
    };
    engine.reconcile(next, 'mqtt-observation', at);
    snapshot.states = [next];
  };
  const diagnostic = (sequence: unknown, requested: string, status: string) => ({
    sequence,
    control: 'mode',
    expected: { mode: requested },
    status,
  });
  return { snapshot, engine, current, mode, report, diagnostic };
}

describe('Haus kettle command confirmation', () => {
  it('holds a delayed kettle result past ten seconds and confirms actual HA operation mode', () => {
    const { snapshot, engine, mode, report, diagnostic } = fixture();
    const id = engine.begin(snapshot, mode('electric'), 100);
    engine.acknowledge(id, 'service', snapshot, 200);
    expect(engine.expire(10_201)).toBe(0);
    report(
      {
        state: 'heating',
        attributes: {
          operation_mode: 'electric',
          last_command: diagnostic(11, 'electric', 'observed'),
        },
      },
      15_000,
    );
    expect(engine.size).toBe(0);
    expect(engine.project(snapshot).states[0].state).toBe('heating');
    expect(engine.takeFailures()).toEqual([]);
  });

  it('caps the exact bridge at 35 seconds from begin, regardless of acknowledgement time', () => {
    const { snapshot, engine, mode } = fixture();
    const id = engine.begin(snapshot, mode('electric'), 100);
    engine.acknowledge(id, 'slow-service', snapshot, 10_000);
    expect(engine.expire(35_099)).toBe(0);
    expect(engine.expire(35_100)).toBe(1);
    expect(engine.project(snapshot).states[0].state).toBe('off');
  });

  it('keeps the generic water-heater confirmation budget unchanged', () => {
    const { snapshot, engine, mode } = fixture(false);
    const id = engine.begin(snapshot, mode('electric'), 100);
    engine.acknowledge(id, 'service', snapshot, 200);
    expect(engine.expire(10_199)).toBe(0);
    expect(engine.expire(10_200)).toBe(1);
  });

  it('does not extend another MQTT integration with a lookalike kettle ID', () => {
    const { snapshot, engine, mode } = fixture();
    snapshot.entities[0].unique_id = 'something_haus_kettle_123_kettle';
    const id = engine.begin(snapshot, mode('electric'), 100);
    engine.acknowledge(id, 'service', snapshot, 200);
    expect(engine.expire(10_200)).toBe(1);
  });

  it('ignores old sequences and mismatching controls/outcomes before a correlated failure', () => {
    const { snapshot, engine, mode, report, diagnostic } = fixture();
    const id = engine.begin(snapshot, mode('electric'), 100);
    engine.acknowledge(id, 'service', snapshot, 110);
    report({ attributes: { last_command: diagnostic(10, 'electric', 'unconfirmed') } }, 120);
    report({ attributes: { last_command: diagnostic(11, 'performance', 'unconfirmed') } }, 130);
    report(
      {
        attributes: {
          last_command: {
            sequence: 11,
            control: 'target_temperature',
            expected: { target_temperature: 45 },
            status: 'unconfirmed',
          },
        },
      },
      140,
    );
    expect(engine.size).toBe(1);
    expect(engine.takeFailures()).toEqual([]);
    report({ attributes: { last_command: diagnostic(11, 'electric', 'unconfirmed') } }, 150);
    expect(engine.size).toBe(0);
    expect(engine.project(snapshot).states[0].state).toBe('off');
    expect(engine.takeFailures()).toHaveLength(1);
    expect(engine.takeFailures()).toEqual([]);
  });

  it('does not mistake a lost acknowledgement still awaiting state for a terminal failure', () => {
    const { snapshot, engine, mode, report, diagnostic } = fixture();
    const id = engine.begin(snapshot, mode('electric'), 100);
    engine.acknowledge(id, 'service', snapshot, 110);
    report(
      {
        attributes: {
          last_command: {
            ...diagnostic(11, 'electric', 'waiting'),
            acknowledgement: 'unconfirmed',
          },
        },
      },
      120,
    );
    expect(engine.size).toBe(1);
    expect(engine.takeFailures()).toEqual([]);
    report(
      {
        state: 'heating',
        attributes: {
          operation_mode: 'electric',
          last_command: diagnostic(11, 'electric', 'observed'),
        },
      },
      130,
    );
    expect(engine.size).toBe(0);
  });

  it('processes a correlated terminal result that arrives before the HA service acknowledgement', () => {
    const { snapshot, engine, mode, report, diagnostic } = fixture();
    const id = engine.begin(snapshot, mode('electric'), 100);
    report({ attributes: { last_command: diagnostic(11, 'electric', 'unconfirmed') } }, 110);
    expect(engine.size).toBe(1);
    engine.acknowledge(id, 'service', snapshot, 120);
    expect(engine.size).toBe(0);
    expect(engine.takeFailures()).toHaveLength(1);
  });

  it('reports a terminal failure once across repeated MQTT observations and acknowledgements', () => {
    const { snapshot, engine, mode, report, diagnostic } = fixture();
    const id = engine.begin(snapshot, mode('electric'), 100);
    engine.acknowledge(id, 'service', snapshot, 110);
    report({ attributes: { last_command: diagnostic(11, 'electric', 'unconfirmed') } }, 120);
    expect(engine.takeFailures()).toHaveLength(1);
    report({ attributes: { last_command: diagnostic(11, 'electric', 'unconfirmed') } }, 130);
    engine.acknowledge(id, 'service', snapshot, 140);
    expect(engine.takeFailures()).toEqual([]);
    expect(engine.size).toBe(0);
  });

  it('never uses another entity or a generic heater diagnostic to reject a kettle intent', () => {
    const { snapshot, engine, mode, diagnostic } = fixture();
    const id = engine.begin(snapshot, mode('electric'), 100);
    engine.acknowledge(id, 'service', snapshot, 110);
    engine.reconcile(
      {
        ...snapshot.states[0],
        entity_id: 'water_heater.other',
        attributes: { last_command: diagnostic(11, 'electric', 'unconfirmed') },
      },
      'other',
      120,
    );
    expect(engine.size).toBe(1);
    expect(engine.takeFailures()).toEqual([]);
    const generic = fixture(false);
    const token = generic.engine.begin(generic.snapshot, generic.mode('electric'), 100);
    generic.engine.acknowledge(token, 'generic', generic.snapshot, 110);
    generic.report(
      { attributes: { last_command: diagnostic(11, 'electric', 'unconfirmed') } },
      120,
    );
    expect(generic.engine.size).toBe(1);
    expect(generic.engine.takeFailures()).toEqual([]);
  });

  it('leaves the latest A intent intact when older A and B results arrive late', () => {
    const { snapshot, engine, mode, report, diagnostic } = fixture();
    const first = engine.begin(snapshot, mode('electric'), 100);
    engine.acknowledge(first, 'first', snapshot, 110);
    report({ attributes: { last_command: diagnostic(11, 'electric', 'waiting') } }, 120);
    const second = engine.begin(snapshot, mode('performance'), 130);
    engine.acknowledge(second, 'second', snapshot, 140);
    const third = engine.begin(snapshot, mode('electric'), 150);
    engine.acknowledge(third, 'third', snapshot, 160);
    report({ attributes: { last_command: diagnostic(11, 'electric', 'unconfirmed') } }, 170);
    expect(engine.project(snapshot).states[0].attributes.operation_mode).toBe('electric');
    expect(engine.takeFailures()).toEqual([]);
    report({ attributes: { last_command: diagnostic(12, 'performance', 'waiting') } }, 180);
    report({ attributes: { last_command: diagnostic(13, 'electric', 'waiting') } }, 190);
    report({ attributes: { last_command: diagnostic(12, 'performance', 'unconfirmed') } }, 200);
    expect(engine.size).toBe(1);
    expect(engine.takeFailures()).toEqual([]);
    report({ attributes: { last_command: diagnostic(13, 'electric', 'unconfirmed') } }, 210);
    expect(engine.size).toBe(0);
    expect(engine.takeFailures()).toHaveLength(1);
  });

  it('retains a completed intent claim so a late old A error cannot reject a new A', () => {
    const { snapshot, engine, mode, report, diagnostic } = fixture();
    const first = engine.begin(snapshot, mode('electric'), 100);
    engine.acknowledge(first, 'first', snapshot, 110);
    report({ state: 'heating', attributes: { operation_mode: 'electric' } }, 120);
    expect(engine.size).toBe(0);
    report({ state: 'off', attributes: { operation_mode: 'off' } }, 130);
    const second = engine.begin(snapshot, mode('performance'), 140);
    engine.acknowledge(second, 'second', snapshot, 150);
    const third = engine.begin(snapshot, mode('electric'), 160);
    engine.acknowledge(third, 'third', snapshot, 170);
    report({ attributes: { last_command: diagnostic(11, 'electric', 'unconfirmed') } }, 180);
    expect(engine.size).toBe(2);
    expect(engine.project(snapshot).states[0].attributes.operation_mode).toBe('electric');
    expect(engine.takeFailures()).toEqual([]);
  });

  it.each([undefined, 0, -1, '11', Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'falls back to bounded factual confirmation when sequence is %s',
    (sequence) => {
      const { snapshot, engine, mode, report, diagnostic } = fixture();
      delete snapshot.states[0].attributes.last_command;
      const id = engine.begin(snapshot, mode('electric'), 100);
      engine.acknowledge(id, 'service', snapshot, 110);
      report(
        { attributes: { last_command: diagnostic(sequence, 'electric', 'unconfirmed') } },
        120,
      );
      expect(engine.size).toBe(1);
      expect(engine.takeFailures()).toEqual([]);
      expect(engine.expire(35_099)).toBe(0);
      expect(engine.expire(35_100)).toBe(1);
    },
  );

  it('does not associate an ambiguous rejection without a validated expected outcome', () => {
    const { snapshot, engine, mode, report } = fixture();
    const id = engine.begin(snapshot, mode('electric'), 100);
    engine.acknowledge(id, 'service', snapshot, 110);
    report(
      { attributes: { last_command: { sequence: 11, control: 'mode', status: 'rejected' } } },
      120,
    );
    expect(engine.size).toBe(1);
    expect(engine.takeFailures()).toEqual([]);
  });

  it('lets actual matching state confirm success when terminal diagnostics arrive with it', () => {
    const { snapshot, engine, mode, report, diagnostic } = fixture();
    const id = engine.begin(snapshot, mode('electric'), 100);
    engine.acknowledge(id, 'service', snapshot, 110);
    report(
      {
        state: 'heating',
        attributes: {
          operation_mode: 'electric',
          last_command: diagnostic(11, 'electric', 'unconfirmed'),
        },
      },
      120,
    );
    expect(engine.size).toBe(0);
    expect(engine.project(snapshot).states[0].state).toBe('heating');
    expect(engine.takeFailures()).toEqual([]);
  });

  it('correlates the bridge Celsius target while HA displays Fahrenheit', () => {
    const { snapshot, engine, current, report } = fixture();
    current().attributes.temperature_unit = '°F';
    current().attributes.min_temp = 104;
    current().attributes.max_temp = 210;
    const id = engine.begin(snapshot, buildAction(current(), 'water-temperature', 113), 100);
    engine.acknowledge(id, 'temperature', snapshot, 110);
    report(
      {
        attributes: {
          last_command: {
            sequence: 11,
            control: 'target_temperature',
            status: 'unconfirmed',
            expected: { target_temperature: 45 },
          },
        },
      },
      120,
    );
    expect(engine.size).toBe(0);
    expect(engine.takeFailures()).toHaveLength(1);
  });
});
