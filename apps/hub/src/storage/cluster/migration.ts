/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Table, type MigrationInterface, type QueryRunner } from 'typeorm';

/** Adds persistent TypeORM tables for multi-Hub coordination, leases, peer keys, transfers, and encrypted sync state. */
export class ClusterCoordination1794700000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const tables = [
      new Table({
        name: 'cluster_state',
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'hub_id', type: 'text' },
          { name: 'home_id', type: 'text' },
          { name: 'role', type: 'text' },
          { name: 'coordinator_epoch', type: 'integer', default: 1 },
          { name: 'coordinator_id', type: 'text' },
          { name: 'coordinator_url', type: 'text', isNullable: true },
          { name: 'fenced', type: 'boolean', default: false },
          { name: 'fenced_reason', type: 'text', isNullable: true },
          { name: 'updated_at', type: 'integer' },
        ],
      }),
      new Table({
        name: 'cluster_peer_keys',
        columns: [
          { name: 'hub_id', type: 'text', isPrimary: true },
          { name: 'home_id', type: 'text' },
          { name: 'signing_public_key', type: 'text' },
          { name: 'exchange_public_key', type: 'text' },
          { name: 'channel_secret_enc', type: 'text' },
          { name: 'key_version', type: 'integer', default: 1 },
          { name: 'revoked', type: 'boolean', default: false },
          { name: 'updated_at', type: 'integer' },
        ],
      }),
      new Table({
        name: 'cluster_workloads',
        columns: [
          { name: 'workload_id', type: 'text', isPrimary: true },
          { name: 'kind', type: 'text' },
          { name: 'name', type: 'text' },
          { name: 'owner_hub_id', type: 'text' },
          { name: 'standby_hub_ids_json', type: 'text', default: "'[]'" },
          { name: 'generation', type: 'integer', default: 1 },
          { name: 'epoch', type: 'integer', default: 1 },
          { name: 'state', type: 'text', default: "'active'" },
          { name: 'lease_expires_at', type: 'integer', default: 0 },
          { name: 'config_revision', type: 'integer', default: 1 },
          { name: 'credential_revision', type: 'integer', default: 1 },
          { name: 'cache_revision', type: 'integer', default: 1 },
          { name: 'requirements_json', type: 'text', default: "'{}'" },
          { name: 'preferred_hub_id', type: 'text', isNullable: true },
          { name: 'updated_at', type: 'integer' },
        ],
      }),
      new Table({
        name: 'cluster_transfers',
        columns: [
          { name: 'transfer_id', type: 'text', isPrimary: true },
          { name: 'source_hub_id', type: 'text' },
          { name: 'target_hub_id', type: 'text' },
          { name: 'state', type: 'text' },
          { name: 'epoch', type: 'integer' },
          { name: 'preserve_pairing', type: 'boolean', default: true },
          { name: 'summary_json', type: 'text' },
          { name: 'reason', type: 'text', isNullable: true },
          { name: 'created_at', type: 'integer' },
          { name: 'updated_at', type: 'integer' },
        ],
      }),
      new Table({
        name: 'cluster_sync_state',
        columns: [
          { name: 'sync_key', type: 'text', isPrimary: true },
          { name: 'kind', type: 'text' },
          { name: 'resource_id', type: 'text' },
          { name: 'revision', type: 'integer', default: 1 },
          { name: 'generation', type: 'integer', default: 1 },
          { name: 'epoch', type: 'integer', default: 1 },
          { name: 'sha256', type: 'text' },
          { name: 'source_hub_id', type: 'text' },
          { name: 'updated_at', type: 'integer' },
        ],
      }),
    ];

    for (const table of tables) {
      if (!(await runner.hasTable(table.name))) {
        await runner.createTable(table);
      }
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    const tableNames = [
      'cluster_sync_state',
      'cluster_transfers',
      'cluster_workloads',
      'cluster_peer_keys',
      'cluster_state',
    ] as const;

    for (const table of tableNames) {
      if (!(await runner.hasTable(table))) continue;
      const rows = (await runner.query(`SELECT 1 AS present FROM "${table}" LIMIT 1`)) as Array<{
        present: number;
      }>;
      if (rows.length > 0) {
        throw Error('cluster_coordination_rollback_requires_explicit_data_migration');
      }
    }

    for (const table of tableNames) {
      if (await runner.hasTable(table)) {
        await runner.dropTable(table);
      }
    }
  }
}
