/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import { WorkerStreams, createNode, Blobs, sign } from '../../../src/nvr/index.js';
import { port } from '../support/values.js';
import { hlsFixture } from '../../../../../packages/media/test/support/hls.js';

test('a real FFmpeg relay serves live HLS, scopes its source, and releases encoder/files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'haus-relay-'));
  let source: Awaited<ReturnType<typeof hlsFixture>> | undefined,
    streams: WorkerStreams | undefined,
    server: Server | undefined;
  t.onTestFinished(async () => {
    await streams?.stop();
    if (server) {
      const transport = server;
      transport.closeAllConnections();
      if (transport.listening)
        await new Promise<void>((resolve, reject) =>
          transport.close((error) => (error ? reject(error) : resolve())),
        );
    }
    await source?.stop();
    await rm(root, { recursive: true, force: true });
  });
  source = await hlsFixture(root);
  const relay = new WorkerStreams(join(root, 'jobs'), source.origin);
  streams = relay;
  await relay.initialize();
  const blobs = new Blobs(join(root, 'blobs'), { reserveBytes: 0 });
  await blobs.initialize();
  const key = 'fixture-only-unique-secret-key-32bytes';
  const transport = createNode({ key, blobs, streams, nodeId: 'relay', instanceId: 'fixture' });
  server = transport;
  await new Promise<void>((resolve, reject) => {
    transport.once('error', reject);
    transport.listen(0, '127.0.0.1', () => {
      transport.removeListener('error', reject);
      resolve();
    });
  });
  const base = `http://127.0.0.1:${port(transport)}`;
  await assert.rejects(() =>
    relay.start('http://external.example/cluster/source/' + 'a'.repeat(48) + '/manifest.m3u8'),
  );
  await source.ready();
  const path = '/v1/streams',
    body = JSON.stringify({
      source: source.origin + '/cluster/source/' + 'a'.repeat(48) + '/manifest.m3u8',
    });
  const started = await fetch(base + path, {
    method: 'POST',
    headers: { ...sign(key, 'POST', path, createHash('sha256').update(body).digest('hex')) },
    body,
  });
  assert.equal(started.status, 201);
  const job = await started.json();
  const playlistPath = `/v1/streams/${job.id}/index.m3u8`;
  const playlist = await (
    await fetch(base + playlistPath, { headers: { ...sign(key, 'GET', playlistPath) } })
  ).text();
  assert.ok(playlist.startsWith('#EXTM3U'));
  const segment = playlist.split('\n').find((line) => line.endsWith('.ts'));
  assert.ok(segment);
  const segmentPath = `/v1/streams/${job.id}/${segment}`;
  const bytes = await (
    await fetch(base + segmentPath, { headers: { ...sign(key, 'GET', segmentPath) } })
  ).arrayBuffer();
  assert.ok(bytes.byteLength > 1000);
  assert.equal(streams.size, 1);
  const stopPath = `/v1/streams/${job.id}`;
  assert.equal(
    (
      await fetch(base + stopPath, {
        method: 'DELETE',
        headers: { ...sign(key, 'DELETE', stopPath) },
      })
    ).status,
    200,
  );
  assert.equal(streams.size, 0);
  await assert.rejects(() => stat(join(root, 'jobs', job.id)));
}, 25000);
