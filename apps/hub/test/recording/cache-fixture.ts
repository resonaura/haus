/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { listen, port, closeServer } from '../support/http.js';
import { onTestFinished } from 'vitest';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openTestRecordingStore } from '../support/recording.js';
import { defaults } from '@haus/hub/runtime';
import { createCacheTestServer } from './cache-server.js';
import { Backups, BackupCatalog } from '@haus/hub/backup';
import { RetentionCatalog } from '@haus/hub/storage';
import { ServiceCatalog } from '@haus/hub/servers';
import { openTestCatalog, openTestCluster } from '../support/catalog.js';

export interface PostedArchiveRecord {
  digest: string;
  event: {
    playbackVersion: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export const digest = (data: Buffer | string): string =>
  createHash('sha256').update(data).digest('hex');

export async function fixture({
  limit = 100,
  roles = ['storage'],
  supported = true,
}: {
  limit?: number;
  roles?: string[];
  supported?: boolean;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'haus-tier-cache-'));
  const media = join(root, 'media');
  await mkdir(media);
  const store = await openTestRecordingStore(join(root, 'haus.sqlite'), media);
  const blobs = new Map<string, Buffer>();
  const posted: PostedArchiveRecord[] = [];
  const config = {
    ...defaults,
    data: root,
    media,
    max_storage_gb: limit / 1024 ** 3,
    standalone: true,
    apiToken: 'test-token',
  };
  let verification = 'valid';
  let prepareCalls = 0;
  let verifyGate: Promise<void> | undefined;
  let streamGate: Promise<void> | undefined;

  const remote = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://node.invalid');
    const key = url.pathname.split('/')[3] ?? '';
    if (url.pathname === '/v1/status')
      return res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          protocol: 1,
          instanceId: 'fixture',
          nodeId: 'worker',
          storage: {
            availableBytes: 1e9,
            maxBytes: 1e9,
            usedBytes: 0,
            reservedBytes: 0,
            verification: { supported },
          },
          streams: { active: 0, max: 2 },
        }),
      );
    if (req.method === 'POST' && ['/v1/recordings', '/v1/backups'].includes(url.pathname)) {
      let text = '';
      for await (const part of req) text += String(part);
      if (url.pathname === '/v1/recordings') posted.push(JSON.parse(text) as PostedArchiveRecord);
      return res.writeHead(201, { 'content-type': 'application/json' }).end('{}');
    }
    if (req.method === 'PUT') {
      if (verification === 'full') return res.writeHead(507).end();
      const parts: Buffer[] = [];
      for await (const part of req) {
        parts.push(Buffer.isBuffer(part) ? part : Buffer.from(String(part)));
      }
      const bytes = Buffer.concat(parts);
      if (digest(bytes) !== key) return res.writeHead(409).end();
      blobs.set(key, bytes);
      return res.writeHead(201).end();
    }
    if (req.method === 'DELETE') {
      blobs.delete(key);
      return res.writeHead(200).end();
    }
    const data = blobs.get(key);
    if (!data) return res.writeHead(404).end();
    if (req.method === 'POST' && url.pathname.endsWith('/verify')) {
      if (verifyGate && data.toString().startsWith('ORIGINAL')) await verifyGate;
      if (verification === 'missing') return res.writeHead(404).end();
      return res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          digest: verification === 'corrupt' ? '0'.repeat(64) : digest(data),
          bytes: data.length,
          verified:
            verification !== 'unverified' &&
            !(
              verification === 'backup-unverified' &&
              !data.toString().startsWith('ORIGINAL') &&
              !data.toString().startsWith('PREPARED')
            ) &&
            !(verification === 'prepared-unverified' && data.toString().startsWith('PREPARED')),
        }),
      );
    }
    let start = 0;
    let end = data.length - 1;
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
    if (range) {
      start = Number(range[1]);
      end = range[2] ? Number(range[2]) : end;
    }
    const headers: Record<string, string | number> = {
      'content-length': end - start + 1,
      'accept-ranges': 'bytes',
    };
    if (range) headers['content-range'] = `bytes ${start}-${end}/${data.length}`;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === 'GET' && streamGate) {
      res.flushHeaders();
      await streamGate;
    }
    res.end(req.method === 'HEAD' ? undefined : data.subarray(start, end + 1));
  });

  await listen(remote);
  const catalogOwner = await openTestCatalog(join(root, 'haus.sqlite'));
  const backupCatalog = new BackupCatalog(catalogOwner.transactions);
  const retentionCatalog = new RetentionCatalog(catalogOwner.transactions);
  const serviceCatalog = new ServiceCatalog(catalogOwner.transactions);
  await backupCatalog.initialize();
  await serviceCatalog.initialize();
  const backups = new Backups(config, store, backupCatalog);
  await backups.initialize();
  const opened = await openTestCluster(store, join(root, 'haus.sqlite'), backups, {
    catalogOwner,
  });
  const { cluster } = opened;
  const node = {
    id: 'worker',
    name: 'Worker',
    url: `http://127.0.0.1:${port(remote)}`,
    enabled: true,
    roles,
    allowHttp: true,
    key: 'fixture-key-'.repeat(6),
    instanceId: 'fixture',
  };
  await cluster.catalog.saveNode({ id: node.id, value: JSON.stringify(node) });
  cluster.enableRecordingCache(config, retentionCatalog);
  await cluster.poll();
  const api = createCacheTestServer({
    config,
    store,
    cluster,
    recorder: {
      preparePlayback: async (event) => {
        prepareCalls++;
        const e = event as { id: string; playbackBytes?: number };
        return store.path(e.id, e.playbackBytes ? 'playback.mp4' : 'mp4');
      },
    },
  });
  await listen(api);
  const base = `http://127.0.0.1:${port(api)}`;
  const headers = { Authorization: 'Bearer test-token' };
  onTestFinished(async () => {
    await cluster.stop();
    await opened.catalogOwner.close();
    await backups.stop();
    api.closeAllConnections();
    remote.closeAllConnections();
    await Promise.all([closeServer(api), closeServer(remote)]);
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  const event = async (
    index: number,
    { ready = true, prepared = true }: { ready?: boolean; prepared?: boolean } = {},
  ) => {
    const at = Date.now() - 100000 + index * 1000;
    const item = await store.create('camera.fixture', 'motion', at, at + 1000);
    const original = Buffer.from(`ORIGINAL-${index}`.padEnd(32, 'o'));
    const playback = Buffer.from(`PREPARED-${index}`.padEnd(32, 'p'));
    await writeFile(store.path(item.id), original);
    await writeFile(store.path(item.id, 'jpg'), 'thumbnail');
    await store.finish(item.id, {
      bytes: original.length,
      duration: 1,
      playbackVersion: ready ? 4 : 0,
    });
    if (prepared) {
      await writeFile(store.path(item.id, 'playback.mp4'), playback);
      await store.setPlayback(item.id, playback.length, ready ? 4 : 0, {
        audio: true,
      });
    }
    return { id: item.id, original, playback };
  };
  return {
    root,
    store,
    cluster,
    config,
    blobs,
    posted,
    event,
    base,
    headers,
    node,
    backups,
    serviceCatalog,
    setVerification: (value: string) => {
      verification = value;
    },
    setVerifyGate: (value: Promise<void> | undefined) => {
      verifyGate = value;
    },
    setStreamGate: (value: Promise<void> | undefined) => {
      streamGate = value;
    },
    prepareCalls: () => prepareCalls,
  };
}
