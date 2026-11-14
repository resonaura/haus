/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { openCatalog } from '../../src/storage/source.js';
import { MqttRetainedEntity } from '../../src/storage/mqtt/entities.js';
import { parseDiscoveryClaims } from '@haus/mqtt';

let source: DataSource | undefined;
let directory: string | undefined;
afterEach(async () => {
  if (source?.isInitialized) await source.destroy();
  if (directory) await rm(directory, { recursive: true, force: true });
  source = undefined;
  directory = undefined;
});

it('backfills active identities for an older multi-level-prefixed retained catalog', async () => {
  directory = await mkdtemp(join(tmpdir(), 'haus-mqtt-claims-migration-'));
  const path = join(directory, 'catalog.sqlite');
  source = await openCatalog(path);
  while (
    (
      (await source.query(
        "SELECT name FROM haus_platform_migrations WHERE name = 'MqttClaims1794239000000'",
      )) as Array<{ name: string }>
    ).length > 0
  ) {
    await source.undoLastMigration({ transaction: 'all' });
  }
  const topic = 'floor/house/ha/device/panel/config';
  const discovery = JSON.stringify({
    dev: { ids: ['panel'] },
    cmps: {
      relay: { p: 'switch', unique_id: 'relay' },
      old: { p: 'sensor' },
    },
  });
  await source.query(
    'INSERT INTO mqtt_retained(topic, payload, qos, revision, discovery, discovery_revision) VALUES (?, ?, ?, ?, ?, ?)',
    [topic, Buffer.from(discovery), 1, 4, discovery, 3],
  );
  await source.runMigrations({ transaction: 'all' });
  const row = await source.manager.findOneBy(MqttRetainedEntity, { topic });
  expect(parseDiscoveryClaims(row?.discoveryClaims ?? 'invalid')).toEqual([
    { kind: 'device', device: 'panel' },
    { kind: 'endpoint', device: 'panel', component: 'switch', uniqueId: 'relay' },
  ]);
});
