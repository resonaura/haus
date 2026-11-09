/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Logger } from '@nestjs/common';
import { afterEach, expect, it, vi } from 'vitest';
import { mqttFixture } from './fixture.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

it('routes HA fan power and percentage updates from independent topics', async () => {
  const fixture = await mqttFixture();
  cleanups.push(() => fixture.close());

  await fixture.publish('homeassistant/fan/desk/config', {
    '~': 'desk/fan',
    p: 'fan',
    uniq_id: 'desk_fan',
    stat_t: '~/power',
    stat_val_tpl: '{{ value_json.enabled }}',
    pct_stat_t: '~/speed',
    pct_val_tpl: '{{ value_json.speed }}',
    spd_rng_min: 10,
    spd_rng_max: 14,
    dev: { ids: ['desk-fan'], name: 'Desk Fan' },
  });

  await fixture.publish('desk/fan/power', '{"enabled":"ON"}');
  await fixture.publish('desk/fan/speed', '{"speed":12}');
  await fixture.service.drain();

  expect(fixture.home.getEndpointState('ep_mqtt_desk_fan')).toMatchObject({
    state: 'on',
    on_off: true,
    percentage: 60,
    fan_speed: 60,
  });

  await fixture.publish('homeassistant/fan/desk/config', {
    '~': 'desk/fan',
    p: 'fan',
    uniq_id: 'desk_fan',
    stat_t: '~/power',
    stat_val_tpl: '{{ value_json.enabled }}',
    pct_stat_t: '~/replacement-speed',
    pct_val_tpl: '{{ value_json.speed }}',
    spd_rng_min: 10,
    spd_rng_max: 14,
    dev: { ids: ['desk-fan'], name: 'Desk Fan' },
  });
  await fixture.publish('desk/fan/replacement-speed', '{"speed":13}');
  await fixture.service.drain();
  expect(fixture.home.getEndpointState('ep_mqtt_desk_fan').percentage).toBe(80);

  await fixture.publish('desk/fan/speed', '{"speed":14}');
  await fixture.service.drain();
  expect(fixture.home.getEndpointState('ep_mqtt_desk_fan').percentage).toBe(80);

  await fixture.publish('desk/fan/replacement-speed', '{"speed":"invalid"}');
  await fixture.service.drain();
  expect(fixture.home.getEndpointState('ep_mqtt_desk_fan').percentage).toBe(80);
});

it('merges power and percentage from one bundled HA fan topic', async () => {
  const fixture = await mqttFixture();
  cleanups.push(() => fixture.close());

  await fixture.publish('homeassistant/device/bathroom/config', {
    dev: { ids: ['bathroom-fan'], name: 'Bathroom Fan' },
    components: {
      fan: {
        p: 'fan',
        uniq_id: 'bathroom_fan',
        stat_t: 'bathroom/fan/state',
        stat_val_tpl: '{{ value_json.enabled }}',
        pct_stat_t: 'bathroom/fan/state',
        pct_val_tpl: '{{ value_json.speed }}',
        spd_rng_min: 1,
        spd_rng_max: 4,
      },
    },
  });

  await fixture.publish('bathroom/fan/state', '{"enabled":true,"speed":3}');
  await fixture.service.drain();

  expect(fixture.home.getEndpointState('ep_bathroom_fan')).toMatchObject({
    state: 'on',
    on_off: true,
    percentage: 75,
    fan_speed: 75,
  });
});

it('warns once and keeps the last valid fan percentage for unsupported templates', async () => {
  const warning = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  const fixture = await mqttFixture();
  cleanups.push(() => fixture.close());

  await fixture.publish('homeassistant/fan/desk/config', {
    '~': 'desk/fan',
    p: 'fan',
    uniq_id: 'desk_fan',
    pct_stat_t: '~/speed',
    pct_val_tpl: '{{ value_json.speed }}',
    dev: { ids: ['desk-fan'], name: 'Desk Fan' },
  });
  await fixture.publish('desk/fan/speed', '{"speed":45}');
  await fixture.service.drain();

  await fixture.publish('homeassistant/fan/desk/config', {
    '~': 'desk/fan',
    p: 'fan',
    uniq_id: 'desk_fan',
    pct_stat_t: '~/speed',
    pct_val_tpl: '{{ value_json.speed | lower }}',
    dev: { ids: ['desk-fan'], name: 'Desk Fan' },
  });
  await fixture.publish('desk/fan/speed', '{"speed":60}');
  await fixture.publish('desk/fan/speed', '{"speed":70}');
  await fixture.service.drain();

  expect(fixture.home.getEndpointState('ep_mqtt_desk_fan').percentage).toBe(45);
  expect(warning.mock.calls.map(([message]) => message)).toContain(
    'mqtt_fan_state_template_unsupported',
  );
  expect(
    warning.mock.calls.filter(([message]) => message === 'mqtt_fan_state_template_unsupported'),
  ).toHaveLength(1);
});
