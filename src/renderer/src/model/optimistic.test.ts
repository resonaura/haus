import { describe, expect, it } from 'vitest';
import { buildAction } from './actions';
import { createDemoSnapshot } from './demo';
import { EntityActionQueue, OptimisticState } from './optimistic';
import type { HassEntity } from './types';

function fixture() {
  const snapshot = createDemoSnapshot();
  snapshot.states = [
    {
      entity_id: 'light.one',
      state: 'off',
      attributes: {
        brightness: 80,
        supported_color_modes: ['rgb', 'color_temp'],
        rgb_color: [255, 180, 80],
        color_mode: 'rgb',
      },
      last_changed: '',
    },
    { entity_id: 'switch.desk', state: 'off', attributes: {}, last_changed: '' },
    {
      entity_id: 'climate.home',
      state: 'heat',
      attributes: { temperature: 20, current_temperature: 19 },
      last_changed: '',
    },
    {
      entity_id: 'cover.blinds',
      state: 'closed',
      attributes: { current_position: 0 },
      last_changed: '',
    },
    { entity_id: 'lock.door', state: 'locked', attributes: {}, last_changed: '' },
    {
      entity_id: 'media_player.tv',
      state: 'paused',
      attributes: { volume_level: 0.2 },
      last_changed: '',
    },
    { entity_id: 'button.test', state: 'unknown', attributes: {}, last_changed: '' },
    { entity_id: 'scene.relax', state: 'unknown', attributes: {}, last_changed: '' },
    { entity_id: 'fan.desk', state: 'off', attributes: { percentage: 0 }, last_changed: '' },
    {
      entity_id: 'select.mode',
      state: 'Auto',
      attributes: { options: ['Auto', 'Manual'] },
      last_changed: '',
    },
    { entity_id: 'number.level', state: '2', attributes: { min: 0, max: 10 }, last_changed: '' },
  ];
  const engine = new OptimisticState();
  const entity = (id = 'light.one') =>
    engine.project(snapshot).states.find((item) => item.entity_id === id)!;
  const action = (intent: string, value?: unknown, id = 'light.one') =>
    buildAction(entity(id), intent, value);
  const report = (id: string, patch: Partial<HassEntity>, context?: string, at = 200) => {
    const current = snapshot.states.find((item) => item.entity_id === id)!;
    const state = {
      ...current,
      ...patch,
      attributes: { ...current.attributes, ...patch.attributes },
    };
    snapshot.states = snapshot.states.map((item) => (item.entity_id === id ? state : item));
    engine.reconcile(state, context, at);
  };
  return { snapshot, engine, entity, action, report };
}

