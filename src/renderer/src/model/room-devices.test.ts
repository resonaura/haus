import { describe, expect, it } from 'vitest';
import { buildAction } from './actions';
import {
  groupNumberedLights,
  lightGroupActions,
  lightGroupDescription,
  orderRoomDevices,
} from './room-devices';
import type { HausAccessory } from './types';

function device(id: string, name: string, overrides: Partial<HausAccessory> = {}): HausAccessory {
  const light = id.startsWith('light.');
  return {
    id,
    primaryEntityId: id,
    entityIds: [id],
    areaId: 'bedroom',
    category: light ? 'lights' : 'other',
    name,
    availability: 'available',
    capabilities: light ? ['toggle', 'brightness', 'color'] : [],
    state: {
      entity_id: id,
      state: 'off',
      attributes: light ? { supported_color_modes: ['rgb'], brightness: 100 } : {},
      last_changed: '',
    },
    secondaryEntities: [],
    ...overrides,
  };
}
const preferences = { favorites: [], manualUsage: {} };
const pair = () => [
  device('light.ceiling_2', 'Bedroom Ceiling Lamp 2'),
  device('light.ceiling_1', 'Bedroom Ceiling Lamp 1'),
];

describe('room device importance', () => {
  it('puts lighting and climate before passive sensors, network and battery telemetry', () => {
    const items = [
      device('sensor.battery', 'Wall switch battery'),
      device('binary_sensor.door', 'Door'),
      device('sensor.router', 'Router', { category: 'network' }),
      device('climate.ac', 'Air conditioner'),
      device('light.bed', 'Bed lamp'),
    ];
    expect(orderRoomDevices(items, preferences).map((item) => item.id)).toEqual([
      'light.bed',
      'climate.ac',
      'binary_sensor.door',
      'sensor.router',
      'sensor.battery',
    ]);
  });
  it('keeps positions stable when states change; safety alerts have their own attention surface', () => {
    const leak = device('binary_sensor.leak', 'Leak', {
      state: {
        entity_id: 'binary_sensor.leak',
        state: 'on',
        attributes: { device_class: 'moisture' },
        last_changed: '',
      },
    });
    const items = [device('light.bed', 'Bed lamp'), device('switch.desk', 'Desk'), leak];
    expect(
      orderRoomDevices(items, { favorites: ['switch.desk'], manualUsage: {} }).map(
        (item) => item.id,
      ),
    ).toEqual(['switch.desk', 'light.bed', 'binary_sensor.leak']);
    leak.state.state = 'off';
    expect(
      orderRoomDevices(items, { favorites: ['switch.desk'], manualUsage: {} }).map(
        (item) => item.id,
      ),
    ).toEqual(['switch.desk', 'light.bed', 'binary_sensor.leak']);
  });
  it('ignores live use counts and preserves explicit placement', () => {
    const a = device('light.a', 'Lamp A');
    const b = device('light.b', 'Lamp B', { entityIds: ['light.b', 'switch.b_power'] });
    const learned = { favorites: [], manualUsage: { 'switch.b_power': { count: 4, lastUsed: 1 } } };
    expect(orderRoomDevices([a, b], learned).map((item) => item.id)).toEqual([
      'light.a',
      'light.b',
    ]);
    expect(
      orderRoomDevices([a, b], learned, ['light.a', 'light.b']).map((item) => item.id),
    ).toEqual(['light.a', 'light.b']);
  });
});

