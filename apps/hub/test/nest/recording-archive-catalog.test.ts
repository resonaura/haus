/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { RecordingStore } from '../../src/events/recording.store.js';
import { openCatalog } from '../../src/storage/source.js';
import { Transactions } from '../../src/storage/transactions.js';
import { EventArchiveEntity, EventArchiveLocationEntity } from '../../src/events/recording.entities.js';

describe('TypeORM recording archive catalog', () => {
  let directory: string | undefined;
  let store: RecordingStore | undefined;
  let transactions: Transactions | undefined;
  let source: Awaited<ReturnType<typeof openCatalog>> | undefined;

  afterEach(async () => {
    await store?.close();
    await transactions?.drain();
    if (source?.isInitialized) await source.destroy();
    store = undefined;
    transactions = undefined;
    source = undefined;
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('persists archive descriptors and locations, pages pending work, and prunes orphan rows', async () => {
    directory = await mkdtemp(join(tmpdir(), 'haus-recording-archive-'));
    source = await openCatalog(join(directory, 'haus.sqlite'));
    transactions = new Transactions(source);
    store = new RecordingStore(source, join(directory, 'media'), transactions);
    const event = await store.create('camera.garage', 'motion', 1000, 2000);
    await store.finish(event.id, { status: 'ready', bytes: 512, playbackVersion: 4 });
    const before = await store.archiveGeneration();

    await store.archive.saveDescriptor({
      eventId: event.id,
      variant: 'original',
      digest: 'original-digest',
      bytes: 512,
      version: 0,
    });
    await store.archive.saveLocation({
      eventId: event.id,
      variant: 'original',
      digest: 'original-digest',
      bytes: 512,
      version: 0,
      nodeId: 'node-a',
      verifiedAt: 2500,
    });

    expect(await store.archiveGeneration()).toBe(before + 2);
    expect(await store.archive.descriptor(event.id, 'original', 0)).toMatchObject({
      digest: 'original-digest',
      bytes: 512,
    });
    expect(await store.archive.hasVerifiedLocation(event.id, 'original', 0)).toBe(true);
    expect(await store.archive.locations(event.id, 'original', 'original-digest', 0)).toEqual([
      expect.objectContaining({ nodeId: 'node-a', verifiedAt: 2500 }),
    ]);
    expect(await store.archive.digestsForExistingEvents()).toEqual(['original-digest']);
    expect(await store.archive.metadataPage(0)).toEqual([
      expect.objectContaining({ eventId: event.id, nodeId: 'node-a', digest: 'original-digest' }),
    ]);
    expect(
      await store.archive.pendingCandidates({
        nodeIds: ['node-a'],
        copies: 1,
        playbackVersion: 4,
        originalPolicyVersion: 1,
      }),
    ).toEqual([]);

    await store.source.manager.insert(EventArchiveEntity, {
      eventId: 'missing-event',
      variant: 'original',
      digest: 'orphan-digest',
      bytes: 1,
      version: 0,
    });
    await store.source.manager.insert(EventArchiveLocationEntity, {
      eventId: 'missing-event',
      variant: 'original',
      digest: 'orphan-digest',
      bytes: 1,
      version: 0,
      nodeId: 'node-z',
      verifiedAt: 1,
    });
    await store.archive.pruneOrphans();
    expect(await store.source.manager.count(EventArchiveEntity)).toBe(1);
    expect(await store.source.manager.count(EventArchiveLocationEntity)).toBe(1);
  });
});
