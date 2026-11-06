/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import type {
  RawStatisticSample,
  StatisticMetadata,
  StatisticRollup,
  StatisticSource,
} from '@haus/core';
import { initStatsSchema } from './stats.migration.js';

interface RawDbMetadataRow {
  readonly id: string;
  readonly 'statistic-id': string;
  readonly source: string;
  readonly unit: string | null;
  readonly kind: string;
  readonly 'display-name': string | null;
  readonly 'has-mean': number;
  readonly 'has-sum': number;
  readonly 'created-at': number;
}

interface RawDbRollupRow {
  readonly 'metadata-id': string;
  readonly 'start-ts': number;
  readonly min: number;
  readonly max: number;
  readonly mean: number | null;
  readonly first: number;
  readonly last: number;
  readonly sum: number | null;
  readonly count: number;
}

function toDbMetadataRow(row: Record<string, unknown>): RawDbMetadataRow {
  return {
    id: String(row.id ?? ''),
    'statistic-id': String(row['statistic-id'] ?? ''),
    source: String(row.source ?? ''),
    unit: row.unit !== null && row.unit !== undefined ? String(row.unit) : null,
    kind: String(row.kind ?? ''),
    'display-name':
      row['display-name'] !== null && row['display-name'] !== undefined
        ? String(row['display-name'])
        : null,
    'has-mean': Number(row['has-mean'] ?? 0),
    'has-sum': Number(row['has-sum'] ?? 0),
    'created-at': Number(row['created-at'] ?? 0),
  };
}

function toDbRollupRow(row: Record<string, unknown>): RawDbRollupRow {
  return {
    'metadata-id': String(row['metadata-id'] ?? ''),
    'start-ts': Number(row['start-ts'] ?? 0),
    min: Number(row.min ?? 0),
    max: Number(row.max ?? 0),
    mean: row.mean !== null && row.mean !== undefined ? Number(row.mean) : null,
    first: Number(row.first ?? 0),
    last: Number(row.last ?? 0),
    sum: row.sum !== null && row.sum !== undefined ? Number(row.sum) : null,
    count: Number(row.count ?? 0),
  };
}

export class StatsStore {
  readonly db: DatabaseSync;
  private readonly insertMetadataStmt: StatementSync;
  private readonly getMetaByStatIdStmt: StatementSync;
  private readonly getMetaByIdStmt: StatementSync;
  private readonly listMetaStmt: StatementSync;
  private readonly listMetaBySourceStmt: StatementSync;

  private readonly insertRawStmt: StatementSync;
  private readonly insert5mStmt: StatementSync;
  private readonly insert1hStmt: StatementSync;

  private readonly queryRawStmt: StatementSync;
  private readonly query5mStmt: StatementSync;
  private readonly query1hStmt: StatementSync;

  private readonly purgeRawStmt: StatementSync;
  private readonly purge5mStmt: StatementSync;

