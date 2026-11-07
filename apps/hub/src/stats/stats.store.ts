/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { createHash } from 'node:crypto';
import { Between, DataSource } from 'typeorm';
import type { EntityManager, EntityTarget } from 'typeorm';
import type {
  RawStatisticSample,
  StatisticMetadata,
  StatisticRollup,
  StatisticSource,
} from '@haus/core';
import {
  RawStatisticSampleEntity,
  Statistic1hRollupEntity,
  Statistic5mRollupEntity,
  StatisticMetadataEntity,
} from './stats.schema.js';
import type { StatisticMetadataRow, StatisticRollupRow } from './stats.types.js';

const writeQueues = new WeakMap<DataSource, Promise<void>>();
const batchSize = 300;

function metadataToRow(
  value: Omit<StatisticMetadata, 'id' | 'createdAt'> & { readonly id?: string },
  id: string,
  createdAt: number,
): StatisticMetadataRow {
  return {
    id,
    statisticId: value.statisticId,
    source: value.source,
    unit: value.unit ?? null,
    kind: value.kind,
    displayName: value.displayName ?? null,
    hasMean: value.hasMean,
    hasSum: value.hasSum,
    createdAt,
  };
}

function metadataFromRow(row: StatisticMetadataRow): StatisticMetadata {
  return {
    id: row.id,
    statisticId: row.statisticId,
    source: row.source,
    unit: row.unit ?? undefined,
    kind: row.kind,
    displayName: row.displayName ?? undefined,
    hasMean: row.hasMean,
    hasSum: row.hasSum,
    createdAt: row.createdAt,
  };
}

function rollupFromRow(row: StatisticRollupRow): StatisticRollup {
  return {
    metadataId: row.metadataId,
    startTs: row.startTs,
    min: row.min,
    max: row.max,
    mean: row.mean,
    first: row.first,
    last: row.last,
    sum: row.sum,
    count: row.count,
  };
}

export class StatsStore {
  private acceptingWrites = true;
  private closeTask: Promise<void> | null = null;

  constructor(readonly source: DataSource) {
    if (source.options.type !== 'better-sqlite3' || !source.isInitialized) {
      throw Error('invalid_stats_source');
    }
  }

  public async registerMetadata(
    meta: Omit<StatisticMetadata, 'id' | 'createdAt'> & { readonly id?: string },
  ): Promise<StatisticMetadata> {
    const existing = await this.getMetadata(meta.statisticId);
    const id =
      existing?.id ??
      meta.id ??
      createHash('sha256').update(meta.statisticId).digest('hex').slice(0, 16);
    const createdAt = existing?.createdAt ?? Math.floor(Date.now() / 1000);
    const row = metadataToRow(meta, id, createdAt);
    await this.persistIngestion([], [row]);
    return metadataFromRow(row);
  }

  public async listMetadata(source?: StatisticSource): Promise<readonly StatisticMetadata[]> {
    const rows = await this.source.manager.find(StatisticMetadataEntity, {
      where: source ? { source } : undefined,
      order: { statisticId: 'ASC' },
    });
    return rows.map(metadataFromRow);
  }

  public async getMetadata(statisticId: string): Promise<StatisticMetadata | null> {
    const row = await this.source.manager.findOneBy(StatisticMetadataEntity, { statisticId });
    return row ? metadataFromRow(row) : null;
  }

  public async getMetadataById(id: string): Promise<StatisticMetadata | null> {
    const row = await this.source.manager.findOneBy(StatisticMetadataEntity, { id });
    return row ? metadataFromRow(row) : null;
  }

  /** Persist queued metadata and samples in one bounded, serialized transaction. */
  public persistIngestion(
    samples: readonly RawStatisticSample[],
    metadata: readonly StatisticMetadataRow[],
  ): Promise<void> {
    if (samples.length === 0 && metadata.length === 0) return Promise.resolve();
    return this.transaction(async (manager) => {
      await this.upsert(
        manager,
        StatisticMetadataEntity,
        metadata,
        ['statistic_id'],
        ['unit', 'kind', 'display_name'],
      );
      await this.upsert(
        manager,
        RawStatisticSampleEntity,
        samples,
        ['metadata_id', 'timestamp'],
        ['value'],
      );
    });
  }

