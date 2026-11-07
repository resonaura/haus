/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { openCatalog } from '../../src/storage/source.js';
import { Transactions } from '../../src/storage/transactions.js';
import { RetentionCatalog } from '../../src/storage/retention/catalog.js';
import { PreparationAttemptEntity } from '../../src/storage/retention/entities.js';
import { openRecordingSource } from '../../src/events/recording.source.js';
import {
  RecordingEventEntity,
  EventArchiveLocationEntity,
} from '../../src/events/recording.entities.js';

describe('Preparation and retention TypeORM persistence', () => {
  let root: string;
  let source: DataSource | undefined;
  let transactions: Transactions | undefined;

  afterEach(async () => {
    await transactions?.drain();
    if (source?.isInitialized) await source.destroy();
    transactions = undefined;
    source = undefined;
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function fixture() {
    root = await mkdtemp(join(tmpdir(), 'haus-retention-'));
    const path = join(root, 'haus.sqlite');
    const recordings = await openRecordingSource(path);
    await recordings.destroy();
    source = await openCatalog(path);
    transactions = new Transactions(source);
    return { source, catalog: new RetentionCatalog(transactions), path };
  }

  it('adopts legacy retry deadlines and preserves them across reopening', async () => {
    root = await mkdtemp(join(tmpdir(), 'haus-retention-upgrade-'));
    const path = join(root, 'haus.sqlite');
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE background_preparation_attempts(event_id TEXT PRIMARY KEY,next_at INTEGER NOT NULL);
      INSERT INTO background_preparation_attempts VALUES ('pending-event',900000);`);
    legacy.close();
    source = await openCatalog(path);
    expect(await source.manager.find(PreparationAttemptEntity)).toEqual([
      { eventId: 'pending-event', nextAt: 900000 },
    ]);
    await source.destroy();
    source = await openCatalog(path);
    expect(
      await source.manager.findOneBy(PreparationAttemptEntity, { eventId: 'pending-event' }),
    ).toEqual({ eventId: 'pending-event', nextAt: 900000 });
  });

  it('orders unattempted footage first and prunes only obsolete retry metadata', async () => {
    const { source, catalog } = await fixture();
    for (const [id, startAt, extra] of [
      ['new', 100, {}],
      ['old', 10, {}],
      [
        'repair',
        80,
        {
          playbackVersion: 4,
          playbackInfo: '{"originalCompatible":true,"originalPolicyVersion":0}',
        },
      ],
      ['prepared', 120, { playbackVersion: 4, playbackBytes: 100 }],
      ['archived', 90, { localOriginal: false }],
    ] as const) {
      await source.manager.insert(RecordingEventEntity, {
        id,
        startAt,
        endAt: startAt + 1,
        cameraId: 'camera.fixture',
        status: 'ready',
        kinds: '[]',
        detections: '[]',
        ...extra,
      });
    }
    await catalog.deferPreparation('new', 200);
    await catalog.deferPreparation('prepared', 10);
    await catalog.deferPreparation('archived', 10);
    await catalog.deferPreparation('expired', 10);
    const before = await source.manager.find(RecordingEventEntity);
    expect(await catalog.pendingPreparations(4, 1, 100)).toEqual(['repair', 'old']);
    expect(await catalog.pendingPreparations(4, 1, 300)).toEqual(['repair', 'old', 'new']);
    await catalog.prunePreparations(4, 1);
    expect(await source.manager.find(PreparationAttemptEntity)).toEqual([
      { eventId: 'new', nextAt: 200 },
    ]);
    expect(await source.manager.find(RecordingEventEntity)).toEqual(before);
    await catalog.clearPreparation('new');
    expect(await catalog.pendingPreparations(4, 1, 100)).toEqual(['new', 'repair', 'old']);
  });

  it('keeps eviction pages stable and requires matching copies on one node', async () => {
    const { source, catalog } = await fixture();
    for (let index = 0; index < 65; index++) {
      await source.manager.insert(RecordingEventEntity, {
        id: String(index).padStart(3, '0'),
        cameraId: 'camera.fixture',
        startAt: 100,
        endAt: 101,
        status: 'ready',
        kinds: '[]',
        detections: '[]',
        bytes: 10,
        playbackBytes: 20,
        playbackVersion: 4,
      });
    }
    const page = await catalog.evictionCandidates();
    expect(page).toHaveLength(64);
    expect(await catalog.evictionCandidates({ at: 100, id: '063' })).toEqual([
      { id: '064', startAt: 100 },
    ]);
    const copies = [
      { variant: 'original', digest: 'original-digest', version: 0 },
      { variant: 'prepared', digest: 'prepared-digest', version: 4 },
    ] as const;
    await source.manager.insert(EventArchiveLocationEntity, {
      eventId: '000',
      nodeId: 'node-a',
      ...copies[0],
      bytes: 10,
      verifiedAt: 1,
    });
    await source.manager.insert(EventArchiveLocationEntity, {
      eventId: '000',
      nodeId: 'node-b',
      ...copies[1],
      bytes: 20,
      verifiedAt: 1,
    });
    expect(await catalog.hasArchiveCopies('000', 'node-a', copies)).toBe(false);
    await source.manager.insert(EventArchiveLocationEntity, {
      eventId: '000',
      nodeId: 'node-a',
      ...copies[1],
      bytes: 20,
      verifiedAt: 1,
    });
    expect(await catalog.hasArchiveCopies('000', 'node-a', copies)).toBe(true);
    expect(await catalog.hasArchiveCopies('000', 'node-a', [{ ...copies[1], version: 5 }])).toBe(
      false,
    );
    await catalog.setLocal('000', 'original', false);
    await catalog.setLocal('000', 'prepared', false);
    expect((await catalog.evictionCandidates()).some((row) => row.id === '000')).toBe(false);
    expect(await source.manager.findOneBy(RecordingEventEntity, { id: '000' })).toMatchObject({
      bytes: 10,
      playbackBytes: 20,
      mediaRevision: 0,
      localOriginal: false,
      localPlayback: false,
    });
  });
});