describe('numbered light groups', () => {
  it('combines a numbered set without mutating its real device IDs or states', () => {
    const items = pair();
    const grouped = groupNumberedLights(items);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].name).toBe('Bedroom Ceiling Lamp');
    expect(grouped[0].lightGroup?.members.map((item) => item.id)).toEqual([
      'light.ceiling_1',
      'light.ceiling_2',
    ]);
    expect(items.map((item) => item.name)).toEqual([
      'Bedroom Ceiling Lamp 2',
      'Bedroom Ceiling Lamp 1',
    ]);
    expect(lightGroupDescription(grouped[0])).toBe('2 lights · Off');
  });
  it('can be disabled globally or for one set, and restores manual placement after separation', () => {
    const items = pair();
    const grouped = groupNumberedLights(items)[0];
    expect(groupNumberedLights(items, false)).toEqual(items);
    expect(groupNumberedLights(items, true, [grouped.lightGroup!.key])).toEqual(items);
    const bed = device('light.bed', 'Bed lamp');
    const saved = [grouped.id, bed.id];
    expect(orderRoomDevices([...items, bed], preferences, saved).map((item) => item.id)).toEqual([
      'light.ceiling_1',
      'light.ceiling_2',
      'light.bed',
    ]);
    expect(
      orderRoomDevices([bed, grouped], preferences, ['light.ceiling_1', 'light.bed']).map(
        (item) => item.id,
      ),
    ).toEqual([grouped.id, bed.id]);
  });
  it('keeps different rooms, unknown rooms, duplicate numbering and incompatible light kinds separate', () => {
    const [a, b] = pair();
    expect(groupNumberedLights([a, { ...b, areaId: 'kitchen' }])).toHaveLength(2);
    expect(
      groupNumberedLights([
        { ...a, areaId: undefined },
        { ...b, areaId: undefined },
      ]),
    ).toHaveLength(2);
    expect(groupNumberedLights([a, { ...b, name: a.name }])).toHaveLength(2);
    expect(
      groupNumberedLights([
        a,
        { ...b, state: { ...b.state, attributes: { supported_color_modes: ['onoff'] } } },
      ]),
    ).toHaveLength(2);
  });
  it('supports common numbering forms and never groups sockets', () => {
    expect(
      groupNumberedLights([device('light.a', 'Lamp #1'), device('light.b', 'Lamp #2')]),
    ).toHaveLength(1);
    expect(
      groupNumberedLights([device('light.a', 'Lamp1'), device('light.b', 'Lamp2')]),
    ).toHaveLength(1);
    expect(
      groupNumberedLights([device('switch.a', 'Socket 1'), device('switch.b', 'Socket 2')]),
    ).toHaveLength(2);
  });
  it('exposes the common temperature range and omits a temperature control when ranges do not overlap', () => {
    const items = pair().map((item, index) => ({
      ...item,
      capabilities: ['toggle', 'brightness', 'temperature'],
      state: {
        ...item.state,
        attributes: {
          supported_color_modes: ['color_temp'],
          min_color_temp_kelvin: index ? 2700 : 2000,
          max_color_temp_kelvin: index ? 6000 : 4000,
        },
      },
    }));
    const grouped = groupNumberedLights(items)[0];
    expect(grouped.state.attributes).toMatchObject({
      min_color_temp_kelvin: 2700,
      max_color_temp_kelvin: 4000,
    });
    items[1].state.attributes.min_color_temp_kelvin = 5000;
    expect(groupNumberedLights(items)[0].capabilities).not.toContain('temperature');
  });
  it('sends one consistent power command to each available member, leaving offline members intact', () => {
    const [a, b] = pair();
    a.state = { ...a.state, state: 'on' };
    const grouped = groupNumberedLights([a, b])[0];
    expect(lightGroupActions(grouped, buildAction(grouped.state, 'toggle'))).toEqual([
      { domain: 'light', service: 'turn_off', target: { entity_id: 'light.ceiling_1' } },
      { domain: 'light', service: 'turn_off', target: { entity_id: 'light.ceiling_2' } },
    ]);
    b.availability = 'unavailable';
    b.state = { ...b.state, state: 'unavailable' };
    const partial = groupNumberedLights([a, b])[0];
    expect(lightGroupActions(partial, buildAction(partial.state, 'brightness', 45))).toEqual([
      {
        domain: 'light',
        service: 'turn_on',
        target: { entity_id: a.id },
        service_data: { brightness_pct: 45 },
      },
    ]);
    expect(lightGroupDescription(partial)).toBe('2 lights · 1 on · 1 unavailable');
    a.availability = 'unavailable';
    expect(() =>
      lightGroupActions(groupNumberedLights([a, b])[0], buildAction(grouped.state, 'toggle')),
    ).toThrow('All lights');
  });
  it('does not report one member’s color as the color of a mixed group', () => {
    const items = pair();
    items.forEach((item, index) => {
      item.state.state = 'on';
      item.state.attributes.rgb_color = index ? [255, 0, 0] : [0, 0, 255];
    });
    expect(groupNumberedLights(items)[0].state.attributes.rgb_color).toBeUndefined();
  });
});
