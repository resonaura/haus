/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it, vi } from 'vitest';
import mqtt from 'mqtt';
import { HausMqttBroker, type RetainedPacket } from '../src/index.js';

it('does not acknowledge a retained QoS 1 publish until the injected store commits', async () => {
  let commit = () => {};
  const saved: RetainedPacket[] = [];
  const broker = new HausMqttBroker({
    host: '127.0.0.1',
    port: 0,
    retainedStore: {
      load: async () => [],
      save: async (packet) => {
        saved.push(packet);
        await new Promise<void>((resolve) => {
          commit = resolve;
        });
      },
    },
  });
  const { port } = await broker.listen();
  const client = await mqtt.connectAsync(`mqtt://127.0.0.1:${port}`, { reconnectPeriod: 0 });
  let acknowledged = false;
  try {
    const pending = client
      .publishAsync('fixture/retained', 'ON', { qos: 1, retain: true })
      .then(() => {
        acknowledged = true;
      });
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(acknowledged).toBe(false);
    commit();
    await pending;
    expect(acknowledged).toBe(true);
    expect(Buffer.from(saved[0]?.payload ?? []).toString()).toBe('ON');
  } finally {
    commit();
    await client.endAsync(true);
    await broker.close();
  }
});

it('shares asynchronous initialization and rejects invalid or uncommitted internal packets', async () => {
  const load = vi.fn(async () => []);
  const save = vi.fn(async () => {
    throw Error('private_failure');
  });
  const broker = new HausMqttBroker({ host: '127.0.0.1', port: 0, retainedStore: { load, save } });
  const delivered: string[] = [];
  broker.subscribe('fixture/#', (message) => {
    delivered.push(message.payload);
  });
  try {
    await Promise.all([
      broker.publish({ topic: 'fixture/a', payload: 'a' }),
      broker.publish({ topic: 'fixture/b', payload: 'b' }),
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    await expect(
      broker.publish({ topic: 'fixture/invalid/#', payload: 'unsafe', retain: true }),
    ).rejects.toThrow('mqtt_invalid_publish_topic');
    expect(save).not.toHaveBeenCalled();
    await expect(
      broker.publish({ topic: 'fixture/write', payload: 'uncommitted', retain: true }),
    ).rejects.toThrow('mqtt_retained_write_failed');
    await vi.waitFor(() => expect(delivered).toHaveLength(2));
    expect(delivered).not.toContain('uncommitted');
  } finally {
    await broker.close();
  }
});
