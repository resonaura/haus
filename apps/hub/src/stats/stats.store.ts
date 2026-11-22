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
  EndpointHistoryEventEntity,
  RawStatisticSampleEntity,
  Statistic1hRollupEntity,
  Statistic5mRollupEntity,
  StatisticMetadataEntity,
} from './stats.schema.js';
import type {
  EndpointHistoryEventRow,
  StatisticMetadataRow,
  StatisticRollupRow,
} from './stats.types.js';
import { isPostgresSource, isSupportedDataSource } from '../storage/dialect.js';
import { getDataSourcePendingQueue, scheduleDataSourceOperation } from '../storage/transactions.js';
import {
  queryEndpointHistoryAfterCursor,
  queryEndpointHistoryRows,
  queryRawSamplesAfterCursor,
  queryRollupsAfterCursor,
  type EndpointHistoryEntryResult,
  type TimeKeyCursor,
} from './stats.history.js';

export type { EndpointHistoryEntryResult, TimeKeyCursor };

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

function prepareUpsertRows<T extends object>(rows: readonly T[], keyOf: (row: T) => string): T[] {
  if (rows.length <= 1) return [...rows];
  // Deduplicate conflict keys (last-write-wins, matching SQLite) so PostgreSQL never throws
  // SQLSTATE 21000 ("ON CONFLICT DO UPDATE command cannot affect row a second time"),
  // and sort deterministically by key so concurrent batches never deadlock (SQLSTATE 40P01).
  const byKey = new Map<string, T>();
  for (const row of rows) {
    byKey.set(keyOf(row), row);
  }
  return Array.from(byKey.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, row]) => row);
}

const metadataKey = (row: StatisticMetadataRow): string => row.statisticId;
const rawSampleKey = (row: RawStatisticSample): string =>
  `${row.metadataId}\0${String(row.timestamp).padStart(16, '0')}`;
const rollupKey = (row: StatisticRollupRow): string =>
  `${row.metadataId}\0${String(row.startTs).padStart(16, '0')}`;
const endpointHistoryKey = (row: EndpointHistoryEventRow): string =>
  `${row.endpointId}\0${String(row.tsMs).padStart(16, '0')}`;

export class StatsStore {
  readonly isPostgres: boolean;
  private readonly batchSize: number;
  private acceptingWrites = true;
  private closeTask: Promise<void> | null = null;

  constructor(readonly source: DataSource) {
    if (!isSupportedDataSource(source)) {
      throw Error('invalid_stats_source');
    }
    this.isPostgres = isPostgresSource(source);
    this.batchSize = this.isPostgres ? 1000 : 300;
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
    return this.read(async (manager) => {
      const rows = await manager.find(StatisticMetadataEntity, {
        where: source ? { source } : undefined,
        order: { statisticId: 'ASC' },
      });
      return rows.map(metadataFromRow);
    });
  }

  public async getMetadata(statisticId: string): Promise<StatisticMetadata | null> {
    return this.read(async (manager) => {
      const row = await manager.findOneBy(StatisticMetadataEntity, { statisticId });
      return row ? metadataFromRow(row) : null;
    });
  }

