/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { afterEach, expect, it } from 'vitest';
import { mqttFixture } from './fixture.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

it('routes bundled enum sensor states as strings without creating a select control', async () => {
  const fixture = await mqttFixture();
  cleanups.push(() => fixture.close());

  await fixture.publish('homeassistant/device/kettle/config', {
    dev: { ids: ['kettle'], name: 'Kettle' },
    cmps: {
      mode: {
        p: 'sensor',
        uniq_id: 'kettle_mode',
        stat_t: 'kettle/mode',
        dev_cla: 'enum',
        ops: ['off', 'heat', 'boil'],
      },
    },
  });
  await fixture.publish('kettle/mode', 'heat');
  await fixture.service.drain();

  expect(fixture.home.listDevices()).toHaveLength(1);
  const endpoint = fixture.home.listDevices()[0]?.endpoints[0];
  expect(endpoint?.id).toBe('ep_kettle_mode');
  expect(endpoint?.capabilities[0]).toMatchObject({
    kind: 'enum',
    deviceClass: 'enum',
    choices: ['off', 'heat', 'boil'],
    operations: [],
  });
  expect(fixture.home.getEndpointState('ep_kettle_mode')).toMatchObject({
    state: 'heat',
    value: 'heat',
    enum: 'heat',
  });

  await fixture.publish('kettle/mode', 'steam');
  await fixture.service.drain();
  expect(fixture.home.getEndpointState('ep_kettle_mode').state).toBe('heat');
});
