/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import type { HausDevice } from '@haus/core';
import { onOffCapability } from '@haus/core/device';
import { suggestBridges } from '../../src/homekit/suggestions.js';

function fixture(id: string, instanceId: string, category: HausDevice['category'] = 'lighting'): HausDevice {
  return {
    id,
    name: id,
    category,
    source: { instanceId, externalId: id },
    connectivity: { protocol: 'virtual' },
    availability: 'online',
    endpoints: [{ id: 'power', name: 'Power', capabilities: [onOffCapability], readings: {} }],
  };
}

it('recommends groups across related integrations and leaves cameras out', () => {
  const xiaomi = fixture('Xiaomi Bulb', 'xiaomi_miot');
  const yeelight = fixture('Yeelight Bulb', 'yeelight');
  const goveeLan = fixture('Govee LAN', 'govee');
  const goveeHomebridge = fixture('Govee Homebridge', 'homebridge:govee');
  const camera = fixture('Xiaomi Camera', 'homebridge:xiaomi', 'cameras');
  expect(suggestBridges([xiaomi, yeelight, goveeLan, goveeHomebridge, camera])).toEqual([
    { name: 'Govee', devices: [{ id: goveeHomebridge.id, name: goveeHomebridge.name }, { id: goveeLan.id, name: goveeLan.name }] },
    { name: 'Xiaomi & Yeelight', devices: [{ id: xiaomi.id, name: xiaomi.name }, { id: yeelight.id, name: yeelight.name }] },
  ]);
});
