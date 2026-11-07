/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Table, TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

const recordingIndexes = [
  new TableIndex({ name: 'recordings_time', columnNames: ['start_at', 'id'] }),
  new TableIndex({ name: 'recordings_digest', columnNames: ['digest'] }),
];
const eventIndexes = [
  new TableIndex({ name: 'camera_activity_event_state', columnNames: ['state', 'acknowledged'] }),
  new TableIndex({ name: 'camera_activity_event_sequence', columnNames: ['sequence'] }),
];

/** Adds ORM-managed NVR tables and the sequence column without rewriting legacy rows. */
export class NvrRecordings1793950000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!(await runner.hasTable('recordings')))
      await runner.createTable(
        new Table({
          name: 'recordings',
          columns: [
            { name: 'id', type: 'text', isPrimary: true },
            { name: 'digest', type: 'text' },
            { name: 'start_at', type: 'integer' },
            { name: 'value', type: 'text' },
          ],
        }),
      );
    for (const index of recordingIndexes) {
      const table = await runner.getTable('recordings');
      if (!table?.indices.some((candidate) => candidate.name === index.name))
        await runner.createIndex('recordings', index);
    }

    if (!(await runner.hasTable('camera_recording_outbox')))
      await runner.createTable(
        new Table({
          name: 'camera_recording_outbox',
          columns: [
            { name: 'sequence', type: 'integer', isPrimary: true, isGenerated: true },
            { name: 'id', type: 'text', isUnique: true },
            { name: 'value', type: 'text' },
            { name: 'archived', type: 'integer', default: 0 },
            { name: 'acknowledged', type: 'integer', default: 0 },
          ],
        }),
      );

    if (!(await runner.hasTable('camera_activity_events')))
      await runner.createTable(
        new Table({
          name: 'camera_activity_events',
          columns: [
            { name: 'sequence', type: 'integer' },
            { name: 'id', type: 'text', isPrimary: true },
            { name: 'value', type: 'text' },
            { name: 'state', type: 'text' },
            { name: 'error', type: 'text', isNullable: true },
            { name: 'acknowledged', type: 'integer', default: 0 },
          ],
        }),
      );
    else if (!(await runner.hasColumn('camera_activity_events', 'sequence'))) {
      await runner.addColumn(
        'camera_activity_events',
        new TableColumn({
          name: 'sequence',
          type: 'integer',
          isNullable: true,
        }),
      );
      await runner.query('UPDATE camera_activity_events SET sequence=rowid WHERE sequence IS NULL');
    }
    for (const index of eventIndexes) {
      const table = await runner.getTable('camera_activity_events');
      if (!table?.indices.some((candidate) => candidate.name === index.name))
        await runner.createIndex('camera_activity_events', index);
    }

    if (!(await runner.hasTable('camera_activity_requests')))
      await runner.createTable(
        new Table({
          name: 'camera_activity_requests',
          columns: [
            { name: 'camera_id', type: 'text', isPrimary: true },
            { name: 'policy_id', type: 'text', isPrimary: true },
            { name: 'request_id', type: 'text', isPrimary: true },
            { name: 'event_id', type: 'text' },
            { name: 'created_at', type: 'integer' },
          ],
        }),
      );
    const requestTable = await runner.getTable('camera_activity_requests');
    if (
      !requestTable?.indices.some((candidate) => candidate.name === 'camera_activity_request_time')
    )
      await runner.createIndex(
        'camera_activity_requests',
        new TableIndex({ name: 'camera_activity_request_time', columnNames: ['created_at'] }),
      );
  }

  async down(): Promise<void> {
    throw Error('nvr_recordings_rollback_requires_explicit_data_migration');
  }
}
