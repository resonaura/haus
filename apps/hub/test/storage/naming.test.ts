/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { openCatalog } from '../../src/storage/source.js';
import { openVault } from '../../src/storage/vault/source.js';
import { openRecordings } from '../../src/storage/recordings/source.js';
import { openRecordingSource } from '../../src/events/recording.source.js';
import { openStatsSource } from '../../src/stats/stats.source.js';

it.each([
  ['catalog', openCatalog],
  ['vault', openVault],
  ['nvr', openRecordings],
  ['events', openRecordingSource],
  ['statistics', openStatsSource],
] as const)(
  '%s uses snake_case physical tables and columns with valid foreign keys',
  async (_name, open) => {
    const source = await open(':memory:');
    const runner = source.createQueryRunner();
    try {
      const tables = await runner.getTables();
      expect(tables.length).toBeGreaterThan(0);
      for (const table of tables) {
        expect(table.name).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
        for (const column of table.columns)
          expect(column.name, `${table.name}.${column.name}`).toMatch(
            /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/,
          );
      }
      expect(await runner.query('PRAGMA foreign_key_check')).toEqual([]);
    } finally {
      await runner.release();
      await source.destroy();
    }
  },
);
