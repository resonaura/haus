/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, expect, it, vi } from 'vitest';
import { mqttFixture } from './fixture.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

it('publishes number, select, and button actions through the Hub MQTT command path', async () => {
  const fixture = await mqttFixture();
  cleanups.push(() => fixture.close());
  await fixture.publish('homeassistant/device/controls/config', {
    dev: { ids: ['controls-device'], name: 'Controls device' },
    cmps: {
      threshold: {
        p: 'number',
        uniq_id: 'controls-threshold',
        cmd_t: 'fixture/threshold/set',
        min: -5,
        max: 5,
        step: 0.25,
      },
      mode: {
        p: 'select',
        uniq_id: 'controls-mode',
        cmd_t: 'fixture/mode/set',
        ops: ['day', 'night'],
      },
      reset: {
        p: 'button',
        uniq_id: 'controls-reset',
        cmd_t: 'fixture/reset/set',
        pl_prs: 'TRIGGER',
      },
    },
  });
  await vi.waitFor(() => expect(fixture.home.listDevices()[0]?.endpoints).toHaveLength(3));
  const endpoints = fixture.home.listDevices()[0]?.endpoints ?? [];
  const endpointId = (capabilityId: string): string => {
    const endpoint = endpoints.find((item) =>
      item.capabilities.some((capability) => capability.id === capabilityId),
    );
    if (!endpoint) throw Error(`missing_${capabilityId}_endpoint`);
    return endpoint.id;
  };

  const received: Record<string, string[]> = { threshold: [], mode: [], reset: [] };
  await fixture.client.subscribe('fixture/+/set', (message) => {
    const key = message.topic.split('/')[1];
    if (key && key in received) received[key]?.push(message.payload);
  });

  await fixture.home.executeDeviceCommand(
    endpointId('number'),
    'number',
    'set',
    { value: 1.25 },
  );
  await fixture.home.executeDeviceCommand(endpointId('select'), 'select', 'set', {
    value: 'night',
  });
  await fixture.home.executeDeviceCommand(endpointId('press'), 'press', 'press');

  await vi.waitFor(() => expect(received).toEqual({ threshold: ['1.25'], mode: ['night'], reset: ['TRIGGER'] }));
});
