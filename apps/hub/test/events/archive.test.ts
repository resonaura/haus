/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  archiveEvent,
  archiveNodes,
  archivePending,
  archivedMedia,
  archivedVariants,
  variantExtension,
  verifyArchivedBlob,
  type ArchiveNodeHealth,
} from '../../src/events/archive/archive.js';
import {
  archiveStorageMetadata,
  refreshArchiveStorageMetadata,
} from '../../src/events/archive/metadata.js';
import { PLAYBACK_VERSION } from '../../src/events/playback.js';
import { RecordingStore } from '../../src/events/recording.store.js';
import { openCatalog } from '../../src/storage/source.js';
import { Transactions } from '../../src/storage/transactions.js';

async function openTestStore(root: string): Promise<{
  store: RecordingStore;
  close: () => Promise<void>;
}> {
  const media = join(root, 'media');
  await mkdir(media, { recursive: true });
  const source = await openCatalog(join(root, 'events.sqlite'));
  const transactions = new Transactions(source);
  const store = new RecordingStore(source, media, transactions);
  return {
    store,
    close: async () => {
      await store.close();
      await transactions.drain();
      if (source.isInitialized) await source.destroy();
    },
  };
}

describe('recording archive and storage metadata', () => {
  it('archives only to fresh, verified storage nodes that are not pressured', () => {
    const now = 100_000;
    const nodes = [
      { id: 'busy', enabled: true, roles: ['storage'] },
      { id: 'clear', enabled: true, roles: ['storage'] },
      { id: 'unknown', enabled: true, roles: ['storage'] },
      { id: 'offline', enabled: true, roles: ['storage'] },
      { id: 'unverified', enabled: true, roles: ['storage'] },
    ];
    const health = new Map<string, ArchiveNodeHealth>(
      nodes.map((node) => [
        node.id,
        {
          online: node.id !== 'offline',
          lastSeen: now - 1000,
          remote: {
            resources: node.id === 'unknown' ? undefined : { pressured: node.id === 'busy' },
            storage: {
              verification: { supported: node.id !== 'unverified' },
            },
          },
        },
      ]),
    );
    const cluster = { nodes: () => nodes, health };

    expect(archiveNodes(cluster, now).map(({ id }) => id)).toEqual(['clear', 'unknown']);

    const clearHealth = health.get('clear');
    expect(clearHealth?.remote?.resources).toBeDefined();
    health.set('clear', {
      ...clearHealth,
      remote: {
        ...clearHealth?.remote,
        resources: { pressured: true },
      },
    });
    expect(archiveNodes(cluster, now).map(({ id }) => id)).toEqual(['unknown']);

    const unknownHealth = health.get('unknown');
    health.set('unknown', {
      ...unknownHealth,
      remote: {
        ...unknownHealth?.remote,
        resources: { pressured: true },
      },
    });
    expect(archiveNodes(cluster, now)).toEqual([]);
  });

  it('maps variant extensions and resolves archived variants by playbackBytes', async () => {
    expect(variantExtension('original')).toBe('mp4');
    expect(variantExtension('prepared')).toBe('playback.mp4');

    const root = await mkdtemp(join(tmpdir(), 'haus-archive-variants-'));
    try {
      const { store, close } = await openTestStore(root);
      try {
        const event = await store.create('camera.front', 'motion', 1000, 2000);
        await store.finish(event.id, {
          duration: 10,
          bytes: 120,
          playbackVersion: PLAYBACK_VERSION,
        });
        await store.setPlayback(event.id, 80, PLAYBACK_VERSION);
        await store.archive.saveDescriptor({
          eventId: event.id,
          variant: 'original',
          digest: 'a'.repeat(64),
          bytes: 120,
          version: 0,
        });
        await store.archive.saveDescriptor({
          eventId: event.id,
          variant: 'prepared',
          digest: 'b'.repeat(64),
          bytes: 80,
          version: PLAYBACK_VERSION,
        });
        const ready = await store.get(event.id);
        expect(ready).not.toBeNull();
        const variants = await archivedVariants(store, ready!);
        expect(variants.map((item) => item?.digest)).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
      } finally {
        await close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uploads, verifies, serves range requests, and repairs storage metadata in bounded batches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-archive-flow-'));
    const blobs = new Map<string, Buffer>();
    const posted: Array<Record<string, unknown>> = [];
    let failVerify = false;
    let failPost = false;

    const server = createServer(async (req, res) => {
      const url = req.url ?? '';
      if (req.method === 'HEAD' && url.startsWith('/v1/blobs/')) {
        const digest = url.slice('/v1/blobs/'.length);
        const data = blobs.get(digest);
        if (!data) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'content-length': String(data.length) }).end();
        return;
      }
      if (req.method === 'PUT' && url.startsWith('/v1/blobs/')) {
        const digest = url.slice('/v1/blobs/'.length);
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array));
        blobs.set(digest, Buffer.concat(chunks));
        res.writeHead(201).end();
        return;
      }
      if (req.method === 'POST' && url.endsWith('/verify')) {
        const digest = url.slice('/v1/blobs/'.length, -'/verify'.length);
        const data = blobs.get(digest);
        if (failVerify || !data) {
          res
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify({ verified: false }));
          return;
        }
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ verified: true, digest, bytes: data.length }));
        return;
      }
      if (req.method === 'GET' && url.startsWith('/v1/blobs/')) {
        const digest = url.slice('/v1/blobs/'.length);
        const data = blobs.get(digest);
        if (!data) {
          res.writeHead(404).end();
          return;
        }
        const range = req.headers.range;
        if (range === 'bytes=0-3') {
          res
            .writeHead(206, {
              'content-length': '4',
              'content-range': `bytes 0-3/${data.length}`,
            })
            .end(data.subarray(0, 4));
          return;
        }
        res.writeHead(200, { 'content-length': String(data.length) }).end(data);
        return;
      }
      if (req.method === 'POST' && url === '/v1/recordings') {
        if (failPost) {
          res.writeHead(503).end();
          return;
        }
        let body = '';
        for await (const chunk of req) body += String(chunk);
        posted.push(JSON.parse(body) as Record<string, unknown>);
        res.writeHead(201, { 'content-type': 'application/json' }).end('{"saved":true}');
        return;
      }
      res.writeHead(400).end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const { store, close } = await openTestStore(root);

    try {
      const node = {
        id: 'node-1',
        enabled: true,
        roles: ['storage'],
        url: `http://127.0.0.1:${port}`,
        allowHttp: true,
        key: 'private-archive-node-signing-key-1234567890',
      };
      const health = new Map<string, ArchiveNodeHealth>([
        [
          node.id,
          {
            online: true,
            lastSeen: Date.now(),
            remote: {
              resources: { pressured: false },
              storage: {
                verification: { supported: true },
                usage: { version: 1 },
              },
            },
          },
        ],
      ]);
      const locations = new Map<string, { metadataHash?: string | null }>();
      let backupChanged = 0;
      const cluster = {
        store,
        abort: new AbortController(),
        health,
        errors: new Map<string, string>(),
        catalog: {
          location: (digest: string, nodeId: string) => locations.get(`${digest}:${nodeId}`),
          saveArchiveLocation: async (digest: string, nodeId: string, metadataHash?: string) => {
            locations.set(`${digest}:${nodeId}`, { metadataHash: metadataHash ?? null });
          },
        },
        backups: {
          markChanged: () => {
            backupChanged += 1;
          },
        },
        archiveCursor: undefined as { at: number; id: string } | undefined,
        storageMetadataCursor: 0,
        nodes: () => [node],
        pinBlob: async () => () => {},
      };

      const item = await store.create('camera.front', 'motion', 5000, 7000);
      const originalBytes = Buffer.from('original-video-payload');
      const preparedBytes = Buffer.from('prepared-video-payload');
      await writeFile(store.path(item.id, 'mp4'), originalBytes);
      await writeFile(store.path(item.id, 'playback.mp4'), preparedBytes);
      await store.finish(item.id, {
        duration: 2,
        bytes: originalBytes.length,
        playbackVersion: PLAYBACK_VERSION,
      });
      await store.setPlayback(item.id, preparedBytes.length, PLAYBACK_VERSION);

      failVerify = true;
      expect(await archiveEvent(cluster, item.id)).toBe(false);
      expect(cluster.errors.get(node.id)).toBe('Archive pending · local recording kept');

      failVerify = false;
      await archivePending(cluster);
      expect(cluster.errors.has(node.id)).toBe(false);
      expect(backupChanged).toBeGreaterThan(0);
      expect(posted.length).toBe(1);
      expect(posted[0]?.variant).toBe('prepared');
      expect(posted[0]?.originalDigest).toBe(
        createHash('sha256').update(originalBytes).digest('hex'),
      );

      const current = await store.get(item.id);
      expect(current).not.toBeNull();
      const metadata = await archiveStorageMetadata(
        store,
        current!,
        createHash('sha256').update(preparedBytes).digest('hex'),
      );
      expect(metadata.variant).toBe('prepared');

      const remoteMedia = await archivedMedia(cluster, current!, 'prepared', 'bytes=0-3');
      expect(remoteMedia).not.toBeNull();
      expect(remoteMedia?.response.status).toBe(206);
      expect(Buffer.from(await remoteMedia!.response.arrayBuffer()).toString('utf8')).toBe('prep');
      remoteMedia?.release();

      // Verify refreshArchiveStorageMetadata skips on failure and coalesces identical hashes
      failPost = true;
      cluster.storageMetadataCursor = 0;
      await refreshArchiveStorageMetadata(cluster);
      expect(posted.length).toBe(1);

      failPost = false;
      cluster.storageMetadataCursor = 0;
      await refreshArchiveStorageMetadata(cluster);
      expect(posted.length).toBe(2);
      cluster.storageMetadataCursor = 0;
      await refreshArchiveStorageMetadata(cluster);
      expect(posted.length).toBe(2);

      // Direct verifyArchivedBlob throws when remote verification fails
      failVerify = true;
      await expect(
        verifyArchivedBlob(cluster, node, {
          digest: createHash('sha256').update(preparedBytes).digest('hex'),
          bytes: preparedBytes.length,
        }),
      ).rejects.toThrow('archive_verification_failed');
    } finally {
      await close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
