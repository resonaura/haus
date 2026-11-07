/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Table, TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds ORM-owned tables used by Hub domains and adopts existing legacy tables in place. */
export class HubDomains1793954000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await this.createTables(runner);
    await this.upgradeClusterLocations(runner);
  }

  async down(): Promise<void> {
    throw Error('hub_domains_rollback_requires_explicit_data_migration');
  }

  private async createTables(runner: QueryRunner): Promise<void> {
    const tables = [
      new Table({
        name: 'shared_config',
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'revision', type: 'text' },
          { name: 'value', type: 'text' },
          { name: 'updated_at', type: 'integer' },
        ],
      }),
      new Table({
        name: 'cluster_nodes',
        columns: [
          { name: 'id', type: 'text', isPrimary: true },
          { name: 'value', type: 'text' },
        ],
      }),
      new Table({
        name: 'cluster_locations',
        columns: [
          { name: 'digest', type: 'text', isPrimary: true },
          { name: 'node_id', type: 'text', isPrimary: true },
          { name: 'kind', type: 'text' },
          { name: 'catalog_version', type: 'integer', default: 0 },
          { name: 'metadata_hash', type: 'text', isNullable: true },
        ],
      }),
      new Table({
        name: 'cluster_media',
        columns: [
          { name: 'event_id', type: 'text', isPrimary: true },
          { name: 'digest', type: 'text' },
          { name: 'bytes', type: 'integer' },
          { name: 'version', type: 'integer' },
        ],
      }),
      new Table({
        name: 'homekit_identities',
        columns: [
          { name: 'camera_id', type: 'text', isPrimary: true },
          { name: 'value', type: 'text' },
        ],
      }),
    ];
    for (const table of tables) {
      if (!(await runner.hasTable(table.name))) await runner.createTable(table);
    }
  }

  private async upgradeClusterLocations(runner: QueryRunner): Promise<void> {
    const table = await runner.getTable('cluster_locations');
    if (!table) throw Error('cluster_locations_table_missing');
    if (!table.columns.some((column) => column.name === 'catalog_version')) {
      await runner.addColumn(
        'cluster_locations',
        new TableColumn({ name: 'catalog_version', type: 'integer', default: 0 }),
      );
    }
    const refreshed = await runner.getTable('cluster_locations');
    if (!refreshed) throw Error('cluster_locations_table_missing');
    if (!refreshed.columns.some((column) => column.name === 'metadata_hash')) {
      await runner.addColumn(
        'cluster_locations',
        new TableColumn({ name: 'metadata_hash', type: 'text', isNullable: true }),
      );
    }
  }
}
