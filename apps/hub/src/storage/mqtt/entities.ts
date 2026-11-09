/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { EntitySchema } from 'typeorm';
import type { MqttQos } from '@haus/mqtt';

export interface MqttRetainedRow {
  topic: string;
  payload: Buffer;
  qos: MqttQos;
  revision: number;
  discovery: string | null;
  discoveryRevision: number | null;
}

export const MqttRetainedEntity = new EntitySchema<MqttRetainedRow>({
  name: 'MqttRetained',
  tableName: 'mqtt_retained',
  columns: {
    topic: { type: 'text', primary: true },
    payload: { type: 'blob' },
    qos: { type: 'integer' },
    revision: { type: 'integer' },
    discovery: { type: 'text', nullable: true },
    discoveryRevision: { type: 'integer', nullable: true, name: 'discovery_revision' },
  },
});
