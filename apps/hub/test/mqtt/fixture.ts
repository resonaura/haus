/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { HausMqttClient } from '@haus/mqtt';
import { StandaloneHomeService } from '../../src/home/home.service.js';
import { MqttService } from '../../src/mqtt/service.js';
import { CatalogLifetime } from '../../src/storage/lifetime.js';
import { openCatalog, Transactions } from '../../src/storage/index.js';

export async function mqttFixture(database?: string) {
  const source = database ? await openCatalog(database) : undefined;
  const tx = source ? new Transactions(source) : undefined;
  const lifetime = source && tx ? new CatalogLifetime(source, tx) : undefined;
  const home = new StandaloneHomeService(undefined, tx);
  await home.onModuleInit();
  const service = new MqttService(
    home,
    { host: '127.0.0.1', port: 0, allowAnonymous: true },
    tx,
    lifetime,
  );
  await service.onApplicationBootstrap();
  const client = new HausMqttClient({
    host: '127.0.0.1',
    port: service.broker.port,
    allowAnonymous: true,
  });
  await client.connect({ reconnectPeriod: 0 });
  let closed = false;
  return {
    home,
    service,
    client,
    tx,
    publish: (topic: string, payload: string | object) =>
      client.publish({
        topic,
        payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
        qos: 1,
        retain: true,
      }),
    async close() {
      if (closed) return;
      closed = true;
      await client.close();
      if (lifetime) await lifetime.close();
      else await service.onApplicationShutdown();
    },
  };
}
