/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  archiveEvent,
  RecordingCache,
  archiveRecovery,
  PLAYBACK_VERSION,
  RecordingStore,
  type ArchiveNodeHealth,
} from '../../src/events/index.js';
import { openCatalog } from '../../src/storage/source.js';
import { Transactions } from '../../src/storage/transactions.js';
import { RetentionCatalog } from '../../src/storage/retention/catalog.js';

describe('recording cache eviction and archive recovery', () => {
  it('requires a verified remote backup snapshot at or above archiveGeneration before granting recovery', async () => {
    const blobs = new Map<string, Buffer>();
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      if (req.method === 'POST' && url.endsWith('/verify')) {
        const digest = url.slice('/v1/blobs/'.length, -'/verify'.length);
        const data = blobs.get(digest);
        if (!data) {
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
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const backupBytes = Buffer.from('encrypted-haus-catalog-snapshot');
      const backupDigest = createHash('sha256').update(backupBytes).digest('hex');
      blobs.set(backupDigest, backupBytes);

      const node = {
        id: 'node-a',
        enabled: true,
        roles: ['storage'],
        url: `http://127.0.0.1:${port}`,
        allowHttp: true,
        key: 'private-recovery-node-signing-key-1234567890',
      };
      const health = new Map<string, ArchiveNodeHealth>([
        [
          node.id,
          {
            online: true,
            lastSeen: Date.now(),
            remote: {
              resources: { pressured: false },
              storage: { verification: { supported: true } },
            },
          },
        ],
      ]);

      let hasBackupLocation = false;
      let unpinned = 0;
      const cluster = {
        store: {
          archiveGeneration: async () => 5,
        },
        abort: new AbortController(),
        health,
        backups: {
          list: () => [],
          retry: () => null,
          canSnapshot: () => true,
          snapshot: async () => ({
            kind: 'haus',
            available: true,
            archiveGeneration: 5,
            digest: backupDigest,
            bytes: backupBytes.length,
          }),
          path: (digest: string) => `/tmp/${digest}.backup`,
        },
        catalog: {
          hasLocation: () => hasBackupLocation,
        },
        nodes: () => [node],
        pinBlob: async () => () => {
          unpinned += 1;
        },
        replicate: async () => {},
      };

      // Without catalog location on the node, recovery is denied and pins are released
      expect(await archiveRecovery(cluster)).toBeNull();
      expect(unpinned).toBe(1);

      // With catalog location and verified remote blob, recovery is granted
      hasBackupLocation = true;
      const grant = await archiveRecovery(cluster);
      expect(grant).not.toBeNull();
      expect(grant?.generation).toBe(5);
      expect(grant?.nodes.has(node.id)).toBe(true);
      grant?.release();
      expect(unpinned).toBe(2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('evicts local original and prepared files only when a single healthy node holds all verified variants and policy/generation remain stable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-cache-evict-'));
    const blobs = new Map<string, Buffer>();
    let revokingPolicyDuringVerify = false;

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
        if (revokingPolicyDuringVerify) {
          config.max_storage_gb = 0;
        }
        if (!data) {
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
      if (req.method === 'POST' && url === '/v1/recordings') {
        res.writeHead(201, { 'content-type': 'application/json' }).end('{"saved":true}');
        return;
      }
      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const media = join(root, 'media');
    await mkdir(media, { recursive: true });
    const source = await openCatalog(join(root, 'haus.sqlite'));
    const transactions = new Transactions(source);
    const store = new RecordingStore(source, media, transactions);
    const retention = new RetentionCatalog(transactions);
    const config = { max_storage_gb: 0.000001 };

    try {
      const backupBytes = Buffer.from('snapshot-bytes');
      const backupDigest = createHash('sha256').update(backupBytes).digest('hex');
      blobs.set(backupDigest, backupBytes);

      const node = {
        id: 'node-1',
        enabled: true,
        roles: ['storage'],
        url: `http://127.0.0.1:${port}`,
        allowHttp: true,
        key: 'private-cache-evict-node-signing-key-123456',
      };
      const health = new Map<string, ArchiveNodeHealth>([
        [
          node.id,
          {
            online: true,
            lastSeen: Date.now(),
            remote: {
              resources: { pressured: false },
              storage: { verification: { supported: true } },
            },
          },
        ],
      ]);

      const cluster = {
        store,
        abort: new AbortController(),
        health,
        errors: new Map<string, string>(),
        catalog: {
          hasLocation: () => true,
          saveArchiveLocation: async () => {},
        },
        backups: {
          list: () => [
            {
              kind: 'haus',
              available: true,
              archiveGeneration: 100,
              digest: backupDigest,
              bytes: backupBytes.length,
            },
          ],
          retry: () => null,
          canSnapshot: () => true,
          snapshot: async () => null,
          path: (digest: string) => join(root, digest),
          markChanged: () => {},
        },
        nodes: () => [node],
        pinBlob: async () => () => {},
        replicate: async () => {},
      };

      const item = await store.create('camera.front', 'motion', 1000, 3000);
      const originalBytes = Buffer.alloc(4096, 0x41);
      const preparedBytes = Buffer.alloc(2048, 0x42);
      await writeFile(store.path(item.id, 'mp4'), originalBytes);
      await writeFile(store.path(item.id, 'playback.mp4'), preparedBytes);
      await store.finish(item.id, {
        duration: 2,
        bytes: originalBytes.length,
        playbackVersion: PLAYBACK_VERSION,
      });
      await store.setPlayback(item.id, preparedBytes.length, PLAYBACK_VERSION);

      expect(await archiveEvent(cluster, item.id)).toBe(true);

      const cache = new RecordingCache(config, store, cluster, retention);

      // If policy is revoked mid-verification, local files remain untouched
      revokingPolicyDuringVerify = true;
      expect(await cache.trim()).toBe(0);
      expect(
        await stat(store.path(item.id, 'mp4')).then(
          () => true,
          () => false,
        ),
      ).toBe(true);

      // Restore policy and run eviction cleanly
      revokingPolicyDuringVerify = false;
      config.max_storage_gb = 0.000001;
      const freed = await cache.trim();
      expect(freed).toBe(originalBytes.length + preparedBytes.length);
      expect(
        await stat(store.path(item.id, 'mp4')).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
      expect(
        await stat(store.path(item.id, 'playback.mp4')).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
      const updated = await store.get(item.id);
      expect(updated?.localOriginal).toBe(false);
      expect(updated?.localPlayback).toBe(false);
    } finally {
      await store.close();
      await transactions.drain();
      if (source.isInitialized) await source.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
