/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { Table, type MigrationInterface, type QueryRunner } from 'typeorm';
import { MqttRetainedEntity } from './entities.js';

export class MqttRetention1794220000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.createTable(
      new Table({
        name: 'mqtt_retained',
        columns: [
          { name: 'topic', type: 'text', isPrimary: true },
          { name: 'payload', type: 'blob' },
          { name: 'qos', type: 'integer' },
          { name: 'revision', type: 'integer' },
          { name: 'discovery', type: 'text', isNullable: true },
          { name: 'discovery_revision', type: 'integer', isNullable: true },
        ],
      }),
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    if (await runner.manager.countBy(MqttRetainedEntity, {}))
      throw Error('mqtt_retention_rollback_requires_data_export');
    await runner.dropTable('mqtt_retained');
  }
}
