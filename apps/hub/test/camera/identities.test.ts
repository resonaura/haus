/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { NativeCameraIdentities } from '../../src/camera/identities.js';
import { CameraCatalog, openCatalog, Transactions } from '../../src/storage/index.js';

async function openTestCameraCatalog(database: string) {
  const source = await openCatalog(database);
  const transactions = new Transactions(source);
  const cameraCatalog = new CameraCatalog(transactions);
  await cameraCatalog.initialize();
  return {
    cameraCatalog,
    close: async () => {
      await transactions.drain();
      if (source.isInitialized) await source.destroy();
    },
  };
}

describe('NativeCameraIdentities', () => {
  it('retains recording IDs on native enrollment and leaves events and preferences unchanged', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'haus-native-identities-'));
    const file = join(directory, 'catalog.sqlite');
    let db = new DatabaseSync(file);
    let dbOpen = true;
    const closeDb = () => {
      if (dbOpen) {
        db.close();
        dbOpen = false;
      }
    };
    let owner: Awaited<ReturnType<typeof openTestCameraCatalog>> | undefined;
    try {
      db.exec(
        'CREATE TABLE events(id TEXT PRIMARY KEY,camera_id TEXT,digest TEXT,original_path TEXT);CREATE TABLE settings(id TEXT PRIMARY KEY,value TEXT);',
      );
      for (const id of [
        'camera.outdoor_camera',
        'camera.guinea_pigs_camera',
        'camera.outdoor_side_camera',
        'camera.narnia_camera',
      ]) {
        db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(
          'event:' + id,
          id,
          'sha256:' + id,
          'originals/' + id + '/one.mp4',
        );
        db.prepare('INSERT INTO settings VALUES(?,?)').run(
          id,
          JSON.stringify({ enabled: true, recordAudio: true }),
        );
      }
      const baseline = JSON.stringify({
        events: db
          .prepare('SELECT id, camera_id, digest, original_path FROM events ORDER BY id')
          .all(),
        settings: db.prepare('SELECT * FROM settings ORDER BY id').all(),
      });
      closeDb();
      owner = await openTestCameraCatalog(file);
      const bridgeId = randomUUID();
      let changed = 0;
      const identities = new NativeCameraIdentities(owner.cameraCatalog, () => {
        changed++;
      });
      for (const id of [
        'camera.outdoor_camera',
        'camera.guinea_pigs_camera',
        'camera.outdoor_side_camera',
        'camera.narnia_camera',
      ]) {
        expect(await identities.resolve(bridgeId, 'physical:' + id, id)).toBe(id);
      }
      expect(changed).toBe(4);
      await owner.close();
      owner = undefined;
      db = new DatabaseSync(file);
      dbOpen = true;
      expect(
        JSON.stringify({
          events: db
            .prepare('SELECT id, camera_id, digest, original_path FROM events ORDER BY id')
            .all(),
          settings: db.prepare('SELECT * FROM settings ORDER BY id').all(),
        }),
      ).toBe(baseline);
      closeDb();
      owner = await openTestCameraCatalog(file);
      const reopened = new NativeCameraIdentities(owner.cameraCatalog);
      expect(await reopened.resolve(bridgeId, 'physical:camera.outdoor_camera')).toBe(
        'camera.outdoor_camera',
      );
      await expect(
        reopened.resolve(bridgeId, 'physical:camera.outdoor_camera', 'camera.outdoor_camera_2'),
      ).rejects.toThrow(/identity_conflict/);
      await expect(
        reopened.resolve(randomUUID(), 'different', 'camera.outdoor_camera'),
      ).rejects.toThrow(/identity_conflict/);
      expect(reopened.list(bridgeId).length).toBe(4);
    } finally {
      await owner?.close();
      closeDb();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('assigns durable distinct IDs to new cameras without deriving identity from changing HA display names', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'haus-native-camera-ids-'));
    const owner = await openTestCameraCatalog(join(directory, 'catalog.sqlite'));
    try {
      let changed = 0;
      const identities = new NativeCameraIdentities(owner.cameraCatalog, () => {
        changed++;
      });
      const a = randomUUID();
      const b = randomUUID();
      const id = await identities.resolve(a, 'camera-1');
      expect(id).toMatch(/^camera\.haus_[a-f0-9]{32}$/);
      expect(await identities.resolve(a, 'camera-1')).toBe(id);
      expect(await identities.resolve(a, 'camera-2')).not.toBe(id);
      expect(await identities.resolve(b, 'camera-1')).not.toBe(id);
      expect(changed).toBe(3);
      expect(() => identities.select(a, '../../file')).toThrow(/invalid_native_camera_identity/);
    } finally {
      await owner.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