  public async getMetadataById(id: string): Promise<StatisticMetadata | null> {
    return this.read(async (manager) => {
      const row = await manager.findOneBy(StatisticMetadataEntity, { id });
      return row ? metadataFromRow(row) : null;
    });
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
        metadataKey,
      );
      await this.upsert(
        manager,
        RawStatisticSampleEntity,
        samples,
        ['metadata_id', 'timestamp'],
        ['value'],
        rawSampleKey,
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
    return this.read((manager) =>
      manager
        .createQueryBuilder(RawStatisticSampleEntity, 's')
        .select(['s.metadata_id AS "metadataId"', 's.timestamp AS timestamp', 's.value AS value'])
        .where('s.metadata_id = :metadataId AND s.timestamp BETWEEN :start AND :end', {
          metadataId,
          start,
          end,
        })
        .orderBy('s.timestamp', 'ASC')
        .limit(limit)
        .getRawMany<RawStatisticSample>(),
    );
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

  public insertEndpointHistory(rows: readonly EndpointHistoryEventRow[]): Promise<void> {
    if (rows.length === 0) return Promise.resolve();
    return this.transaction((manager) =>
      this.upsert(
        manager,
        EndpointHistoryEventEntity,
        rows,
        ['endpoint_id', 'ts_ms'],
        ['state_json'],
        endpointHistoryKey,
      ),
    );
  }

  public async deleteEndpointHistory(endpointId: string): Promise<void> {
    if (!endpointId) return;
    await this.transaction((manager) => manager.delete(EndpointHistoryEventEntity, { endpointId }));
  }

  public queryEndpointHistory(
    endpointIds: readonly string[],
    fromMs: number,
    toMs: number,
    maxPerEndpoint = 5000,
  ): Promise<Record<string, EndpointHistoryEntryResult[]>> {
    return this.read((manager) =>
      queryEndpointHistoryRows(manager, this.isPostgres, endpointIds, fromMs, toMs, maxPerEndpoint),
    );
  }

  public queryRawSamplesSince(
    cursor: TimeKeyCursor,
    limit: number,
  ): Promise<readonly RawStatisticSample[]> {
    return this.read((manager) =>
      queryRawSamplesAfterCursor(manager, this.isPostgres, cursor, limit),
    );
  }

  public queryRollupsSince(
    tier: '5m' | '1h',
    cursor: TimeKeyCursor,
    limit: number,
  ): Promise<readonly StatisticRollup[]> {
    return this.read((manager) =>
      queryRollupsAfterCursor(manager, this.isPostgres, tier, cursor, limit),
    );
  }

  public queryEndpointHistorySince(
    cursor: TimeKeyCursor,
    limit: number,
  ): Promise<readonly EndpointHistoryEventRow[]> {
    return this.read((manager) =>
      queryEndpointHistoryAfterCursor(manager, this.isPostgres, cursor, limit),
    );
  }

  public applyTelemetryDeltaBatch(batch: {
    readonly metadata: readonly StatisticMetadataRow[];
    readonly rawSamples: readonly RawStatisticSample[];
    readonly rollups5m: readonly StatisticRollup[];
    readonly rollups1h: readonly StatisticRollup[];
    readonly endpointHistory: readonly EndpointHistoryEventRow[];
  }): Promise<number> {
    const total =
      batch.metadata.length +
      batch.rawSamples.length +
      batch.rollups5m.length +
      batch.rollups1h.length +
      batch.endpointHistory.length;
    if (total === 0) return Promise.resolve(0);
    return this.transaction(async (manager) => {
      await this.upsert(
        manager,
        StatisticMetadataEntity,
        batch.metadata,
        ['statistic_id'],
        ['unit', 'kind', 'display_name'],
        metadataKey,
      );
      await this.upsert(
        manager,
        RawStatisticSampleEntity,
        batch.rawSamples,
        ['metadata_id', 'timestamp'],
        ['value'],
        rawSampleKey,
      );
      await this.upsert(
        manager,
        Statistic5mRollupEntity,
        batch.rollups5m.map((r) => ({ ...r })),
        ['metadata_id', 'start_ts'],
        ['min', 'max', 'mean', 'first', 'last', 'sum', 'count'],
        rollupKey,
      );
      await this.upsert(
        manager,
        Statistic1hRollupEntity,
        batch.rollups1h.map((r) => ({ ...r })),
        ['metadata_id', 'start_ts'],
        ['min', 'max', 'mean', 'first', 'last', 'sum', 'count'],
        rollupKey,
      );
      await this.upsert(
        manager,
        EndpointHistoryEventEntity,
        batch.endpointHistory,
        ['endpoint_id', 'ts_ms'],
        ['state_json'],
        endpointHistoryKey,
      );
      return total;
    });
  }

  public async purgeOldRawSamples(olderThanSeconds: number, nowSeconds?: number): Promise<number> {
    const cutoff = (nowSeconds ?? Math.floor(Date.now() / 1000)) - olderThanSeconds;
    return this.purgeInChunks(RawStatisticSampleEntity, 'stats_raw', 'timestamp', cutoff);
  }

  public async purgeOld5mRollups(olderThanSeconds: number, nowSeconds?: number): Promise<number> {
    const cutoff = (nowSeconds ?? Math.floor(Date.now() / 1000)) - olderThanSeconds;
    return this.purgeInChunks(Statistic5mRollupEntity, 'stats_5m', 'start_ts', cutoff);
  }

  public async purgeOldEndpointHistory(olderThanMs: number, nowMs?: number): Promise<number> {
    const cutoff = (nowMs ?? Date.now()) - olderThanMs;
    return this.purgeInChunks(
      EndpointHistoryEventEntity,
      'endpoint_history_events',
      'ts_ms',
      cutoff,
    );
  }

  private async purgeInChunks(
    entity: EntityTarget<object>,
    tableName: 'stats_raw' | 'stats_5m' | 'endpoint_history_events',
    tsColumn: 'timestamp' | 'start_ts' | 'ts_ms',
    cutoff: number,
  ): Promise<number> {
    const chunkLimit = 5_000;
    const maxChunks = 20;
    const rowRef = this.isPostgres ? 'ctid' : 'rowid';
    let totalPurged = 0;
    for (let chunk = 0; chunk < maxChunks; chunk += 1) {
      const affected = await this.transaction(async (manager) => {
        const result = await manager
          .createQueryBuilder()
          .delete()
          .from(entity)
          .where(
            `${rowRef} IN (SELECT ${rowRef} FROM "${tableName}" WHERE "${tsColumn}" < :cutoff LIMIT :limit)`,
            { cutoff, limit: chunkLimit },
          )
          .execute();
        return result.affected ?? 0;
      });
      totalPurged += affected;
      if (affected < chunkLimit) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return totalPurged;
  }

  public runTransaction<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.transaction(operation);
  }

  public close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.acceptingWrites = false;
    const pending = getDataSourcePendingQueue(this.source);
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
        rollupKey,
      ),
    );
  }

  private async queryRollups(
    entity: EntityTarget<StatisticRollupRow>,
    metadataId: string,
    start: number,
    end: number,
  ): Promise<readonly StatisticRollup[]> {
    return this.read(async (manager) => {
      const rows = await manager.find(entity, {
        where: { metadataId, startTs: Between(start, end) },
        order: { startTs: 'ASC' },
      });
      return rows.map(rollupFromRow);
    });
  }

  private async upsert<T extends object>(
    manager: EntityManager,
    entity: EntityTarget<T>,
    rows: readonly T[],
    conflictColumns: string[],
    updateColumns: string[],
    keyOf: (row: T) => string,
  ): Promise<void> {
    if (rows.length === 0) return;
    const prepared = prepareUpsertRows(rows, keyOf);
    for (let offset = 0; offset < prepared.length; offset += this.batchSize) {
      const batch = prepared.slice(offset, offset + this.batchSize);
      await manager
        .createQueryBuilder()
        .insert()
        .into(entity)
        .values(batch)
        .orUpdate(updateColumns, conflictColumns)
        .execute();
    }
  }

  private read<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    if (!this.acceptingWrites) return Promise.reject(Error('stats_store_closed'));
    return scheduleDataSourceOperation(this.source, () => operation(this.source.manager));
  }

  private transaction<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    if (!this.acceptingWrites) return Promise.reject(Error('stats_store_closed'));
    const isolation = this.isPostgres ? 'READ COMMITTED' : 'SERIALIZABLE';
    return scheduleDataSourceOperation(this.source, () =>
      this.source.transaction(isolation, operation),
    );
  }
}
