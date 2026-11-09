/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import {
  DiscoveryTopics,
  mergeDiscoverySnapshot,
  discoveryClaims,
  parseDiscoveryClaims,
  type RetainedPacket,
  type RetainedStore,
} from '@haus/mqtt';
import { MqttRetainedEntity } from './entities.js';
import type { Transactions } from '../transactions.js';

export class OrmMqttRetention implements RetainedStore {
  constructor(
    private readonly transactions: Transactions,
    private readonly topics = new DiscoveryTopics(),
  ) {}

  load(): Promise<readonly RetainedPacket[]> {
    return this.transactions.read(async (manager) => {
      const rows = await manager.find(MqttRetainedEntity, { order: { revision: 'ASC' } });
      return rows.map((row) => ({
        topic: row.topic,
        payload: row.payload,
        qos: row.qos,
        replayPayload: row.discovery === null ? undefined : Buffer.from(row.discovery),
        replayOrder: row.discoveryRevision ?? row.revision,
        discoveryClaims: parseDiscoveryClaims(row.discoveryClaims),
      }));
    });
  }

  save(packet: RetainedPacket): Promise<void> {
    return this.transactions.run(async (manager) => {
      const last = await manager.findOne(MqttRetainedEntity, {
        where: {},
        order: { revision: 'DESC' },
      });
      const previous = await manager.findOneBy(MqttRetainedEntity, { topic: packet.topic });
      const discovery = this.topics.parse(packet.topic);
      const revision = (last?.revision ?? 0) + 1;
      const snapshot = discovery
        ? mergeDiscoverySnapshot(
            discovery.component,
            previous?.discovery ?? undefined,
            Buffer.from(packet.payload).toString('utf8'),
          )
        : undefined;
      const encodedClaims =
        !discovery || snapshot === undefined
          ? (previous?.discoveryClaims ?? '[]')
          : JSON.stringify(snapshot ? discoveryClaims(discovery, snapshot) : []);
      await manager.upsert(
        MqttRetainedEntity,
        {
          topic: packet.topic,
          payload: Buffer.from(packet.payload),
          qos: packet.qos,
          revision,
          discovery: snapshot ?? previous?.discovery ?? null,
          discoveryRevision:
            snapshot === undefined ? (previous?.discoveryRevision ?? null) : revision,
          discoveryClaims: JSON.stringify(parseDiscoveryClaims(encodedClaims)),
        },
        ['topic'],
      );
    });
  }
}
