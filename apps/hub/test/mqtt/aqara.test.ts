/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
    readFileSync(new URL('./fixtures/aqara.json', import.meta.url), 'utf8'),
  );
  if (!isRecord(raw) || !Array.isArray(raw.messages)) throw Error('invalid_aqara_fixture');
  return raw.messages.map((item): ProducerPacket => {
    if (!isRecord(item) || typeof item.topic !== 'string' || typeof item.payload !== 'string')
      throw Error('invalid_aqara_fixture_packet');
    return { topic: item.topic, payload: item.payload };
  });
}

const packets = loadPackets();

describe('unchanged Aqara camera MQTT producer', () => {
  it('imports two cameras, motion entities, and snapshot metadata through loopback MQTT', async () => {
    const fixture = await mqttFixture();
    try {
      for (const packet of packets) await fixture.publish(packet.topic, packet.payload);
      await fixture.publish('homeassistant/binary_sensor/fixture-aqara/motion/state', 'OFF');
      await fixture.publish('homeassistant/binary_sensor/fixture-aqara-2/motion/state', 'OFF');
      await fixture.service.drain();

      const cameras = fixture.home
        .listDevices()
        .filter((device) => device.source.externalId.startsWith('fixture-aqara'));
      expect(cameras).toHaveLength(2);
      expect(cameras.map((device) => device.source.externalId).sort()).toEqual([
        'fixture-aqara',
        'fixture-aqara-2',
      ]);

      for (const camera of cameras) {
        const expectedModel =
          camera.source.externalId === 'fixture-aqara' ? 'Camera G2H Pro' : 'Camera E1';
        expect(camera).toMatchObject({
          category: 'cameras',
          manufacturer: 'Aqara',
          model: expectedModel,
        });

        const video = camera.endpoints.find((endpoint) =>
          endpoint.capabilities.some((capability) => capability.id === 'video'),
        );
        const motion = camera.endpoints.find((endpoint) =>
          endpoint.capabilities.some((capability) => capability.id === 'motion'),
        );
        const snapshot = camera.endpoints.find((endpoint) =>
          endpoint.name.endsWith('Live Snapshot URL'),
        );

        expect(video?.category).toBe('cameras');
        expect(motion?.category).toBe('security');
        if (!motion || !snapshot) throw Error('aqara_camera_endpoint_missing');
        expect(fixture.home.getEndpointState(motion.id)).toMatchObject({
          state: 'off',
          on_off: false,
          motion: false,
        });
        expect(fixture.home.getEndpointState(snapshot.id).attributes).toEqual({
          haus_snapshot_profile: 1,
          haus_snapshot_provider: 'aqara',
          haus_snapshot_url: `http://127.0.0.1:8580/api/cameras/${camera.source.externalId}/snapshot/last-live`,
        });
      }

      const motionIds = cameras.map(
        (camera) =>
          camera.endpoints.find((endpoint) =>
            endpoint.capabilities.some((capability) => capability.id === 'motion'),
          )?.id,
      );
      expect(new Set(motionIds).size).toBe(2);
    } finally {
      await fixture.close();
    }
  });
});
