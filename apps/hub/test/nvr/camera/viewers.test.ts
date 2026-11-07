/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { CameraSessions, Blobs, createNode, sign } from '../../../src/nvr/index.js';
import { engineFixture } from '../support/camera.js';
import { port } from '../support/values.js';

it.each(['string', 'native'] as const)('accepts owned candidate and viewer-close requests for %s session references', async shape => {
  const root = await mkdtemp(join(tmpdir(), 'haus-viewer-wire-'));
  const key = 'isolated-viewer-wire-key-at-least-32-bytes';
  const sessionId = randomUUID(), viewerId = randomUUID(), owner = 'fixture-viewer-owner-123456';
  const candidates: unknown[] = [];
  const engine = engineFixture();
  engine.viewers.set(viewerId, { session: shape === 'native' ? { id: sessionId } : sessionId, owner });
  engine.candidate = (id, lease, value) => { expect(id).toBe(viewerId); expect(lease).toBe(owner); candidates.push(value); };
  const cameras = new CameraSessions(join(root, 'sessions'), engine);
  cameras.sessions.set(sessionId, { id: sessionId, cameraId: 'camera.fixture', source: { kind: 'p2p-restream', url: 'rtsp://127.0.0.1/live' },
    preRollSeconds: 8, requireAudio: false, recordAudio: false, rotation: false, owners: new Map([[owner, Date.now() + 60000]]) });
  const blobs = new Blobs(join(root, 'blobs')); await blobs.initialize();
  const server = createNode({ key, blobs, cameras });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = (path: string, method: string, data: unknown) => {
    const body = JSON.stringify(data), digest = createHash('sha256').update(body).digest('hex');
    return fetch(`http://127.0.0.1:${port(server)}${path}`, { method, body, headers: { ...sign(key, method, path, digest) } });
  };
  try {
    const path = `/v1/cameras/sessions/${sessionId}`;
    const candidate = { candidate: 'fixture-candidate' };
    expect((await request(path + '/webrtc/candidate', 'POST', { owner, viewerId, candidate })).status).toBe(200);
    expect(candidates).toEqual([candidate]);
    expect((await request(path + '/viewers/' + viewerId, 'DELETE', { owner })).status).toBe(200);
    expect(engine.viewers.has(viewerId)).toBe(false);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await cameras.stop(); await rm(root, { recursive: true, force: true });
  }
});
