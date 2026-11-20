import { describe, expect, it } from 'vitest';
import { mapDomainToCapabilities, parseReadings } from '../../src/hacs/projection.js';
import { HacsVirtualizer } from '../../src/hacs/virtualizer.js';

const weight = { device_class: 'weight', unit_of_measurement: 'kg', state_class: 'measurement' };

describe('sensor metadata across unavailable measurements', () => {
  it.each(['unknown', 'unavailable', null, '73.4'])('keeps weight numeric for %s', (state) => {
    expect(mapDomainToCapabilities('sensor', { state, attributes: weight })).toEqual([
      expect.objectContaining({ id: 'value', kind: 'numeric', unit: 'kg', deviceClass: 'weight' }),
    ]);
  });

  it('does not fabricate readings for an unknown weight, switch or contact', () => {
    for (const state of ['unknown', 'unavailable', null]) {
      expect(parseReadings('sensor', state, weight)).toEqual({});
      expect(parseReadings('switch', state, {})).toEqual({});
      expect(parseReadings('binary_sensor', state, { device_class: 'door' })).toEqual({});
    }
    expect(parseReadings('sensor', '73.4', weight).value.value).toBe(73.4);
  });

  it('preserves textual and enum sensors, including numeric-looking enum options', () => {
    for (const state of ['unknown', 'unavailable', '1']) {
      expect(
        mapDomainToCapabilities('sensor', {
          state,
          attributes: { device_class: 'enum', options: ['1', '2'] },
        })[0]?.kind,
      ).toBe('string');
    }
    expect(mapDomainToCapabilities('sensor', { state: 'Ready', attributes: {} })[0]?.kind).toBe(
      'string',
    );
    expect(
      mapDomainToCapabilities('sensor', {
        state: 'unknown',
        attributes: { device_class: 'date' },
      })[0]?.kind,
    ).toBe('string');
  });

  it('keeps the scale endpoint and unit when its availability changes', () => {
    const projection = new HacsVirtualizer();
    const entity = {
      entityId: 'sensor.scale_weight',
      uniqueId: 'scale_weight',
      domain: 'sensor',
      name: 'Weight',
      deviceId: 'scale',
      integration: 'eufylife_ble',
      attributes: weight,
    };
    for (const state of ['unavailable', '73.4', 'unknown']) {
      projection.handleEntityAdded({ ...entity, state });
      const devices = projection.getDevices();
      expect(devices).toHaveLength(1);
      expect(devices[0]?.endpoints).toHaveLength(1);
      expect(devices[0]?.endpoints[0]?.id).toBe(entity.entityId);
      expect(devices[0]?.endpoints[0]?.capabilities[0]).toMatchObject({
        kind: 'numeric',
        unit: 'kg',
      });
    }
  });
});
