/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { mqttFixture } from './fixture.js';

interface ProducerPacket {
  readonly topic: string;
  readonly payload: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadPackets(): readonly ProducerPacket[] {
  const raw: unknown = JSON.parse(
    readFileSync(new URL('./fixtures/aqara-controls.json', import.meta.url), 'utf8'),
  );
  if (!isRecord(raw) || !Array.isArray(raw.messages)) throw Error('invalid_aqara_controls_fixture');
  return raw.messages.map((item): ProducerPacket => {
    if (!isRecord(item) || typeof item.topic !== 'string' || typeof item.payload !== 'string')
      throw Error('invalid_aqara_controls_packet');
    return { topic: item.topic, payload: item.payload };
  });
}

it('imports Aqara G5 Pro controls and routes writes without splitting the camera device', async () => {
  const fixture = await mqttFixture();
  try {
    for (const packet of loadPackets()) await fixture.publish(packet.topic, packet.payload);
    await fixture.publish('homeassistant/light/fixture-aqara-g5/spotlight/state', {
      state: 'ON',
      brightness: 128,
    });
    await fixture.publish('homeassistant/sensor/fixture-aqara-g5/sdcard_total/state', '8192');
    await fixture.publish('homeassistant/sensor/fixture-aqara-g5/sdcard_free/state', '4096');
    await fixture.publish('homeassistant/sensor/fixture-aqara-g5/sdcard_status/state', 'Ready');
    await fixture.publish('homeassistant/sensor/fixture-aqara-g5/sdcard_percent/state', '50');
    await fixture.publish('homeassistant/binary_sensor/fixture-aqara-g5/motion/state', 'OFF');
    await fixture.publish('homeassistant/switch/fixture-aqara-g5/p2p_stream/state', 'OFF');
    await fixture.publish(
      'homeassistant/sensor/fixture-aqara-g5/talkback_rtmp/state',
      'rtmp://127.0.0.1:1935/talk/fixture-aqara-g5',
    );
    await fixture.service.drain();

    const devices = fixture.home
      .listDevices()
      .filter((device) => device.source.externalId === 'fixture-aqara-g5');
    expect(devices).toHaveLength(1);
    const camera = devices[0];
    if (!camera) throw Error('missing_aqara_camera');
    expect(camera).toMatchObject({ manufacturer: 'Aqara', model: 'Camera G5 Pro' });

    const endpoint = (name: string) => camera.endpoints.find((item) => item.name.endsWith(name));
    const spotlight = camera.endpoints.find((item) =>
      item.capabilities.some((capability) => capability.id === 'brightness'),
    );
    const motion = camera.endpoints.find((item) =>
      item.capabilities.some((capability) => capability.id === 'motion'),
    );
    const ptz = camera.endpoints.filter((item) =>
      item.capabilities.some((capability) => capability.id === 'press'),
    );
    const ptzLeft = endpoint('PTZ Left');
    const p2p = endpoint('P2P Stream');
    const snapshot = endpoint('Live Snapshot URL');
    expect(endpoint('Fixture Aqara G5 Pro Camera')?.category).toBe('cameras');
    expect(camera.endpoints).toHaveLength(15);
    expect(spotlight?.capabilities.map((capability) => capability.id)).toEqual(
      expect.arrayContaining(['on_off', 'brightness']),
    );
    expect(camera.endpoints.filter((item) => item.name.includes('SD Card'))).toHaveLength(4);
    expect(motion).toBeDefined();
    expect(ptz).toHaveLength(5);
    expect(p2p?.capabilities.some((capability) => capability.id === 'on_off')).toBe(true);
    expect(endpoint('Talkback RTMP Stream')?.capabilities[0]?.operations).toEqual([]);
    expect(snapshot).toBeDefined();
    expect(fixture.home.getEndpointState(spotlight?.id ?? '').brightness).toBe(128);
    expect(fixture.home.getEndpointState(motion?.id ?? '').motion).toBe(false);
    expect(fixture.home.getEndpointState(p2p?.id ?? '').on_off).toBe(false);
    expect(fixture.home.getEndpointState(snapshot?.id ?? '').attributes).toEqual({
      haus_snapshot_profile: 1,
      haus_snapshot_provider: 'aqara',
      haus_snapshot_url:
        'http://127.0.0.1:8580/api/cameras/fixture-aqara-g5/snapshot/last-live',
    });
    for (const [name, value] of [
      ['SD Card Total', 8192],
      ['SD Card Free', 4096],
      ['SD Card Status', 'Ready'],
      ['SD Card Used', 50],
    ] as const) {
      const sensor = endpoint(name);
      expect(sensor).toBeDefined();
      expect(fixture.home.getEndpointState(sensor?.id ?? '').value).toBe(value);
    }

    const commands: string[] = [];
    await fixture.client.subscribe('homeassistant/+/fixture-aqara-g5/+/set', (message) => {
      commands.push(`${message.topic}=${message.payload}`);
    });
    if (!spotlight || !ptzLeft || !p2p) throw Error('missing_aqara_control_endpoint');
    await fixture.home.executeDeviceCommand(spotlight.id, 'on_off', 'turn_on', { brightness: 128 });
    await fixture.home.executeDeviceCommand(ptzLeft.id, 'press', 'press');
    await fixture.home.executeDeviceCommand(p2p.id, 'on_off', 'turn_on');

    await vi.waitFor(() =>
      expect(commands).toEqual([
        'homeassistant/light/fixture-aqara-g5/spotlight/set={"state":"ON","brightness":128}',
        'homeassistant/button/fixture-aqara-g5/ptz_left/set=PRESS',
        'homeassistant/switch/fixture-aqara-g5/p2p_stream/set=ON',
      ]),
    );
    expect(fixture.home.getEndpointState(spotlight.id).brightness).toBe(128);
  } finally {
    await fixture.close();
  }
});
