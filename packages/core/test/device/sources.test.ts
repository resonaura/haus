/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { endpointToServices, servicesToEndpoints } from '../../src/device/mapper.js';
import type { HausEndpoint } from '../../src/device/types.js';

it('keeps exact provider and MQTT references across endpoint/service conversion', () => {
  const endpoint: HausEndpoint = {
    id: 'endpoint',
    name: 'Status light',
    mediaId: 'camera.preserved',
    sourceOwner: { protocol: 'vendor', externalId: 'bridge:physical:status', domain: 'switch' },
    capabilities: [],
    readings: {},
    sourceRefs: [
      { protocol: 'mqtt', externalId: 'physical_status', domain: 'switch' },
      { protocol: 'vendor', externalId: 'bridge:physical:status', domain: 'switch' },
    ],
  };
  const services = endpointToServices(endpoint);
  expect(services[0]?.sourceRefs).toEqual(endpoint.sourceRefs);
  expect(servicesToEndpoints('device', services)[0]?.sourceRefs).toEqual(endpoint.sourceRefs);
  expect(servicesToEndpoints('device', services)[0]?.sourceOwner).toEqual(endpoint.sourceOwner);
  expect(servicesToEndpoints('device', services)[0]?.mediaId).toBe(endpoint.mediaId);
});
