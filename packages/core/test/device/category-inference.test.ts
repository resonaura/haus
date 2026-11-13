/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import { inferDeviceCategory, type HausEndpoint } from '../../src/device/index.js';

function outletEndpoint(name: string, category: HausEndpoint['category'] = 'power'): HausEndpoint {
  return {
    id: `ep_${name.toLowerCase().replace(/\s+/g, '_')}`,
    name,
    category,
    capabilities: [
      { id: 'on_off', kind: 'binary', readable: true, operations: ['set', 'turn_on', 'turn_off'] },
    ],
    readings: {},
  };
}

describe('inferDeviceCategory smart outlet classification', () => {
  it('classifies Govee H5080 and H5083 outlets as power even when named Strip, Garland, or Lamp', () => {
    expect(
      inferDeviceCategory({
        id: 'gv2mqtt-A1B2C3D4E5F6',
        name: 'Living Room Light Strip',
        model: 'H5080',
        endpoints: [outletEndpoint('Living Room Light Strip')],
      }),
    ).toBe('power');

    expect(
      inferDeviceCategory({
        id: 'gv2mqtt-F6E5D4C3B2A1',
        name: 'Balcony Garland',
        model: 'H5083',
        endpoints: [outletEndpoint('Balcony Garland', undefined)],
      }),
    ).toBe('power');

    expect(
      inferDeviceCategory({
        id: 'hb_outlet_1',
        name: 'Office Desk Lamp',
        model: 'H5080',
        endpoints: [outletEndpoint('Office Desk Lamp', 'power')],
      }),
    ).toBe('power');

    expect(
      inferDeviceCategory({
        id: 'gv2mqtt-A1B2C3D4E5F7',
        name: 'Balcony Garland',
        model: 'H5083',
        endpoints: [outletEndpoint('Balcony Garland', 'lighting')],
      }),
    ).toBe('power');
  });

  it('keeps actual lights with lighting endpoint or brightness/color as lighting', () => {
    expect(
      inferDeviceCategory({
        id: 'gv2mqtt-112233445566',
        name: 'Bedroom Strip Light',
        model: 'H615D',
        endpoints: [
          {
            id: 'ep_strip',
            name: 'Bedroom Strip Light',
            category: 'lighting',
            capabilities: [
              { id: 'on_off', kind: 'binary', readable: true, operations: ['set'] },
              { id: 'brightness', kind: 'numeric', readable: true, operations: ['set'] },
            ],
            readings: {},
          },
        ],
      }),
    ).toBe('lighting');

    expect(
      inferDeviceCategory({
        id: 'gv2mqtt-665544332211',
        name: 'Hallway Ceiling Bulb',
        model: 'H6006',
        endpoints: [
          {
            id: 'ep_bulb',
            name: 'Hallway Ceiling Bulb',
            category: 'lighting',
            capabilities: [
              { id: 'on_off', kind: 'binary', readable: true, operations: ['set'] },
              { id: 'brightness', kind: 'numeric', readable: true, operations: ['set'] },
            ],
            readings: {},
          },
        ],
      }),
    ).toBe('lighting');
  });
});
