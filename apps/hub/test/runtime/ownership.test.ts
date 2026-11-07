/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { CameraSessions, type CameraSessionsEngine } from '../../src/nvr/camera/sessions.js';
import { CameraContinuity, type ContinuityEngine } from '../../src/nvr/camera/continuity.js';
import { deferred, key } from './support.js';

it('closes native object-backed viewers for the released owner while preserving another lease', async () => {
  const viewers: CameraSessionsEngine['viewers'] = new Map();
  const closeViewer = vi.fn((id: string) => {
    viewers.delete(id);
  });
  const engine: CameraSessionsEngine = {
    viewers,
    closeViewer,
    initialize: async () => {},
    add: async () => {},
    remove: async () => {},
    stop: async () => {},
    offer: async () => ({ viewerId: 'viewer', answer: {} }),
    candidate: () => {},
    localRtsp: () => '',
  };
  const sessions = new CameraSessions('/unused-fixture-path', engine, { now: () => 1000 });
  const id = 'fixture-session',
    owner = 'fixture-owner-123456',
    other = 'another-owner-123456';
  sessions.sessions.set(id, {
    id,
    cameraId: 'camera.fixture',
    source: { kind: 'p2p-restream', url: 'rtsp://127.0.0.1/live' },
    preRollSeconds: 8,
    requireAudio: false,
    recordAudio: false,
    rotation: false,
    owners: new Map([
      [owner, 2000],
      [other, 2000],
    ]),
  });
  viewers.set('released-viewer', { session: { id }, owner });
  viewers.set('retained-viewer', { session: { id }, owner: other });
  await sessions.release(id, owner);
  expect(closeViewer.mock.calls).toEqual([['released-viewer', owner]]);
  expect(viewers.has('retained-viewer')).toBe(true);
  expect(sessions.sessions.get(id)?.owners.has(other)).toBe(true);
  await expect(() => sessions.owned(id)).toThrow('camera_session_not_found');
  await sessions.stop();
});

it('waits for a late continuity acquisition to release its lease before shutdown completes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-continuity-stop-'));
  const gate = deferred(),
    entered = deferred();
  const release = vi.fn(async () => {});
  const cameras: ContinuityEngine = {
    source: async () => ({ kind: 'p2p-restream', url: 'rtsp://127.0.0.1/live' }),
    sessions: new Map(),
    byCamera: new Map(),
    release,
    acquire: async () => {
      entered.resolve();
      await gate.promise;
      return { id: 'late-session' };
    },
  };
  const continuity = await new CameraContinuity(join(root, 'policy.enc'), key, cameras, {
    now: () => 1000,
  }).initialize();
  try {
    continuity.plans.set('camera.fixture', {
      cameraId: 'camera.fixture',
      source: { kind: 'p2p-restream', url: 'rtsp://127.0.0.1/live' },
      advertiseHost: '127.0.0.1',
      expiresAt: 10000,
      preRollSeconds: 8,
      requireAudio: false,
      recordAudio: false,
    });
    const tick = continuity.tick();
    await entered.promise;
    let stopped = false;
    const stopping = continuity.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    gate.resolve();
    await Promise.all([tick, stopping]);
    expect(release).toHaveBeenCalledWith('late-session', expect.any(String));
  } finally {
    gate.resolve();
    await continuity.stop();
    await rm(root, { recursive: true, force: true });
  }
});

it('rejects late RTSP upgrades once transport shutdown has started', async () => {
  const { NvrTransport } = await import('../../src/nvr/transport/service.js');
  const { Blobs } = await import('../../src/nvr/blobs.js');
  const { IncomingMessage } = await import('node:http');
  const { Socket } = await import('node:net');
  const upgrade = vi.fn();
  const transport = new NvrTransport({
    key,
    blobs: new Blobs('/unused-fixture-path'),
    peers: {
      upgrade,
      grant: () => ({ token: 'fixture', path: '/fixture' }),
      stop: () => {},
    },
  });
  await transport.close();
  const socket = new Socket();
  const request = new IncomingMessage(socket);
  request.url = '/v1/rtsp-peer';
  transport.upgrade(request, socket, Buffer.alloc(0));
  expect(socket.destroyed).toBe(true);
  expect(upgrade).not.toHaveBeenCalled();
});
