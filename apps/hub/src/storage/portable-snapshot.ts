/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { rm } from 'node:fs/promises';
import type { DataSource } from 'typeorm';

/**
 * Parent-before-child ordering ensures foreign-key constraints succeed when importing
 * a consistent PostgreSQL catalog snapshot into a portable SQLite backup file.
 */
const PRIORITY_TABLE_ORDER: readonly string[] = [
  'haus_platform_lock',
  'haus_identity_ids',
  'haus_addresses',
  'haus_identity_refs',
  'haus_primary_addresses',
  'haus_sessions',
  'haus_receipts',
];

const EXCLUDED_TABLES = new Set(['haus_platform_migrations']);

function toSqliteBindValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Exports a point-in-time REPEATABLE READ consistent snapshot of a PostgreSQL catalog
 * into a standalone SQLite database file so existing backup/restore tooling stays portable.
 */
export async function exportPostgresCatalogToSqlite(
  pgSource: DataSource,
  destinationPath: string,
  openSqliteCatalog: (database: string) => Promise<DataSource>,
): Promise<void> {
  await rm(destinationPath, { force: true });
  const sqliteSource = await openSqliteCatalog(destinationPath);
  try {
    const sqliteTablesRaw = (await sqliteSource.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )) as Array<{ name: string }>;
    const sqliteTableSet = new Set(sqliteTablesRaw.map((row) => row.name));

    const pgTablesRaw = (await pgSource.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'",
    )) as Array<{ table_name: string }>;
    const exportTables = pgTablesRaw
      .map((row) => row.table_name)
      .filter((name) => !EXCLUDED_TABLES.has(name) && sqliteTableSet.has(name));

    exportTables.sort((a, b) => {
      const ia = PRIORITY_TABLE_ORDER.indexOf(a);
      const ib = PRIORITY_TABLE_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });

    const snapshotData = new Map<
      string,
      { columns: string[]; rows: Array<Record<string, unknown>> }
    >();

    // Read every table inside a single REPEATABLE READ transaction for point-in-time consistency.
    await pgSource.transaction('REPEATABLE READ', async (pgManager) => {
      for (const table of exportTables) {
        const sqliteColsRaw = (await sqliteSource.query(
          `PRAGMA table_info(${quoteIdent(table)})`,
        )) as Array<{ name: string }>;
        const sqliteColSet = new Set(sqliteColsRaw.map((c) => c.name));
        const pgColsRaw = (await pgManager.query(
          'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position',
          [table],
        )) as Array<{ column_name: string }>;
        const commonColumns = pgColsRaw
          .map((c) => c.column_name)
          .filter((col) => sqliteColSet.has(col));
        if (commonColumns.length === 0) continue;

        const colSql = commonColumns.map(quoteIdent).join(', ');
        const rows = (await pgManager.query(`SELECT ${colSql} FROM ${quoteIdent(table)}`)) as Array<
          Record<string, unknown>
        >;
        snapshotData.set(table, { columns: commonColumns, rows });
      }
    });

    await sqliteSource.transaction(async (sqManager) => {
      for (const table of exportTables) {
        const entry = snapshotData.get(table);
        if (!entry) continue;
        await sqManager.query(`DELETE FROM ${quoteIdent(table)}`);
        if (entry.rows.length === 0) continue;
        const colSql = entry.columns.map(quoteIdent).join(', ');
        const placeholders = entry.columns.map(() => '?').join(', ');
        const insertSql = `INSERT INTO ${quoteIdent(table)} (${colSql}) VALUES (${placeholders})`;
        for (const row of entry.rows) {
          const values = entry.columns.map((col) => toSqliteBindValue(row[col]));
          await sqManager.query(insertSql, values);
        }
      }
    });
  } finally {
    await sqliteSource.destroy();
  }
}