describe('shared optimistic device state', () => {
  it.each(['invalid', -1, Infinity])(
    'ignores malformed numeric step %s when confirming a value',
    (step) => {
      const { snapshot, engine, action, report } = fixture();
      snapshot.states.find((s) => s.entity_id === 'number.level')!.attributes.step = step;
      const token = engine.begin(snapshot, action('value', 5, 'number.level'), 100);
      engine.acknowledge(token, 'number', snapshot, 110);
      report('number.level', { state: '2' }, 'number', 120);
      expect(engine.size).toBe(1);
      report('number.level', { state: '5.0' }, 'number', 130);
      expect(engine.size).toBe(0);
    },
  );
  it('does not confirm a numeric zero from a blank server value', () => {
    const { snapshot, engine, action, report } = fixture();
    const token = engine.begin(snapshot, action('value', 0, 'number.level'), 100);
    engine.acknowledge(token, 'number', snapshot, 110);
    report('number.level', { state: ' ' }, 'number', 120);
    expect(engine.size).toBe(1);
  });
  it('accepts numeric formatting and device step quantization after parameter updates', () => {
    const { snapshot, engine, action, report } = fixture();
    let token = engine.begin(snapshot, action('value', 5, 'number.level'), 100);
    engine.acknowledge(token, 'number', snapshot, 110);
    report('number.level', { state: '5.0' }, 'number', 120);
    expect(engine.size).toBe(0);
    snapshot.states.find((s) => s.entity_id === 'number.level')!.attributes.step = 0.5;
    token = engine.begin(snapshot, action('value', 5.2, 'number.level'), 130);
    engine.acknowledge(token, 'rounded', snapshot, 140);
    report('number.level', { state: '5.0' }, 'rounded', 150);
    expect(engine.size).toBe(0);
  });
  it('does not treat an early same-context report with old power/colour/brightness as a completed command', () => {
    const { snapshot, engine, entity, action, report } = fixture();
    const token = engine.begin(snapshot, action('color', '#8040ff'), 100);
    engine.acknowledge(token, 'colour', snapshot, 110);
    report('light.one', { state: 'off' }, 'colour', 120);
    expect(entity().state).toBe('on');
    expect(entity().attributes.rgb_color).toEqual([128, 64, 255]);
    report(
      'light.one',
      { state: 'on', attributes: { brightness: 80, rgb_color: [255, 180, 80] } },
      'colour',
      130,
    );
    expect(engine.size).toBe(1);
    expect(entity().attributes.rgb_color).toEqual([128, 64, 255]);
    report(
      'light.one',
      { attributes: { rgb_color: [120, 60, 240], color_mode: 'xy' } },
      'colour',
      140,
    );
    expect(engine.size).toBe(0);
  });
  it.each([
    ['light.one', 'brightness', 70, 'brightness', 80, 179],
    ['climate.home', 'climate-temperature', 23, 'temperature', 20, 23],
    ['media_player.tv', 'volume', 0.7, 'volume_level', 0.2, 0.7],
  ])(
    'holds the requested %s parameter through early reports before and after acknowledgement',
    (id, intent, value, key, oldValue, newValue) => {
      const { snapshot, engine, entity, action, report } = fixture();
      const token = engine.begin(snapshot, action(intent as string, value, id as string), 100);
      report(
        id as string,
        {
          state: id === 'light.one' ? 'on' : entity(id as string).state,
          attributes: { [key as string]: oldValue },
        },
        'command',
        105,
      );
      engine.acknowledge(token, 'command', snapshot, 110);
      expect(entity(id as string).attributes[key as string]).toBe(newValue);
      expect(engine.size).toBe(1);
      report(id as string, { attributes: { [key as string]: newValue } }, 'command', 120);
      expect(engine.size).toBe(0);
    },
  );
  it('keeps queued intent through an old matching report and rejects only known older local confirmations after settlement', () => {
    const { snapshot, engine, entity, action, report } = fixture();
    const first = engine.begin(snapshot, action('toggle'), 100);
    const second = engine.begin(snapshot, action('toggle'), 110);
    report('light.one', { state: 'off' }, 'telemetry', 115);
    expect(engine.size).toBe(2);
    engine.acknowledge(first, 'first', snapshot, 120);
    report('light.one', { state: 'on' }, 'first', 130);
    expect(entity().state).toBe('off');
    engine.acknowledge(second, 'second', snapshot, 140);
    report('light.one', { state: 'off' }, 'second', 150);
    expect(engine.reconcile({ ...entity(), state: 'on' }, 'first', 160)).toBe(false);
    expect(engine.reconcile({ ...entity(), state: 'on' }, 'another-app', 170)).toBe(true);
    expect(engine.reconcile({ ...entity(), state: 'unavailable' }, 'first', 180)).toBe(true);
    engine.clear();
    expect(engine.reconcile({ ...entity(), state: 'on' }, 'first', 190)).toBe(true);
  });
  it('shares the oldest unresolved command time and clears it on completion', () => {
    const { snapshot, engine, action } = fixture();
    const first = engine.begin(snapshot, action('toggle'), 1000);
    const second = engine.begin(snapshot, action('brightness', 50), 2000);
    expect(engine.project(snapshot).pendingSince?.['light.one']).toBe(1000);
    engine.reject(first);
    expect(engine.project(snapshot).pendingSince?.['light.one']).toBe(2000);
    engine.reject(second);
    expect(engine.project(snapshot).pendingSince?.['light.one']).toBeUndefined();
  });

  it('updates all views immediately and leaves server facts untouched until confirmation', () => {
    const { snapshot, engine, entity, action, report } = fixture();
    const token = engine.begin(snapshot, action('toggle'), 100);
    expect(entity().state).toBe('on');
    expect(snapshot.states[0].state).toBe('off');
    expect(engine.project(snapshot).pendingEntityIds).toContain('light.one');
    engine.acknowledge(token, 'command-1', snapshot, 150);
    expect(entity().state).toBe('on');
    report('light.one', { state: 'on' }, 'command-1');
    expect(engine.size).toBe(0);
    expect(entity().state).toBe('on');
  });

  it('keeps the latest rapid toggle visible when an older command fails or reports late', () => {
    const { snapshot, engine, entity, action, report } = fixture();
    const first = engine.begin(snapshot, action('toggle'), 100);
    const second = engine.begin(snapshot, action('toggle'), 110);
    expect(entity().state).toBe('off');
    engine.reject(first);
    expect(entity().state).toBe('off');
    report('light.one', { state: 'on' }, 'old-command', 130);
    expect(entity().state).toBe('off');
    engine.acknowledge(second, 'new-command', snapshot, 140);
    report('light.one', { state: 'off' }, 'new-command', 150);
    expect(entity().state).toBe('off');
    expect(engine.size).toBe(0);
  });

  it('never resurrects a superseded value after a newer command is confirmed', () => {
    const { snapshot, engine, entity, action, report } = fixture();
    const first = engine.begin(snapshot, action('toggle'), 100);
    engine.acknowledge(first, 'first', snapshot, 105);
    const second = engine.begin(snapshot, action('toggle'), 110);
    engine.acknowledge(second, 'second', snapshot, 115);
    report('light.one', { state: 'off' }, 'second', 130);
    expect(engine.size).toBe(0);
    expect(entity().state).toBe('off');
    engine.reject(first);
    expect(entity().state).toBe('off');
  });

  it('rolls back just the failed command, preserving other devices and new server attributes', () => {
    const { snapshot, engine, entity, action, report } = fixture();
    const light = engine.begin(snapshot, action('brightness', 70), 100);
    engine.begin(snapshot, action('toggle', undefined, 'switch.desk'), 110);
    report('light.one', { attributes: { effect: 'new server value' } }, undefined, 120);
    engine.reject(light);
    expect(entity().state).toBe('off');
    expect(entity().attributes.brightness).toBe(80);
    expect(entity().attributes.effect).toBe('new server value');
    expect(entity('switch.desk').state).toBe('on');
  });

  it('merges overlapping color and brightness intent without rolling a newer value back', () => {
    const { snapshot, engine, entity, action } = fixture();
    const brightness = engine.begin(snapshot, action('brightness', 75), 100);
    const color = engine.begin(snapshot, action('color', '#8040ff'), 110);
    expect(entity().attributes).toMatchObject({ brightness: 191, rgb_color: [128, 64, 255] });
    engine.reject(brightness);
    expect(entity().state).toBe('on');
    expect(entity().attributes.rgb_color).toEqual([128, 64, 255]);
    engine.reject(color);
    expect(entity().state).toBe('off');
    expect(entity().attributes.rgb_color).toEqual([255, 180, 80]);
  });

  it('accepts normalized device color through the HA context, even when the event beats the ack', () => {
    const { snapshot, engine, entity, action, report } = fixture();
    const token = engine.begin(snapshot, action('color', '#8040ff'), 100);
    report(
      'light.one',
      { state: 'on', attributes: { color_mode: 'xy', rgb_color: [120, 60, 240] } },
      'color-context',
      110,
    );
    expect(engine.size).toBe(1);
    engine.acknowledge(token, 'color-context', snapshot, 120);
    expect(engine.size).toBe(0);
    expect(entity().attributes.rgb_color).toEqual([120, 60, 240]);
  });

  it('lets unavailable server state win immediately', () => {
    const { snapshot, engine, entity, action, report } = fixture();
    engine.begin(snapshot, action('brightness', 70), 100);
    report('light.one', { state: 'unavailable' });
    expect(engine.size).toBe(0);
    expect(entity().state).toBe('unavailable');
  });

  it('expires unconfirmed intent back to reported state and clears no-op commands on acknowledgement', () => {
    const { snapshot, engine, entity, action } = fixture();
    const token = engine.begin(snapshot, action('brightness', 70), 100);
    engine.acknowledge(token, 'missing', snapshot, 200);
    expect(engine.expire(10199)).toBe(0);
    expect(engine.expire(10200)).toBe(1);
    expect(entity().state).toBe('off');
    const same = engine.begin(
      snapshot,
      { domain: 'light', service: 'turn_off', target: { entity_id: 'light.one' } },
      11000,
    );
    engine.acknowledge(same, 'no-change', snapshot, 11100);
    expect(engine.size).toBe(0);
  });

  it('previews configured scenes across their targets without changing unknown Hue settings', () => {
    const { snapshot, engine, entity, action } = fixture();
    snapshot.sceneConfigs = {
      'scene.relax': {
        entities: { 'light.one': { state: 'on', brightness: 40 }, 'switch.desk': 'on' },
      },
    };
    const token = engine.begin(snapshot, action('run', undefined, 'scene.relax'), 100);
    expect(entity().attributes.brightness).toBe(40);
    expect(entity('switch.desk').state).toBe('on');
    expect(entity('scene.relax').state).toBe('unknown');
    engine.reject(token);
    expect(entity().state).toBe('off');
    delete snapshot.sceneConfigs;
    const unknown = engine.begin(snapshot, action('run', undefined, 'scene.relax'), 200);
    expect(entity().state).toBe('off');
    engine.acknowledge(unknown, 'scene', snapshot, 210);
    expect(engine.size).toBe(0);
  });

  it('marks stateless buttons as pending without inventing a successful device result', () => {
    const { snapshot, engine, entity, action } = fixture();
    const token = engine.begin(snapshot, action('press', undefined, 'button.test'), 100);
    expect(entity('button.test').state).toBe('unknown');
    expect(engine.project(snapshot).pendingEntityIds).toEqual(['button.test']);
    engine.acknowledge(token, 'button', snapshot, 110);
    expect(engine.size).toBe(0);
  });

  it.each([
    ['climate.home', 'climate-temperature', 23, 'heat', 'temperature', 23],
    ['media_player.tv', 'volume', 0.7, 'paused', 'volume_level', 0.7],
    ['fan.desk', 'percentage', 60, 'on', 'percentage', 60],
    ['select.mode', 'select', 'Manual', 'Manual', undefined, undefined],
    ['number.level', 'value', 5, '5', undefined, undefined],
    ['lock.door', 'unlock', undefined, 'unlocking', undefined, undefined],
    ['cover.blinds', 'open', undefined, 'opening', undefined, undefined],
  ])('updates %s centrally', (id, intent, value, expected, key, attribute) => {
    const { snapshot, engine, entity, action } = fixture();
    const token = engine.begin(snapshot, action(intent as string, value, id as string), 100);
    expect(entity(id as string).state).toBe(expected);
    if (key) expect(entity(id as string).attributes[key]).toBe(attribute);
    engine.reject(token);
    expect(engine.project(snapshot)).toBe(snapshot);
  });
});

describe('device command ordering', () => {
  it('serializes the same target but does not block another device', async () => {
    const queue = new EntityActionQueue();
    const calls: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = queue.run('light.one', async () => {
      calls.push('on');
      await held;
    });
    const second = queue.run('light.one', async () => {
      calls.push('off');
    });
    await queue.run('switch.desk', async () => {
      calls.push('desk');
    });
    expect(calls).toEqual(['on', 'desk']);
    release();
    await Promise.all([first, second]);
    expect(calls).toEqual(['on', 'desk', 'off']);
  });
  it('continues with the latest intent when a prior command fails', async () => {
    const queue = new EntityActionQueue();
    const first = queue.run('light.one', async () => {
      throw new Error('rejected');
    });
    const second = queue.run('light.one', async () => 'latest');
    await expect(first).rejects.toThrow('rejected');
    await expect(second).resolves.toBe('latest');
  });
});
