/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, expect, it, vi } from 'vitest';
import { HomeController } from '../../src/home/home.controller.js';
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
      templated: {
        p: 'switch',
        uniq_id: 'controls-templated',
        cmd_t: 'fixture/templated/set',
        cmd_tpl: '{{ value }}',
      },
    },
  });
  await vi.waitFor(() => expect(fixture.home.listDevices()[0]?.endpoints).toHaveLength(4));
  const endpoints = fixture.home.listDevices()[0]?.endpoints ?? [];
  const endpointId = (capabilityId: string): string => {
    const endpoint = endpoints.find((item) =>
      item.capabilities.some((capability) => capability.id === capabilityId),
    );
    if (!endpoint) throw Error(`missing_${capabilityId}_endpoint`);
    return endpoint.id;
  };

  const received: Record<string, string[]> = {
    threshold: [],
    mode: [],
    reset: [],
    templated: [],
  };
  await fixture.client.subscribe('fixture/+/set', (message) => {
    const key = message.topic.split('/')[1];
    if (key && key in received) received[key]?.push(message.payload);
  });

  const receipt = await fixture.home.executeDeviceCommand(
    endpointId('number'),
    'number',
    'set',
    { value: 1.25 },
  );
  await fixture.home.executeDeviceCommand(endpointId('select'), 'select', 'set', {
    value: 'night',
  });
  await fixture.home.executeDeviceCommand(endpointId('press'), 'press', 'press');

  await vi.waitFor(() =>
    expect(received).toEqual({
      threshold: ['1.25'],
      mode: ['night'],
      reset: ['TRIGGER'],
      templated: [],
    }),
  );
  expect(receipt).toMatchObject({ status: 'accepted', observed: false });
  expect(fixture.home.getEndpointState(endpointId('number'))).toEqual({});
  expect(fixture.home.getEndpointState(endpointId('select'))).toEqual({});
  expect(fixture.home.getEndpointState(endpointId('press'))).toEqual({});

  await expect(
    fixture.home.executeDeviceCommand(endpointId('number'), 'number', 'set', { value: 6 }),
  ).rejects.toThrow('mqtt_command_unsupported');
  const deviceId = fixture.home.listDevices()[0]?.id;
  if (!deviceId) throw Error('missing_controls_device');
  await expect(
    new HomeController(fixture.home).executeDeviceCommand(deviceId, {
      endpointId: endpointId('on_off'),
      capability: 'on_off',
      command: 'turn_on',
    }),
  ).rejects.toMatchObject({
    status: 400,
    response: { error: 'mqtt_command_template_unsupported' },
  });
  expect(received.templated).toEqual([]);
  expect(fixture.home.getEndpointState(endpointId('number'))).toEqual({});
  expect(fixture.home.getEndpointState(endpointId('on_off'))).toEqual({});
});

it('keeps reported MQTT state unchanged when the broker rejects a publish', async () => {
  const fixture = await mqttFixture();
  cleanups.push(() => fixture.close());
  await fixture.publish('homeassistant/number/threshold/config', {
    uniq_id: 'threshold',
    cmd_t: 'fixture/threshold/set',
    min: 0,
    max: 10,
  });
  await vi.waitFor(() => expect(fixture.home.listDevices()[0]?.endpoints).toHaveLength(1));
  const endpointId = fixture.home.listDevices()[0]?.endpoints[0]?.id;
  if (!endpointId) throw Error('missing_number_endpoint');
  const publish = vi.spyOn(fixture.service.broker, 'publish').mockRejectedValue(Error('broker_lost'));

  await expect(
    fixture.home.executeDeviceCommand(endpointId, 'number', 'set', { value: 4 }),
  ).rejects.toThrow('broker_lost');
  expect(publish).toHaveBeenCalledTimes(1);
  expect(fixture.home.getEndpointState(endpointId)).toEqual({});
});
