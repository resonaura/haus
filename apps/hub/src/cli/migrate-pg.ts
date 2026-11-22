/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataSource } from 'typeorm';
import { openCatalog } from '../storage/source.js';
import { openStatsSource } from '../stats/stats.source.js';
import { isPostgresUrl } from '../storage/dialect.js';

export interface TableMigrationReport {
  readonly table: string;
  readonly sourceRows: number;
  readonly targetRows: number;
}

export interface MigrateSqliteToPostgresOptions {
  readonly catalogSqlitePath?: string;
  readonly catalogPgUrl?: string;
  readonly statsSqlitePath?: string;
  readonly statsPgUrl?: string;
  readonly replaceTarget?: boolean;
}

export interface MigrateSqliteToPostgresResult {
  readonly catalog: readonly TableMigrationReport[];
  readonly stats: readonly TableMigrationReport[];
  readonly expandedHistoryEvents: number;
}

const PRIORITY_TABLES: readonly string[] = [
  'haus_platform_lock',
  'haus_identity_ids',
  'haus_addresses',
  'haus_identity_refs',
  'haus_primary_addresses',
  'haus_sessions',
  'haus_receipts',
  'stats_metadata',
  'stats_raw',
  'stats_5m',
  'stats_1h',
  'endpoint_history_events',
];

const EXCLUDED_TABLES = new Set([
  'haus_platform_migrations',
  'haus_stats_migrations',
  'haus_events_migrations',
]);

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function coercePgValue(value: unknown, pgDataType: string): unknown {
  if (value === null || value === undefined) return null;
  if (pgDataType === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
    return Boolean(value);
  }
  if (pgDataType === 'bytea') {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    return Buffer.from(String(value), 'utf8');
  }
  if (pgDataType === 'bigint' || pgDataType === 'integer' || pgDataType === 'smallint') {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  if (pgDataType === 'double precision' || pgDataType === 'real' || pgDataType === 'numeric') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return value;
}

async function openReadOnlySqlite(database: string): Promise<DataSource> {
  const source = new DataSource({
    type: 'better-sqlite3',
    database,
    readonly: true,
    fileMustExist: true,
    synchronize: false,
    migrationsRun: false,
    logging: false,
    timeout: 5000,
  });
  await source.initialize();
  return source;
}

async function copyAllTables(
  sqlite: DataSource,
  pg: DataSource,
  replaceTarget: boolean,
): Promise<TableMigrationReport[]> {
  const sqliteTables = (
    (await sqlite.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )) as Array<{ name: string }>
  )
    .map((r) => r.name)
    .filter((name) => !EXCLUDED_TABLES.has(name));

  const pgTablesSet = new Set(
    (
      (await pg.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'",
      )) as Array<{ table_name: string }>
    ).map((r) => r.table_name),
  );

  const tables = sqliteTables.filter((t) => pgTablesSet.has(t));
  tables.sort((a, b) => {
    const ia = PRIORITY_TABLES.indexOf(a);
    const ib = PRIORITY_TABLES.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  const reports: TableMigrationReport[] = [];
  const batchSize = 500;

  if (replaceTarget) {
    await pg.transaction('READ COMMITTED', async (manager) => {
      for (const table of [...tables].reverse()) {
        if (table === 'haus_platform_lock') continue;
        await manager.query(`DELETE FROM ${quoteIdent(table)}`);
      }
    });
  }

  for (const table of tables) {
    const sqCols = new Set(
      (
        (await sqlite.query(`PRAGMA table_info(${quoteIdent(table)})`)) as Array<{ name: string }>
      ).map((c) => c.name),
    );
    const pgCols = (
      (await pg.query(
        'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position',
        [table],
      )) as Array<{ column_name: string; data_type: string }>
    ).filter((c) => sqCols.has(c.column_name));

    if (pgCols.length === 0) continue;

    const colNames = pgCols.map((c) => c.column_name);
    const colSql = colNames.map(quoteIdent).join(', ');
    const rows = (await sqlite.query(`SELECT ${colSql} FROM ${quoteIdent(table)}`)) as Array<
      Record<string, unknown>
    >;

    if (rows.length > 0) {
      await pg.transaction('READ COMMITTED', async (manager) => {
        for (let offset = 0; offset < rows.length; offset += batchSize) {
          const chunk = rows.slice(offset, offset + batchSize);
          const params: unknown[] = [];
          const valueTuples: string[] = [];
          for (const row of chunk) {
            const placeholders: string[] = [];
            for (const col of pgCols) {
              params.push(coercePgValue(row[col.column_name], col.data_type));
              placeholders.push(`$${params.length}`);
            }
            valueTuples.push(`(${placeholders.join(', ')})`);
          }
          await manager.query(
            `INSERT INTO ${quoteIdent(table)} (${colSql}) VALUES ${valueTuples.join(', ')} ON CONFLICT DO NOTHING`,
            params,
          );
        }
      });
    }

    const pgCountRows = (await pg.query(
      `SELECT count(*)::bigint AS count FROM ${quoteIdent(table)}`,
    )) as Array<{ count: number | string }>;
    const targetRows = Number(pgCountRows[0]?.count ?? 0);
    if (targetRows < rows.length) {
      throw Error(
        `pg_migration_row_count_mismatch:${table}:source=${rows.length}:target=${targetRows}`,
      );
    }
    reports.push({ table, sourceRows: rows.length, targetRows });
  }

  return reports;
}

async function expandLegacyEndpointHistory(
  catalogSqlite: DataSource,
  statsPg: DataSource,
): Promise<number> {
  const hasTable = (await catalogSqlite.query(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='standalone_home_entries'",
  )) as Array<Record<string, unknown>>;
  if (hasTable.length === 0) return 0;

  const rows = (await catalogSqlite.query(
    "SELECT entry_id, value FROM standalone_home_entries WHERE kind = 'endpoint_history'",
  )) as Array<{ entry_id: string; value: string }>;

  const events: Array<{ endpointId: string; tsMs: number; stateJson: string }> = [];
  for (const row of rows) {
    try {
      const parsed: unknown = JSON.parse(row.value);
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        if (
          item &&
          typeof item === 'object' &&
          'tsMs' in item &&
          'state' in item &&
          typeof (item as { tsMs: unknown }).tsMs === 'number' &&
          Number.isFinite((item as { tsMs: number }).tsMs)
        ) {
          events.push({
            endpointId: row.entry_id,
            tsMs: Math.trunc((item as { tsMs: number }).tsMs),
            stateJson: JSON.stringify((item as { state: unknown }).state ?? {}),
          });
        }
      }
    } catch {
      // Ignore malformed legacy history blobs.
    }
  }
  if (events.length === 0) return 0;

  const batchSize = 500;
  await statsPg.transaction('READ COMMITTED', async (manager) => {
    for (let offset = 0; offset < events.length; offset += batchSize) {
      const chunk = events.slice(offset, offset + batchSize);
      const params: unknown[] = [];
      const tuples: string[] = [];
      for (const ev of chunk) {
        params.push(ev.endpointId, ev.tsMs, ev.stateJson);
        tuples.push(`($${params.length - 2}, $${params.length - 1}, $${params.length})`);
      }
      await manager.query(
        `INSERT INTO endpoint_history_events (endpoint_id, ts_ms, state_json) VALUES ${tuples.join(', ')} ON CONFLICT (endpoint_id, ts_ms) DO NOTHING`,
        params,
      );
    }
  });
  return events.length;
}

