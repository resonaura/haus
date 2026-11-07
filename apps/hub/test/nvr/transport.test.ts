/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { Readable } from 'node:stream';
import { setTimeout as pause } from 'node:timers/promises';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { expect, it } from 'vitest';
import { createNestApp } from '../../src/nest.js';
import { Blobs } from '../../src/nvr/blobs.js';
import { sign } from '../../src/nvr/auth.js';
import type { NvrOptions } from '../../src/nvr/transport/types.js';

const signed = (...parameters: Parameters<typeof sign>) => ({ ...sign(...parameters) });
const key = 'isolated-nvr-fixture-key-at-least-32-bytes';
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
async function fixture(options: Partial<NvrOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'haus-nest-nvr-'));
  const blobs = new Blobs(join(root, 'blobs'), { reserveBytes: 0 });
  await blobs.initialize();
  const app = await createNestApp({
    apiToken: 'nvr-live-token',
    nvr: { key, blobs, nodeId: 'fixture', ...options },
  });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  let closing: Promise<void> | undefined;
  const stop = () => {
    closing ??= app.close();
    return closing;
  };
  return {
    app,
    stop,
    base,
    blobs,
    close: async () => {
      await stop();
      await rm(root, { recursive: true, force: true });
    },
  };
}

it('serves Hub and signed NVR routes on one Nest port while preserving exact raw upload bytes', async () => {
  const f = await fixture();
  try {
    expect((await fetch(f.base + '/api/docs/postman.json')).status).toBe(200);
    expect((await fetch(f.base + '/v1/status')).status).toBe(401);
    const headers = signed(key, 'GET', '/v1/status');
    expect((await fetch(f.base + '/v1/status', { headers })).status).toBe(200);
    expect((await fetch(f.base + '/v1/status', { headers })).status).toBe(401);

    const bytes = '{ "camera": "Кухня", "value": 7 }\n';
    const id = digest(bytes),
      path = '/v1/blobs/' + id;
    const upload = await fetch(f.base + path, {
      method: 'PUT',
      headers: { ...signed(key, 'PUT', path, id), 'content-type': 'application/json' },
      body: bytes,
    });
    expect(upload.status).toBe(201);
    const range = await fetch(f.base + path, {
      headers: { ...signed(key, 'GET', path), range: 'bytes=2-9' },
    });
    expect(range.status).toBe(206);
    expect(Buffer.from(await range.arrayBuffer())).toEqual(Buffer.from(bytes).subarray(2, 10));
    const invalidRange = await fetch(f.base + path, {
      headers: { ...signed(key, 'GET', path), range: 'bytes=9999-' },
    });
    expect(invalidRange.status).toBe(416);

    const broken = '{';
    expect(
      (
        await fetch(f.base + '/v1/grants', {
          method: 'POST',
          headers: signed(key, 'POST', '/v1/grants', digest(broken)),
          body: broken,
        })
      ).status,
    ).toBe(400);
    const body = JSON.stringify({ digest: id });
    const grantResponse = await fetch(f.base + '/v1/grants', {
      method: 'POST',
      headers: signed(key, 'POST', '/v1/grants', digest(body)),
      body,
    });
    expect(grantResponse.status).toBe(201);
    const grant: unknown = await grantResponse.json();
    if (!grant || typeof grant !== 'object' || !('path' in grant) || typeof grant.path !== 'string')
      throw Error('invalid_fixture_grant');
    const copy = await fetch(f.base + grant.path);
    expect(await copy.text()).toBe(bytes);
    expect((await fetch(f.base + grant.path, { method: 'DELETE' })).status).toBe(403);
    expect(
      (
        await fetch(f.base + '/v1/grants', {
          method: 'POST',
          headers: signed(key, 'POST', '/v1/grants', digest('wrong')),
          body,
        })
      ).status,
    ).toBe(400);
  } finally {
    await f.close();
  }
});

it('keeps monitoring roles restricted and routes RTSP upgrades without taking the live WebSocket channel', async () => {
  const monitoring = await fixture({ roles: [] });
  try {
    const response = await fetch(monitoring.base + '/v1/status', {
      headers: signed(key, 'GET', '/v1/status'),
    });
    expect(response.status).toBe(200);
    expect(
      (await fetch(monitoring.base + '/v1/backups', { headers: signed(key, 'GET', '/v1/backups') }))
        .status,
    ).toBe(404);
  } finally {
    await monitoring.close();
  }
  let peerStops = 0;
  const f = await fixture({
    peers: {
      stop: () => {
        peerStops++;
      },
      grant: () => ({ token: 'fixture', path: '/v1/rtsp-peer' }),
      upgrade: (_req, socket) => {
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: haus-rtsp\r\n\r\n',
        );
        setImmediate(() => socket.end('peer-data'));
      },
    },
  });
  let client: WebSocket | undefined;
  try {
    client = new WebSocket(f.base.replace('http:', 'ws:') + '/api/live', {
      headers: { 'x-haus-client': '1', authorization: 'Bearer nvr-live-token' },
    });
    const incoming = once(client, 'message');
    await once(client, 'open');
    expect((await incoming)[0].toString()).toContain('home');
    const payload = await new Promise<string>((resolve, reject) => {
      const req = request(f.base + '/v1/rtsp-peer', {
        headers: { connection: 'Upgrade', upgrade: 'haus-rtsp' },
      });
      req.on('error', reject);
      req.on('upgrade', (response, socket, head) => {
        if (response.statusCode !== 101) {
          socket.destroy();
          reject(Error('upgrade_failed'));
          return;
        }
        let value = head.toString();
        socket.on('data', (chunk) => {
          value += chunk.toString();
        });
        socket.on('end', () => {
          socket.end();
          resolve(value);
        });
        socket.on('error', reject);
      });
      req.end();
    });
    expect(payload).toBe('peer-data');
    expect(client.readyState).toBe(WebSocket.OPEN);
  } finally {
    client?.terminate();
    await f.close();
    expect(peerStops).toBe(1);
  }
});

it('aborts an unfinished upload and drains its reservations before Nest shutdown completes', async () => {
  const f = await fixture();
  const bytes = Buffer.alloc(65536, 7),
    id = digest(bytes),
    path = '/v1/blobs/' + id;
  const original = Buffer.from('retained-original'),
    originalId = digest(original);
  await f.blobs.put(originalId, Readable.from([original]), original.length);
  const errors: Error[] = [];
  const upload = request(f.base + path, {
    method: 'PUT',
    headers: { ...signed(key, 'PUT', path, id), 'content-length': String(bytes.length) },
  });
  upload.on('error', (error) => errors.push(error));
  const closed = new Promise<void>((resolve) => upload.once('close', () => resolve()));
  try {
    upload.write(bytes.subarray(0, 128));
    const deadline = Date.now() + 2000;
    while (!(await f.blobs.status()).activeTransfers) {
      if (Date.now() > deadline) throw Error('fixture_upload_not_admitted');
      await pause(5);
    }
    await f.stop();
    await closed;
    expect(errors.length).toBeGreaterThan(0);
    expect(await f.blobs.status()).toMatchObject({ activeTransfers: 0, reservedBytes: 0 });
    await expect(f.blobs.info(id)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await f.blobs.info(originalId)).toMatchObject({ size: original.length });
  } finally {
    upload.destroy();
    await f.close();
  }
});
