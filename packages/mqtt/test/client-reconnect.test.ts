/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it, vi } from 'vitest';
import { HausMqttBroker, HausMqttClient, type RetainedPacket } from '../src/index.js';

it('reconnects to a restarted broker, restores the subscription, and receives retained state', async () => {
  const retained = new Map<string, RetainedPacket>();
  const retainedStore = {
    load: async () => [...retained.values()],
    save: async (packet: RetainedPacket) => {
      if (packet.payload.byteLength === 0) retained.delete(packet.topic);
      else retained.set(packet.topic, packet);
    },
  };
  let broker = new HausMqttBroker({ host: '127.0.0.1', port: 0, retainedStore });
  const { port } = await broker.listen();
  const client = new HausMqttClient({ host: '127.0.0.1', port, allowAnonymous: true });
  const received: { payload: string; retained: boolean }[] = [];

  try {
    await client.connect({ reconnectPeriod: 25, connectTimeout: 500 });
    await client.subscribe('fixture/#', (message) => {
      received.push({ payload: message.payload, retained: message.retained });
    });
    await client.publish({ topic: 'fixture/state', payload: 'ON', qos: 1, retain: true });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual({ payload: 'ON', retained: false });

    await broker.close();
    await vi.waitFor(() => expect(client.connected).toBe(false));

    broker = new HausMqttBroker({ host: '127.0.0.1', port, retainedStore });
    await broker.listen();
    await vi.waitFor(() => expect(client.connected).toBe(true));
    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received[1]).toEqual({ payload: 'ON', retained: true });
  } finally {
    await client.close();
    await broker.close();
  }
});
