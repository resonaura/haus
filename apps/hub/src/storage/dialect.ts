/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import pg from 'pg';
import type { DataSource, EntityManager, QueryRunner } from 'typeorm';

let parsersConfigured = false;

/**
 * Registers safe numeric parsers for PostgreSQL OIDs so 64-bit timestamps/counters
 * (int8/bigint) and floats hydrate as native JS numbers matching SQLite behavior.
 */
export function configurePgTypeParsers(): void {
  if (parsersConfigured) return;
  parsersConfigured = true;
  const parseNum = (value: string): number => Number(value);
  pg.types.setTypeParser(20, parseNum); // int8 / bigint
  pg.types.setTypeParser(700, parseNum); // float4 / real
  pg.types.setTypeParser(701, parseNum); // float8 / double precision
  pg.types.setTypeParser(1700, parseNum); // numeric
}

export function isPostgresUrl(target: string | undefined): boolean {
  return typeof target === 'string' && /^postgres(?:ql)?:\/\//i.test(target.trim());
}

export function isPostgresSource(source: DataSource | QueryRunner): boolean {
  const options = 'connection' in source ? source.connection.options : source.options;
  return options.type === 'postgres';
}

export function isSupportedDataSource(source: DataSource): boolean {
  return (
    source.isInitialized &&
    (source.options.type === 'better-sqlite3' || source.options.type === 'postgres')
  );
}

export function resolveCatalogTarget(
  defaultSqlitePath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.HAUS_CATALOG_PG_URL?.trim() || env.HAUS_DATABASE_URL?.trim();
  return override || defaultSqlitePath;
}

export function resolveStatsTarget(
  defaultSqlitePath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.HAUS_STATS_PG_URL?.trim() || env.HAUS_STATS_DATABASE_URL?.trim();
  return override || defaultSqlitePath;
}

export interface PostgresPoolExtra {
  readonly max: number;
  readonly min: number;
  readonly idleTimeoutMillis: number;
  readonly connectionTimeoutMillis: number;
  readonly allowExitOnIdle: boolean;
  readonly application_name: string;
  readonly options: string;
}

export function createPostgresPoolExtra(
  role: 'catalog' | 'stats',
  env: NodeJS.ProcessEnv = process.env,
): PostgresPoolExtra {
  if (role === 'stats') {
    const max = parsePositiveInt(env.HAUS_STATS_PG_POOL_MAX, 8);
    const min = Math.min(max, parseNonNegativeInt(env.HAUS_STATS_PG_POOL_MIN, 0));
    return {
      max,
      min,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 20_000,
      allowExitOnIdle: true,
      application_name: 'haus-hub-stats',
      // Async WAL commit on telemetry/history writes removes fsync stall while staying crash-safe.
      options: '-c synchronous_commit=off -c lock_timeout=5000 -c statement_timeout=60000',
    };
  }
  const max = parsePositiveInt(env.HAUS_PG_POOL_MAX, 12);
  const min = Math.min(max, parseNonNegativeInt(env.HAUS_PG_POOL_MIN, 0));
  return {
    max,
    min,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 20_000,
    allowExitOnIdle: true,
    application_name: 'haus-hub-catalog',
    options: '-c lock_timeout=5000 -c statement_timeout=30000',
  };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Converts positional `?` placeholders to PostgreSQL `$1, $2, ...` outside single-quoted strings. */
export function sqlParams(isPg: boolean, sql: string): string {
  if (!isPg) return sql;
  let index = 0;
  let inSingleQuote = false;
  let out = '';
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]!;
    if (ch === "'") {
      out += ch;
      if (inSingleQuote && sql[i + 1] === "'") {
        out += "'";
        i += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
    } else if (ch === '?' && !inSingleQuote) {
      index += 1;
      out += `$${index}`;
    } else {
      out += ch;
    }
  }
  return out;
}

export function int64Col(isPg: boolean): 'bigint' | 'integer' {
  return isPg ? 'bigint' : 'integer';
}

export function floatCol(isPg: boolean): 'double precision' | 'real' {
  return isPg ? 'double precision' : 'real';
}

export function blobCol(isPg: boolean): 'bytea' | 'blob' {
  return isPg ? 'bytea' : 'blob';
}

export function boolCol(isPg: boolean): 'boolean' | 'integer' {
  return isPg ? 'boolean' : 'integer';
}

export function boolDefault(isPg: boolean, value: boolean): boolean | number {
  return isPg ? value : value ? 1 : 0;
}

export function boolLiteral(isPg: boolean, value: boolean): string {
  return isPg ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0';
}

const PG_BIGINT_COLUMN_NAMES = new Set([
  'at',
  'created_at',
  'updated_at',
  'expires_at',
  'revoked_at',
  'issued_at',
  'requested_at',
  'next_at',
  'start_at',
  'end_at',
  'media_start_at',
  'verified_at',
  'lease_expires_at',
  'bytes',
  'playback_bytes',
  'timestamp',
  'start_ts',
  'ts_ms',
]);

/** Upgrades 64-bit timestamp/byte columns from SQLite `integer` to PostgreSQL `bigint`. */
export function migrationColumnType(
  isPg: boolean,
  columnName: string,
  declaredType: unknown,
): string {
  const raw = declaredType === Boolean ? 'boolean' : String(declaredType);
  if (!isPg) return raw;
  if (raw === 'blob') return 'bytea';
  if (raw === 'real') return 'double precision';
  if (raw === 'integer' && PG_BIGINT_COLUMN_NAMES.has(columnName)) return 'bigint';
  return raw;
}

export async function tableExists(
  manager: EntityManager,
  isPg: boolean,
  tableName: string,
): Promise<boolean> {
  const rows: unknown = isPg
    ? await manager.query(
        'SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1 LIMIT 1',
        [tableName],
      )
    : await manager.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1", [
        tableName,
      ]);
  return Array.isArray(rows) && rows.length > 0;
}
