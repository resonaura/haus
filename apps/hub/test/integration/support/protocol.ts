/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { sign } from '../../../src/nvr/auth.js';
import { record, identifier } from '../../nvr/support/values.js';
import type { RemoteTarget } from './remote.js';

export async function exerciseProtocol(
  target: RemoteTarget,
  options: { recordingId?: string; keepFixture?: boolean } = {},
) {
  const key = (await readFile(target.keyFile, 'utf8')).trim();
  const bytes = Buffer.alloc(1024 * 1024, 73),
    digest = createHash('sha256').update(bytes).digest('hex');
  const request = (
    path: string,
    method: 'GET' | 'PUT' | 'POST' | 'DELETE' = 'GET',
    payload?: string | Uint8Array<ArrayBuffer>,
  ) =>
    fetch(target.url(path), {
      method,
      headers: {
        ...sign(
          key,
          method,
          path,
          payload ? createHash('sha256').update(payload).digest('hex') : undefined,
        ),
      },
      ...(payload === undefined ? {} : { body: payload }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
  const status = record(await (await request('/v1/status')).json());
  assert.equal(status.protocol, 1);
  assert.equal(
    (
      await fetch(target.url('/v1/status'), {
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      })
    ).status,
    401,
  );
  const upload = await request(`/v1/blobs/${digest}`, 'PUT', bytes);
  assert.ok([200, 201].includes(upload.status));
  await upload.body?.cancel();
  const id = options.recordingId || randomUUID();
  const startAt = 1800000000000;
  const index = await request(
    '/v1/recordings',
    'POST',
    JSON.stringify({
      digest,
      event: {
        id,
        cameraId: 'camera.validation_fixture',
        startAt,
        endAt: startAt + 40000,
        duration: 40,
        bytes: bytes.length,
        status: 'ready',
        kinds: ['manual'],
      },
    }),
  );
  assert.equal(index.status, 201);
  await index.body?.cancel();
  assert.equal(record(await (await request(`/v1/recordings/${id}`)).json()).digest, digest);
  const grant = record(
    await (await request('/v1/grants', 'POST', JSON.stringify({ digest }))).json(),
  );
  const path = identifier(grant.path);
  assert.ok(!path.includes(key));
  const range = await fetch(target.url(path), {
    headers: { Range: 'bytes=1024-2047' },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(1024, 2048));
  const forbidden = await fetch(target.url(path), {
    method: 'DELETE',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(forbidden.status, 403);
  if (!options.keepFixture) {
    const removed = await request(`/v1/blobs/${digest}`, 'DELETE');
    assert.equal(removed.status, 200);
    await removed.body?.cancel();
    assert.equal((await request(`/v1/recordings/${id}`)).status, 404);
  }
  return {
    nodeId: identifier(status.nodeId),
    instanceId: identifier(status.instanceId),
    recordingId: id,
    fixtureRetained: options.keepFixture === true,
  };
}