  constructor(dbOrPath: DatabaseSync | string) {
    if (typeof dbOrPath === 'string') {
      this.db = new DatabaseSync(dbOrPath);
    } else {
      this.db = dbOrPath;
    }

    initStatsSchema(this.db);

    this.insertMetadataStmt = this.db.prepare(`
      INSERT INTO "stats-metadata" (
        "id", "statistic-id", "source", "unit", "kind", "display-name", "has-mean", "has-sum", "created-at"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT("statistic-id") DO UPDATE SET
        "display-name" = excluded."display-name",
        "unit" = excluded."unit",
        "kind" = excluded."kind"
    `);

    this.getMetaByStatIdStmt = this.db.prepare(`
      SELECT * FROM "stats-metadata" WHERE "statistic-id" = ?
    `);

    this.getMetaByIdStmt = this.db.prepare(`
      SELECT * FROM "stats-metadata" WHERE "id" = ?
    `);

    this.listMetaStmt = this.db.prepare(`
      SELECT * FROM "stats-metadata" ORDER BY "statistic-id" ASC
    `);

    this.listMetaBySourceStmt = this.db.prepare(`
      SELECT * FROM "stats-metadata" WHERE "source" = ? ORDER BY "statistic-id" ASC
    `);

    this.insertRawStmt = this.db.prepare(`
      INSERT OR REPLACE INTO "stats-raw" ("metadata-id", "timestamp", "value") VALUES (?, ?, ?)
    `);

    this.insert5mStmt = this.db.prepare(`
      INSERT OR REPLACE INTO "stats-5m" (
        "metadata-id", "start-ts", "min", "max", "mean", "first", "last", "sum", "count"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insert1hStmt = this.db.prepare(`
      INSERT OR REPLACE INTO "stats-1h" (
        "metadata-id", "start-ts", "min", "max", "mean", "first", "last", "sum", "count"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.queryRawStmt = this.db.prepare(`
      SELECT "metadata-id", "timestamp", "value"
      FROM "stats-raw"
      WHERE "metadata-id" = ? AND "timestamp" >= ? AND "timestamp" <= ?
      ORDER BY "timestamp" ASC
      LIMIT ?
    `);

    this.query5mStmt = this.db.prepare(`
      SELECT * FROM "stats-5m"
      WHERE "metadata-id" = ? AND "start-ts" >= ? AND "start-ts" <= ?
      ORDER BY "start-ts" ASC
    `);

    this.query1hStmt = this.db.prepare(`
      SELECT * FROM "stats-1h"
      WHERE "metadata-id" = ? AND "start-ts" >= ? AND "start-ts" <= ?
      ORDER BY "start-ts" ASC
    `);

    this.purgeRawStmt = this.db.prepare(`
      DELETE FROM "stats-raw" WHERE "timestamp" < ?
    `);

    this.purge5mStmt = this.db.prepare(`
      DELETE FROM "stats-5m" WHERE "start-ts" < ?
    `);
  }

  public registerMetadata(
    meta: Omit<StatisticMetadata, 'id' | 'createdAt'> & { readonly id?: string },
  ): StatisticMetadata {
    const existing = this.getMetadata(meta.statisticId);
    if (existing) {
      // Update metadata attributes if changed
      this.insertMetadataStmt.run(
        existing.id,
        meta.statisticId,
        meta.source,
        meta.unit ?? null,
        meta.kind,
        meta.displayName ?? null,
        meta.hasMean ? 1 : 0,
        meta.hasSum ? 1 : 0,
        existing.createdAt,
      );
      return {
        id: existing.id,
        statisticId: meta.statisticId,
        source: meta.source,
        unit: meta.unit,
        kind: meta.kind,
        displayName: meta.displayName,
        hasMean: meta.hasMean,
        hasSum: meta.hasSum,
        createdAt: existing.createdAt,
      };
    }

    const id = meta.id ?? createHash('sha256').update(meta.statisticId).digest('hex').slice(0, 16);
    const createdAt = Math.floor(Date.now() / 1000);

    this.insertMetadataStmt.run(
      id,
      meta.statisticId,
      meta.source,
      meta.unit ?? null,
      meta.kind,
      meta.displayName ?? null,
      meta.hasMean ? 1 : 0,
      meta.hasSum ? 1 : 0,
      createdAt,
    );

    return {
      id,
      statisticId: meta.statisticId,
      source: meta.source,
      unit: meta.unit,
      kind: meta.kind,
      displayName: meta.displayName,
      hasMean: meta.hasMean,
      hasSum: meta.hasSum,
      createdAt,
    };
  }

  public getMetadata(statisticId: string): StatisticMetadata | null {
    const row = this.getMetaByStatIdStmt.get(statisticId) as Record<string, unknown> | undefined;
    return row ? this.mapMetadataRow(toDbMetadataRow(row)) : null;
  }

  public getMetadataById(id: string): StatisticMetadata | null {
    const row = this.getMetaByIdStmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.mapMetadataRow(toDbMetadataRow(row)) : null;
  }

  public listMetadata(source?: StatisticSource): readonly StatisticMetadata[] {
    const rows = (
      source ? this.listMetaBySourceStmt.all(source) : this.listMetaStmt.all()
    ) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapMetadataRow(toDbMetadataRow(r)));
  }

  public insertRawSamples(samples: readonly RawStatisticSample[]): void {
    if (samples.length === 0) return;
    this.db.exec('BEGIN TRANSACTION;');
    try {
      for (const s of samples) {
        this.insertRawStmt.run(s.metadataId, s.timestamp, s.value);
      }
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  public insert5mRollups(rollups: readonly StatisticRollup[]): void {
    if (rollups.length === 0) return;
    this.db.exec('BEGIN TRANSACTION;');
    try {
      for (const r of rollups) {
        this.insert5mStmt.run(
          r.metadataId,
          r.startTs,
          r.min,
          r.max,
          r.mean ?? null,
          r.first,
          r.last,
          r.sum ?? null,
          r.count,
        );
      }
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  public insert1hRollups(rollups: readonly StatisticRollup[]): void {
    if (rollups.length === 0) return;
    this.db.exec('BEGIN TRANSACTION;');
    try {
      for (const r of rollups) {
        this.insert1hStmt.run(
          r.metadataId,
          r.startTs,
          r.min,
          r.max,
          r.mean ?? null,
          r.first,
          r.last,
          r.sum ?? null,
          r.count,
        );
      }
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  public queryRawSamples(
    metadataId: string,
    start: number,
    end: number,
    limit = 5000,
  ): readonly RawStatisticSample[] {
    const rows = this.queryRawStmt.all(metadataId, start, end, limit) as Array<
      Record<string, unknown>
    >;

    return rows.map((r) => ({
      metadataId: String(r['metadata-id'] ?? ''),
      timestamp: Number(r.timestamp ?? 0),
      value: Number(r.value ?? 0),
    }));
  }

  public query5mRollups(
    metadataId: string,
    start: number,
    end: number,
  ): readonly StatisticRollup[] {
    const rows = this.query5mStmt.all(metadataId, start, end) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRollupRow(toDbRollupRow(r)));
  }

  public query1hRollups(
    metadataId: string,
    start: number,
    end: number,
  ): readonly StatisticRollup[] {
    const rows = this.query1hStmt.all(metadataId, start, end) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRollupRow(toDbRollupRow(r)));
  }

  public purgeOldRawSamples(olderThanSeconds: number, nowSeconds?: number): number {
    const now = nowSeconds ?? Math.floor(Date.now() / 1000);
    const cutoff = now - olderThanSeconds;
    const res = this.purgeRawStmt.run(cutoff);
    return Number(res.changes);
  }

  public purgeOld5mRollups(olderThanSeconds: number, nowSeconds?: number): number {
    const now = nowSeconds ?? Math.floor(Date.now() / 1000);
    const cutoff = now - olderThanSeconds;
    const res = this.purge5mStmt.run(cutoff);
    return Number(res.changes);
  }

  public close(): void {
    this.db.close();
  }

  private mapMetadataRow(r: RawDbMetadataRow): StatisticMetadata {
    return {
      id: r.id,
      statisticId: r['statistic-id'],
      source: r.source as StatisticSource,
      unit: r.unit ?? undefined,
      kind: r.kind as StatisticMetadata['kind'],
      displayName: r['display-name'] ?? undefined,
      hasMean: Boolean(r['has-mean']),
      hasSum: Boolean(r['has-sum']),
      createdAt: r['created-at'],
    };
  }

  private mapRollupRow(r: RawDbRollupRow): StatisticRollup {
    return {
      metadataId: r['metadata-id'],
      startTs: r['start-ts'],
      min: r.min,
      max: r.max,
      mean: r.mean,
      first: r.first,
      last: r.last,
      sum: r.sum,
      count: r.count,
    };
  }
}
