/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { TableColumn, type MigrationInterface, type QueryRunner } from 'typeorm';
import { DiscoveryTopics, discoveryClaims } from '@haus/mqtt';
import { MqttRetainedEntity } from './entities.js';

export class MqttClaims1794239000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.addColumn(
      'mqtt_retained',
      new TableColumn({ name: 'discovery_claims', type: 'text', default: "'[]'" }),
    );
    for (const row of await runner.manager.find(MqttRetainedEntity)) {
      if (!row.discovery) continue;
      // Recover only unambiguous protocol paths; old tombstones contain no lost identity evidence.
      const parts = row.topic.split('/');
      const prefix = parts.slice(0, -3).join('/');
      const topic = prefix ? new DiscoveryTopics([prefix]).parse(row.topic) : undefined;
      if (topic)
        await runner.manager.update(
          MqttRetainedEntity,
          { topic: row.topic },
          { discoveryClaims: JSON.stringify(discoveryClaims(topic, row.discovery)) },
        );
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    if (await runner.manager.countBy(MqttRetainedEntity, {}))
      throw Error('mqtt_retention_rollback_requires_data_export');
    await runner.dropColumn('mqtt_retained', 'discovery_claims');
  }
}