export async function migrateSqliteToPostgres(
  options: MigrateSqliteToPostgresOptions,
): Promise<MigrateSqliteToPostgresResult> {
  let catalogReports: TableMigrationReport[] = [];
  let statsReports: TableMigrationReport[] = [];
  let expandedHistoryEvents = 0;
  let catalogSqlite: DataSource | undefined;
  let statsPg: DataSource | undefined;

  try {
    if (options.catalogSqlitePath && options.catalogPgUrl) {
      if (!isPostgresUrl(options.catalogPgUrl)) throw Error('invalid_catalog_pg_url');
      if (!existsSync(options.catalogSqlitePath)) {
        throw Error(`catalog_sqlite_missing:${options.catalogSqlitePath}`);
      }
      catalogSqlite = await openReadOnlySqlite(options.catalogSqlitePath);
      const catalogPg = await openCatalog(options.catalogPgUrl);
      try {
        catalogReports = await copyAllTables(
          catalogSqlite,
          catalogPg,
          Boolean(options.replaceTarget),
        );
      } finally {
        await catalogPg.destroy();
      }
    }

    if (options.statsPgUrl) {
      if (!isPostgresUrl(options.statsPgUrl)) throw Error('invalid_stats_pg_url');
      statsPg = await openStatsSource(options.statsPgUrl);
      if (options.statsSqlitePath && existsSync(options.statsSqlitePath)) {
        const statsSqlite = await openReadOnlySqlite(options.statsSqlitePath);
        try {
          statsReports = await copyAllTables(statsSqlite, statsPg, Boolean(options.replaceTarget));
        } finally {
          await statsSqlite.destroy();
        }
      }
      if (catalogSqlite) {
        expandedHistoryEvents = await expandLegacyEndpointHistory(catalogSqlite, statsPg);
      }
    }

    return { catalog: catalogReports, stats: statsReports, expandedHistoryEvents };
  } finally {
    if (statsPg?.isInitialized) await statsPg.destroy();
    if (catalogSqlite?.isInitialized) await catalogSqlite.destroy();
  }
}

function parseCliArgs(argv: readonly string[]): MigrateSqliteToPostgresOptions {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
  };
  return {
    catalogSqlitePath: get('--catalog-sqlite'),
    catalogPgUrl:
      get('--catalog-pg') ?? process.env.HAUS_CATALOG_PG_URL ?? process.env.HAUS_DATABASE_URL,
    statsSqlitePath: get('--stats-sqlite'),
    statsPgUrl: get('--stats-pg') ?? process.env.HAUS_STATS_PG_URL,
    replaceTarget: argv.includes('--replace'),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const opts = parseCliArgs(process.argv.slice(2));
  const result = await migrateSqliteToPostgres(opts);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
