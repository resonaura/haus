/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import {
  DiscoveryTopics,
  mergeDiscoverySnapshot,
  discoveryClaims,
  isHausDiscoveryTopic,
  parseDiscoveryClaims,
  type MqttDiscoveryClaim,
  type RetainedPacket,
  type RetainedStore,
} from '@haus/mqtt';
import { MqttRetainedEntity } from './entities.js';
import { StandaloneHomeEntryEntity } from '../standalone/entities.js';
import type { Transactions } from '../transactions.js';

const MQTT_DISCOVERY_TOMBSTONE_KIND = 'mqtt_discovery_tombstone';

function safeParseClaims(raw: string): readonly MqttDiscoveryClaim[] {
  try {
    return parseDiscoveryClaims(raw);
  } catch {
    return [];
  }
}

/** Computes identities explicitly removed or replaced on a single discovery topic. */
export function computeNextTombstonedClaims(
  previousTombstones: readonly MqttDiscoveryClaim[],
  previousActiveClaims: readonly MqttDiscoveryClaim[],
  nextActiveClaims: readonly MqttDiscoveryClaim[],
): MqttDiscoveryClaim[] {
  const activeKeys = new Set(nextActiveClaims.map((claim) => JSON.stringify(claim)));
  const merged = new Map<string, MqttDiscoveryClaim>();
  for (const claim of [...previousTombstones, ...previousActiveClaims]) {
    const key = JSON.stringify(claim);
    if (!activeKeys.has(key)) merged.set(key, claim);
  }
  return [...merged.values()];
}

export class OrmMqttRetention implements RetainedStore {
  constructor(
    private readonly transactions: Transactions,
    private readonly topics = new DiscoveryTopics(),
    private readonly ownedNodeId?: string,
  ) {}

  load(): Promise<readonly RetainedPacket[]> {
    return this.transactions.read(async (manager) => {
      const [rows, tombstoneRows] = await Promise.all([
        manager.find(MqttRetainedEntity, { order: { revision: 'ASC' } }),
        manager.find(StandaloneHomeEntryEntity, {
          where: { kind: MQTT_DISCOVERY_TOMBSTONE_KIND },
        }),
      ]);
      const tombstonesByTopic = new Map<string, readonly MqttDiscoveryClaim[]>();
      for (const row of tombstoneRows) {
        const claims = safeParseClaims(row.value);
        if (claims.length > 0) tombstonesByTopic.set(row.entryId, claims);
      }
      return rows.map((row) => {
        const tombstonedClaims = tombstonesByTopic.get(row.topic);
        return {
          topic: row.topic,
          payload: row.payload,
          qos: row.qos,
          replayPayload: row.discovery === null ? undefined : Buffer.from(row.discovery),
          replayOrder: row.discoveryRevision ?? row.revision,
          discoveryClaims: parseDiscoveryClaims(row.discoveryClaims),
          ...(tombstonedClaims ? { tombstonedClaims } : {}),
        };
      });
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
      const isOwnedDiscovery =
        this.ownedNodeId !== undefined && isHausDiscoveryTopic(discovery, this.ownedNodeId);
      const revision = (last?.revision ?? 0) + 1;
      const snapshot = discovery
        ? mergeDiscoverySnapshot(
            discovery.component,
            previous?.discovery ?? undefined,
            Buffer.from(packet.payload).toString('utf8'),
          )
        : undefined;
      const previousClaims = parseDiscoveryClaims(previous?.discoveryClaims ?? '[]');
      const encodedClaims = isOwnedDiscovery
        ? '[]'
        : !discovery || snapshot === undefined
          ? (previous?.discoveryClaims ?? '[]')
          : JSON.stringify(snapshot ? discoveryClaims(discovery, snapshot) : []);
      const validatedClaims = parseDiscoveryClaims(encodedClaims);
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
          discoveryClaims: JSON.stringify(validatedClaims),
        },
        ['topic'],
      );
      if (discovery && !isOwnedDiscovery && snapshot !== undefined) {
        const prevTombstoneRow = await manager.findOneBy(StandaloneHomeEntryEntity, {
          kind: MQTT_DISCOVERY_TOMBSTONE_KIND,
          entryId: packet.topic,
        });
        const prevTombstones = prevTombstoneRow ? safeParseClaims(prevTombstoneRow.value) : [];
        const nextTombstones = computeNextTombstonedClaims(
          prevTombstones,
          previousClaims,
          validatedClaims,
        );
        if (nextTombstones.length > 0) {
          await manager.upsert(
            StandaloneHomeEntryEntity,
            {
              kind: MQTT_DISCOVERY_TOMBSTONE_KIND,
              entryId: packet.topic,
              value: JSON.stringify(nextTombstones),
              updatedAt: Date.now(),
            },
            ['kind', 'entryId'],
          );
        } else if (prevTombstoneRow) {
          await manager.delete(StandaloneHomeEntryEntity, {
            kind: MQTT_DISCOVERY_TOMBSTONE_KIND,
            entryId: packet.topic,
          });
        }
      }
    });
  }
}
