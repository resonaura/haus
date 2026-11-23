/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { In } from 'typeorm';
import { StandaloneHomeEntryEntity } from '../storage/standalone/entities.js';
import type { Transactions } from '../storage/transactions.js';
import type { MqttServiceOptions } from './options.js';

const MQTT_STALE_ENDPOINT_KIND = 'mqtt_stale_endpoint';

/** Resolves durable stale-device recovery options from injected options and environment. */
export function resolveMqttRecoveryOptions(
  options: MqttServiceOptions | undefined,
  transactions: Transactions | undefined,
) {
  const rawEnvGrace = process.env.HAUS_MQTT_STALE_GRACE_MS;
  const parsedEnvGrace =
    rawEnvGrace !== undefined && rawEnvGrace !== '' ? Number(rawEnvGrace) : NaN;
  const staleGraceMs =
    options?.staleGraceMs ??
    (Number.isFinite(parsedEnvGrace) && parsedEnvGrace >= 0 ? parsedEnvGrace : undefined);
  return {
    staleStore:
      options?.staleStore ?? (transactions ? new OrmMqttStaleStore(transactions) : undefined),
    staleGraceMs,
    staleSweepIntervalMs: options?.staleSweepIntervalMs,
    now: options?.now,
  };
}

/** Durable local-only tracking of when unclaimed MQTT endpoints were first observed missing. */
export interface MqttStaleStore {
  load(): Promise<Map<string, number>>;
  markMissing(entries: ReadonlyMap<string, number>): Promise<void>;
  clear(endpointIds: Iterable<string>): Promise<void>;
}

function parseFirstMissingAt(raw: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      'firstMissingAt' in parsed &&
      typeof parsed.firstMissingAt === 'number' &&
      Number.isFinite(parsed.firstMissingAt) &&
      parsed.firstMissingAt >= 0
    ) {
      return parsed.firstMissingAt;
    }
  } catch {
    // Ignore malformed local stale-tracker entry.
  }
  return undefined;
}

export class MemoryMqttStaleStore implements MqttStaleStore {
  private readonly missing = new Map<string, number>();

  async load(): Promise<Map<string, number>> {
    return new Map(this.missing);
  }

  async markMissing(entries: ReadonlyMap<string, number>): Promise<void> {
    for (const [endpointId, firstMissingAt] of entries) {
      if (!this.missing.has(endpointId)) this.missing.set(endpointId, firstMissingAt);
    }
  }

  async clear(endpointIds: Iterable<string>): Promise<void> {
    for (const endpointId of endpointIds) this.missing.delete(endpointId);
  }
}

export class OrmMqttStaleStore implements MqttStaleStore {
  constructor(private readonly transactions: Transactions) {}

  load(): Promise<Map<string, number>> {
    return this.transactions.read(async (manager) => {
      const rows = await manager.find(StandaloneHomeEntryEntity, {
        where: { kind: MQTT_STALE_ENDPOINT_KIND },
      });
      const result = new Map<string, number>();
      for (const row of rows) {
        const firstMissingAt = parseFirstMissingAt(row.value) ?? row.updatedAt;
        if (Number.isFinite(firstMissingAt) && firstMissingAt >= 0) {
          result.set(row.entryId, firstMissingAt);
        }
      }
      return result;
    });
  }

  async markMissing(entries: ReadonlyMap<string, number>): Promise<void> {
    if (entries.size === 0) return;
    await this.transactions.run(async (manager) => {
      const rows = [...entries.entries()].map(([endpointId, firstMissingAt]) => ({
        kind: MQTT_STALE_ENDPOINT_KIND,
        entryId: endpointId,
        value: JSON.stringify({ firstMissingAt }),
        updatedAt: firstMissingAt,
      }));
      for (let i = 0; i < rows.length; i += 100) {
        await manager.upsert(StandaloneHomeEntryEntity, rows.slice(i, i + 100), [
          'kind',
          'entryId',
        ]);
      }
    });
  }

  async clear(endpointIds: Iterable<string>): Promise<void> {
    const ids = [...new Set(endpointIds)];
    if (ids.length === 0) return;
    await this.transactions.run(async (manager) => {
      for (let i = 0; i < ids.length; i += 100) {
        await manager.delete(StandaloneHomeEntryEntity, {
          kind: MQTT_STALE_ENDPOINT_KIND,
          entryId: In(ids.slice(i, i + 100)),
        });
      }
    });
  }
}
