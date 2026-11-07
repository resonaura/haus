/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openCatalog } from '../../src/storage/source.js';
import { Transactions } from '../../src/storage/transactions.js';
import { CameraCatalog } from '../../src/storage/cameras/catalog.js';

describe('TypeORM camera catalog migration', () => {
  let directory: string | undefined;
  let source: Awaited<ReturnType<typeof openCatalog>> | undefined;
  let transactions: Transactions | undefined;

  afterEach(async () => {
    await transactions?.drain();
    if (source?.isInitialized) await source.destroy();
    source = undefined;
    transactions = undefined;
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('adopts existing provider, camera, session, activity and release ownership rows', async () => {
    directory = await mkdtemp(join(tmpdir(), 'haus-camera-upgrade-'));
    const database = join(directory, 'haus.sqlite');
    const legacy = new DatabaseSync(database);
    legacy.exec(`
      CREATE TABLE native_providers(id TEXT PRIMARY KEY,connection TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE native_provider_controller(id INTEGER PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE native_camera_identities(bridge_id TEXT NOT NULL,physical_id TEXT NOT NULL,camera_id TEXT NOT NULL UNIQUE,PRIMARY KEY(bridge_id,physical_id));
      CREATE TABLE native_camera_sources(bridge_id TEXT NOT NULL,physical_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(bridge_id,physical_id));
      CREATE TABLE nvr_camera_assignments(camera_id TEXT PRIMARY KEY,node_id TEXT NOT NULL);
      CREATE TABLE nvr_camera_events(event_id TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE nvr_activity_policies(policy_id TEXT PRIMARY KEY,camera_id TEXT NOT NULL,node_id TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked_at INTEGER);
      CREATE TABLE nvr_activity_releases(policy_id TEXT PRIMARY KEY,camera_id TEXT NOT NULL,node_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE nvr_activity_triggers(request_id TEXT PRIMARY KEY,node_id TEXT NOT NULL,value TEXT NOT NULL,expires_at INTEGER NOT NULL);
      INSERT INTO native_providers VALUES('bridge-1','{"provider":"aqara"}',10);
      INSERT INTO native_provider_controller VALUES(1,'controller-1');
      INSERT INTO native_camera_identities VALUES('bridge-1','physical-1','camera.outdoor');
      INSERT INTO native_camera_sources VALUES('bridge-1','physical-1','{"url":"rtsp://192.168.1.2/live"}');
      INSERT INTO nvr_camera_assignments VALUES('camera.outdoor','node-1');
      INSERT INTO nvr_camera_events VALUES('event-1','{"cameraId":"camera.outdoor"}');
      INSERT INTO nvr_activity_policies VALUES('policy-1','camera.outdoor','node-1',20,300,NULL);
      INSERT INTO nvr_activity_releases VALUES('release-1','camera.old','node-2',400);
      INSERT INTO nvr_activity_triggers VALUES('request-1','node-1','{"requestId":"request-1","policyId":"policy-1"}',250);
    `);
    legacy.close();

    source = await openCatalog(database);
    transactions = new Transactions(source);
    const catalog = new CameraCatalog(transactions);
    await catalog.initialize();

    expect(catalog.native.providers()).toEqual([
      { id: 'bridge-1', connection: '{"provider":"aqara"}', createdAt: 10 },
    ]);
    expect(catalog.native.controllerId).toBe('controller-1');
    expect(catalog.native.identity('bridge-1', 'physical-1')).toEqual({
      bridgeId: 'bridge-1',
      physicalId: 'physical-1',
      cameraId: 'camera.outdoor',
    });
    expect(catalog.native.sources()).toEqual([
      {
        bridgeId: 'bridge-1',
        physicalId: 'physical-1',
        value: '{"url":"rtsp://192.168.1.2/live"}',
      },
    ]);
    expect(catalog.sessions.assignments()).toEqual([
      { cameraId: 'camera.outdoor', nodeId: 'node-1' },
    ]);
    expect(catalog.sessions.events()).toEqual([
      { eventId: 'event-1', value: '{"cameraId":"camera.outdoor"}' },
    ]);
    expect(catalog.activity.active('camera.outdoor')?.policyId).toBe('policy-1');
    expect(catalog.activity.releases('camera.old')).toEqual([
      { policyId: 'release-1', cameraId: 'camera.old', nodeId: 'node-2', expiresAt: 400 },
    ]);
    expect(catalog.activity.triggers()).toEqual([
      {
        requestId: 'request-1',
        nodeId: 'node-1',
        value: '{"requestId":"request-1","policyId":"policy-1"}',
        expiresAt: 250,
      },
    ]);
    const policy = (await source.manager.query(
      "SELECT name FROM pragma_index_list('nvr_activity_policies') WHERE name = 'nvr_activity_camera'",
    )) as Array<{ name: string }>;
    expect(policy).toEqual([{ name: 'nvr_activity_camera' }]);
  });
});
