/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { mqttFixture } from './fixture.js';

interface GoveeFixture {
  readonly source: {
    readonly repository: string;
    readonly revision: string;
    readonly files: readonly string[];
  };
  readonly discoveries: readonly {
    readonly topic: string;
    readonly payload: Record<string, unknown>;
  }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFixture(value: unknown): GoveeFixture {
  if (!isRecord(value) || !isRecord(value.source) || !Array.isArray(value.discoveries)) {
    throw new Error('invalid_govee_fixture');
  }

  const { source } = value;
  if (
    typeof source.repository !== 'string' ||
    typeof source.revision !== 'string' ||
    !Array.isArray(source.files)
  ) {
    throw new Error('invalid_govee_fixture_source');
  }
  const rawFiles: unknown[] = source.files;
  const files = rawFiles.filter((file): file is string => typeof file === 'string');
  if (files.length !== rawFiles.length) throw new Error('invalid_govee_fixture_files');

  const rawDiscoveries: unknown[] = value.discoveries;
  const discoveries = rawDiscoveries.map((discovery: unknown) => {
    if (
      !isRecord(discovery) ||
      typeof discovery.topic !== 'string' ||
      !isRecord(discovery.payload)
    ) {
      throw new Error('invalid_govee_discovery');
    }
    return { topic: discovery.topic, payload: discovery.payload };
  });

  return {
    source: {
      repository: source.repository,
      revision: source.revision,
      files,
    },
    discoveries,
  };
}

const decodedFixture: unknown = JSON.parse(
  readFileSync(new URL('./fixtures/govee.json', import.meta.url), 'utf8'),
);
const govee = parseFixture(decodedFixture);

it('imports the pinned Govee JSON-light profile and routes scaled segment commands on loopback', async () => {
  expect(govee.source.revision).toBe('6f5a8449ca63da8bdc7cc696288a993681ff2a69');
  const fixture = await mqttFixture();
  const commands: { topic: string; payload: string }[] = [];
  try {
    await fixture.client.subscribe('gv2mqtt/light/fixture-govee/command/#', (message) => {
      commands.push({ topic: message.topic, payload: message.payload });
    });

    for (const discovery of govee.discoveries) {
      await fixture.publish(discovery.topic, discovery.payload);
    }
    await fixture.publish('gv2mqtt/availability', 'online');
    await fixture.publish('gv2mqtt/light/fixture-govee/state', {
      state: 'ON',
      brightness: 40,
      color_mode: 'rgb',
      color: { r: 12, g: 80, b: 190 },
    });
    await fixture.service.drain();

    const deviceId = 'mqtt_gv2mqtt-fixture-govee';
    await vi.waitFor(() => {
      const device = fixture.home.getDevice(deviceId);
      expect(device?.name).toBe('Fixture Govee RGB Strip');
      expect(device?.manufacturer).toBe('Govee');
      expect(device?.endpoints).toHaveLength(3);
      expect(device?.availability).toBe('online');
      expect(
        fixture.home.getEndpointState('ep_mqtt_gv2mqtt-fixture-govee').brightness,
      ).toBe(102);
      expect(fixture.home.getEndpointState('ep_mqtt_gv2mqtt-fixture-govee').color).toEqual({
        r: 12,
        g: 80,
        b: 190,
      });
    });

    const device = fixture.home.getDevice(deviceId);
    const segment = device?.endpoints.find((endpoint) => endpoint.name.endsWith('Segment 001'));
    expect(segment).toBeDefined();

    await fixture.home.executeDeviceCommand(segment?.id ?? '', 'brightness', 'set', { value: 128 });
    await fixture.home.executeDeviceCommand(segment?.id ?? '', 'color', 'set', {
      value: { r: 25, g: 50, b: 200 },
    });

    await vi.waitFor(() => expect(commands).toHaveLength(2));
    expect(commands).toEqual([
      {
        topic: 'gv2mqtt/light/fixture-govee/command/0',
        payload: JSON.stringify({ state: 'ON', brightness: 50 }),
      },
      {
        topic: 'gv2mqtt/light/fixture-govee/command/0',
        payload: JSON.stringify({ state: 'ON', color: { r: 25, g: 50, b: 200 } }),
      },
    ]);
  } finally {
    await fixture.close();
  }
});