  public insertRawSamples(samples: readonly RawStatisticSample[]): Promise<void> {
    return this.persistIngestion(samples, []);
  }

  public insert5mRollups(rollups: readonly StatisticRollup[]): Promise<void> {
    return this.upsertRollups(Statistic5mRollupEntity, rollups);
  }

  public insert1hRollups(rollups: readonly StatisticRollup[]): Promise<void> {
    return this.upsertRollups(Statistic1hRollupEntity, rollups);
  }

  public async queryRawSamples(
    metadataId: string,
    start: number,
    end: number,
    limit = 5000,
  ): Promise<readonly RawStatisticSample[]> {
    const rows = await this.source.manager.find(RawStatisticSampleEntity, {
      where: { metadataId, timestamp: Between(start, end) },
      order: { timestamp: 'ASC' },
      take: limit,
    });
    return rows.map((row) => ({ ...row }));
  }

  public query5mRollups(
    metadataId: string,
    start: number,
    end: number,
  ): Promise<readonly StatisticRollup[]> {
    return this.queryRollups(Statistic5mRollupEntity, metadataId, start, end);
  }

  public query1hRollups(
    metadataId: string,
    start: number,
    end: number,
  ): Promise<readonly StatisticRollup[]> {
    return this.queryRollups(Statistic1hRollupEntity, metadataId, start, end);
  }

  public async purgeOldRawSamples(olderThanSeconds: number, nowSeconds?: number): Promise<number> {
    const cutoff = (nowSeconds ?? Math.floor(Date.now() / 1000)) - olderThanSeconds;
    return this.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .delete()
        .from(RawStatisticSampleEntity)
        .where('timestamp < :cutoff', { cutoff })
        .execute();
      return result.affected ?? 0;
    });
  }

  public async purgeOld5mRollups(olderThanSeconds: number, nowSeconds?: number): Promise<number> {
    const cutoff = (nowSeconds ?? Math.floor(Date.now() / 1000)) - olderThanSeconds;
    return this.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .delete()
        .from(Statistic5mRollupEntity)
        .where('start_ts < :cutoff', { cutoff })
        .execute();
      return result.affected ?? 0;
    });
  }

  public close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.acceptingWrites = false;
    const pending = writeQueues.get(this.source);
    this.closeTask = (async () => {
      await pending;
      if (this.source.isInitialized) await this.source.destroy();
    })();
    return this.closeTask;
  }

  private upsertRollups(
    entity: EntityTarget<StatisticRollupRow>,
    rollups: readonly StatisticRollup[],
  ): Promise<void> {
    if (rollups.length === 0) return Promise.resolve();
    const rows: StatisticRollupRow[] = rollups.map((row) => ({ ...row }));
    return this.transaction((manager) =>
      this.upsert(
        manager,
        entity,
        rows,
        ['metadata_id', 'start_ts'],
        ['min', 'max', 'mean', 'first', 'last', 'sum', 'count'],
      ),
    );
  }

  private async queryRollups(
    entity: EntityTarget<StatisticRollupRow>,
    metadataId: string,
    start: number,
    end: number,
  ): Promise<readonly StatisticRollup[]> {
    const rows = await this.source.manager.find(entity, {
      where: { metadataId, startTs: Between(start, end) },
      order: { startTs: 'ASC' },
    });
    return rows.map(rollupFromRow);
  }

  private async upsert<T extends object>(
    manager: EntityManager,
    entity: EntityTarget<T>,
    rows: readonly T[],
    conflictColumns: string[],
    updateColumns: string[],
  ): Promise<void> {
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batch = rows.slice(offset, offset + batchSize);
      await manager
        .createQueryBuilder()
        .insert()
        .into(entity)
        .values(batch)
        .orUpdate(updateColumns, conflictColumns)
        .execute();
    }
  }

  private transaction<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    if (!this.acceptingWrites) return Promise.reject(Error('stats_store_closed'));
    const previous = writeQueues.get(this.source) ?? Promise.resolve();
    const result = previous.then(() => this.source.transaction('SERIALIZABLE', operation));
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    writeQueues.set(this.source, settled);
    void settled.then(() => {
      if (writeQueues.get(this.source) === settled) writeQueues.delete(this.source);
    });
    return result;
  }
}
