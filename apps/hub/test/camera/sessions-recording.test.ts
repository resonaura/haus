/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { describe, it } from 'vitest';
import { Recorder } from '@haus/hub/events';
import type { DurableReceiptValue } from '../../src/camera/index.js';
import {
  camera,
  createSessionsFixture,
  createTestClip,
  owner,
  session,
  type SessionTestCall,
} from './sessions-fixture.js';

describe('NvrCameraSessions — viewers, recordings and durable recovery', () => {
  it('release while a warm registration is pending cancels late ownership and sends explicit node release', async () => {
    let resolve!: (value: unknown) => void;
    const f = await createSessionsFixture({
      json: async () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    try {
      const pending = f.sessions.touch(camera, owner, true);
      await new Promise((done) => setImmediate(done));
      await f.sessions.release(camera.id, owner);
      resolve(session);
      assert.equal((await pending).warm, false);
      assert.equal(f.sessions.entries.size, 0);
      assert.ok(
        f.calls.some((call) => call.method === 'DELETE' && call.path.endsWith(session.id)),
      );
    } finally {
      await f.cleanup();
    }
  });

  it('close before viewer creation tombstones the app UUID and deletes a late node viewer', async () => {
    let resolveOffer!: (value: unknown) => void;
    const f = await createSessionsFixture({
      json: async (_node, path) =>
        path.endsWith('/webrtc')
          ? new Promise((done) => {
              resolveOffer = done;
            })
          : session,
    });
    try {
      const viewerId = randomUUID();
      const pending = f.sessions.viewer(camera, owner, viewerId, 'v=0\r\n');
      await new Promise((done) => setImmediate(done));
      await f.sessions.closeViewer(camera.id, owner, viewerId);
      resolveOffer({
        viewerId: randomUUID(),
        answer: { type: 'answer', sdp: 'v=0\r\n' },
        candidates: [],
      });
      await assert.rejects(pending, /viewer_closed/);
      assert.equal(f.sessions.viewers.size, 0);
      assert.ok(
        f.calls.some((call) => call.method === 'DELETE' && call.path.includes('/viewers/')),
      );
      await assert.rejects(
        f.sessions.viewer(camera, owner, viewerId, 'v=0\r\n'),
        /viewer_closed/,
      );
    } finally {
      await f.cleanup();
    }
  });

  it('preview release cannot close an independent viewer and unavailable sources revoke current owners', async () => {
    const f = await createSessionsFixture({
      json: async (_node, path) =>
        path.endsWith('/webrtc')
          ? {
              viewerId: randomUUID(),
              answer: { type: 'answer', sdp: 'v=0\r\n' },
              candidates: [],
            }
          : session,
    });
    try {
      await f.sessions.touch(camera, owner + '-preview', true, true);
      await f.sessions.viewer(camera, owner, randomUUID(), 'v=0\r\n');
      await f.sessions.touch(camera, owner + '-preview', false, true);
      assert.equal(f.sessions.viewers.size, 1);
      assert.ok(!f.calls.some((call) => call.path.includes('/viewers/')));
      f.registry.cameras[0].available = false;
      f.sessions.sync(f.registry.cameras);
      await new Promise((done) => setImmediate(done));
      assert.equal(f.sessions.entries.size, 0);
    } finally {
      await f.cleanup();
    }
  });

  it('recording input stays on NVR and matching late Activity Assist extends one journaled event', async () => {
    const f = await createSessionsFixture();
    const recorder = new Recorder(
      f.config,
      {
        stream: () => {
          throw Error('HA HLS forbidden');
        },
      },
      f.store,
      undefined,
      { capture: f.sessions },
    );
    try {
      recorder.sync([camera]);
      await f.sessions.tick();
      const at = Date.now();
      const event = (await recorder.trigger(camera.id, 'motion', 'hardware', at))!;
      await f.sessions.record(event);
      const extended = (await recorder.trigger(
        camera.id,
        'person',
        'haus_software_motion',
        at - 5000,
      ))!;
      await f.sessions.record(extended);
      assert.equal(extended.id, event.id);
      assert.equal(f.sessions.events.get(event.id)?.startAt, at - 5000);
      assert.equal(await f.source.manager.count('NvrCameraEvent'), 1);
      assert.equal(recorder.buffers.get(camera.id)?.inputKind, 'nvr-rtsp');
      assert.equal(recorder.buffers.get(camera.id)?.process, undefined);
    } finally {
      await recorder.stop();
      await f.cleanup();
    }
  });

  it('capture diagnostics retain submission codes, throttle retries and never log remote secrets', async () => {
    const diagnostics: Record<string, unknown>[] = [];
    const error = Object.assign(Error('rtsp://private:secret@example.invalid/live'), {
      code: 'camera_recording_busy',
      status: 503,
    });
    const f = await createSessionsFixture({
      log: (event, fields) => diagnostics.push({ event, ...fields }),
      json: async (_node, path) => {
        if (path.endsWith('/recordings')) throw error;
        return session;
      },
    });
    try {
      const event = await f.store.create(camera.id, 'motion', Date.now(), Date.now() + 1000);
      await assert.rejects(f.sessions.record(event), error);
      await assert.rejects(f.sessions.record(event), error);
      assert.deepEqual(diagnostics, [
        {
          event: 'recording_operation_failed',
          eventId: event.id,
          cameraId: camera.id,
          phase: 'submit',
          reason: 'camera_recording_busy',
          status: 503,
        },
      ]);
      assert.equal(JSON.stringify(diagnostics).includes('secret'), false);
      assert.equal(f.sessions.eventPending.size, 0);
      assert.equal(f.sessions.events.size, 0);
    } finally {
      await f.cleanup();
    }
  });

  it('diagnostic failures do not hide the original capture error or retain pending work', async () => {
    const failure = Error('camera_recording_busy');
    const f = await createSessionsFixture({
      log: () => {
        throw Error('logger failed');
      },
      json: async (_node, path) => {
        if (path.endsWith('/recordings')) throw failure;
        return session;
      },
    });
    try {
      const event = await f.store.create(camera.id, 'motion', Date.now(), Date.now() + 1000);
      await assert.rejects(f.sessions.finalize(event), failure);
      assert.equal(f.sessions.eventPending.size, 0);
      assert.equal(f.sessions.events.size, 0);
    } finally {
      await f.cleanup();
    }
  });

  it('a rejected storage reservation is reported as capacity, not corrupted media', async () => {
    const f = await createSessionsFixture({
      log: () => {},
      json: async (_node, path) => {
        if (path.endsWith('/recordings'))
          throw Object.assign(Error('Node returned 507'), {
            code: 'storage_full',
            status: 507,
          });
        return session;
      },
    });
    const recorder = new Recorder(f.config, {}, f.store, undefined, {
      capture: f.sessions,
    });
    try {
      f.sessions.sync([camera]);
      const event = await f.store.create(camera.id, 'motion', Date.now(), Date.now() + 1000);
      await recorder.finish(event);
      assert.equal((await f.store.get(event.id))?.status, 'failed');
      assert.equal(
        (await f.store.get(event.id))?.error,
        'Free space on your recording server and try again.',
      );
    } finally {
      await recorder.stop();
      await f.cleanup();
    }
  });

  it('verified NVR MP4 imports actual pre-roll/audio and ACKs only after catalog persistence', async () => {
    const clip = await createTestClip('haus-nvr-recording-');
    try {
      const { data, sha256: digest } = clip;
      const at = Date.now();
      const result = {
        id: randomUUID(),
        state: 'ready',
        bytes: data.length,
        sha256: digest,
        duration: 2,
        mediaStartAt: at - 8000,
        audio: true,
      };
      const calls: SessionTestCall[] = [];
      const f = await createSessionsFixture({
        json: async (_node, path) => (path.endsWith('/status') ? result : session),
        request: async (_node, path, options) => {
          calls.push({ path, method: options?.method });
          return path.endsWith('/media')
            ? new Response(data, {
                headers: {
                  'content-length': String(data.length),
                  'content-type': 'video/mp4',
                },
              })
            : new Response('{}');
        },
      });
      try {
        const event = await f.store.create(camera.id, 'motion', at, at + 1000);
        await f.sessions.record(event);
        await f.sessions.finalize(event);
        const saved = (await f.store.get(event.id))!;
        assert.equal(saved.status, 'ready');
        assert.equal(saved.mediaStartAt, at - 8000);
        assert.equal(saved.playbackInfo?.audio, true);
        assert.deepEqual(await readFile(f.store.path(event.id)), data);
        assert.ok(calls.some((call) => call.method === 'DELETE' && call.path.endsWith(event.id)));
        assert.equal(await f.source.manager.count('NvrCameraEvent'), 0);
      } finally {
        await f.cleanup();
      }
    } finally {
      await clip.cleanup();
    }
  });

  it('wrong digest cannot replace an existing recording or ACK the remote original', async () => {
    const calls: SessionTestCall[] = [];
    const f = await createSessionsFixture({
      json: async (_node, path) =>
        path.endsWith('/status')
          ? {
              state: 'ready',
              bytes: 4,
              sha256: 'a'.repeat(64),
              duration: 2,
              mediaStartAt: Date.now() - 8000,
              audio: true,
            }
          : session,
      request: async (_node, path, options) => {
        calls.push({ path, method: options?.method });
        return new Response('fail', { headers: { 'content-length': '4' } });
      },
    });
    try {
      const event = await f.store.create(camera.id, 'motion', Date.now(), Date.now() + 1000);
      await writeFile(f.store.path(event.id), 'original');
      await f.sessions.record(event);
      await assert.rejects(f.sessions.finalize(event), /digest_mismatch/);
      assert.equal(await readFile(f.store.path(event.id), 'utf8'), 'original');
      assert.equal((await f.store.get(event.id))?.status, 'recording');
      assert.ok(!calls.some((call) => call.method === 'DELETE' && call.path.endsWith(event.id)));
    } finally {
      await f.cleanup();
    }
  });

  it('late controller recovers a durable NVR original after its temporary session expired, pages past unrelated receipts and never captures it twice', async () => {
    const clip = await createTestClip('haus-durable-capture-');
    try {
      const { data, sha256 } = clip;
      let at = Date.now();
      let receipt!: DurableReceiptValue;
      let acknowledgements = 0;
      const calls: SessionTestCall[] = [];
      const f = await createSessionsFixture({
        now: () => at,
        json: async (_node, path, options = {}) => {
          calls.push({ path, method: options.method });
          if (path === '/v1/camera-recordings')
            return {
              items: Array.from({ length: 16 }, () => ({
                ...receipt,
                event: { ...receipt.event, id: randomUUID() },
              })),
              nextCursor: '16',
            };
          if (path === '/v1/camera-recordings?cursor=16')
            return { items: [receipt], nextCursor: null };
          if (path === `/v1/camera-recordings/${receipt.event.id}`) {
            if (options.method === 'POST') {
              assert.equal(
                (await f.store.get(receipt.event.id))?.status,
                'ready',
                'never ACK before durable Helper catalog update',
              );
              assert.deepEqual(await readFile(f.store.path(receipt.event.id)), data);
              acknowledgements++;
              return { acknowledged: true };
            }
            return receipt;
          }
          throw Error('camera_session_not_found');
        },
        request: async (_node, path, options) => {
          calls.push({ path, method: options?.method });
          assert.equal(path, `/v1/blobs/${sha256}`);
          return new Response(data, {
            headers: { 'content-length': String(data.length) },
          });
        },
      });
      try {
        const healthA = f.cluster.health.get('a');
        if (healthA?.remote) healthA.remote.features = { cameraRecordingRecovery: 1 };
        const oldAt = at - 20 * 60000;
        const event = await f.store.create(camera.id, 'motion', oldAt, oldAt + 1000);
        await f.store.finish(event.id, { status: 'interrupted' });
        receipt = {
          state: 'ready',
          event: {
            id: event.id,
            cameraId: event.cameraId,
            startAt: event.startAt,
            endAt: event.endAt,
            kinds: event.kinds,
          },
          bytes: data.length,
          sha256,
          duration: 2,
          mediaStartAt: oldAt - 8000,
          audio: true,
        };
        await f.sessions.recoverRecordings();
        assert.equal(acknowledgements, 0);
        at += 10001;
        await f.sessions.recoverRecordings();
        assert.equal((await f.store.get(event.id))?.status, 'ready');
        assert.equal((await f.store.get(event.id))?.mediaStartAt, oldAt - 8000);
        assert.equal((await f.store.get(event.id))?.playbackInfo?.audio, true);
        assert.equal(acknowledgements, 1);
        assert.equal(await f.source.manager.count('RecordingEvent'), 1);
        assert.ok(
          calls.every((call) => !call.path.includes('/cameras/sessions')),
          'recovery must not attempt to record an old interval again',
        );
        at += 10001;
        await f.sessions.recoverRecordings();
        at += 10001;
        await f.sessions.recoverRecordings();
        assert.equal(acknowledgements, 2, 'lost ACK can be repeated idempotently');
        assert.equal(await f.source.manager.count('RecordingEvent'), 1);
        const good = receipt.sha256;
        receipt.sha256 = 'a'.repeat(64);
        at += 10001;
        await f.sessions.recoverRecordings();
        at += 10001;
        await f.sessions.recoverRecordings();
        assert.equal(
          acknowledgements,
          2,
          'a conflicting original is never acknowledged or allowed to replace ready media',
        );
        receipt.sha256 = good;
      } finally {
        await f.cleanup();
      }
    } finally {
      await clip.cleanup();
    }
  });

  it('new autonomous event is adopted only through recorded policy authority and retains its node ID through verified media recovery', async () => {
    const clip = await createTestClip('haus-new-activity-');
    try {
      const { data, sha256 } = clip;
      let at = Date.now();
      const event = {
        id: randomUUID(),
        cameraId: camera.id,
        startAt: at - 20000,
        endAt: at - 19000,
        kinds: ['person'],
        origin: { kind: 'camera-activity', policyId: randomUUID() },
      };
      const receipt = {
        state: 'ready',
        event,
        bytes: data.length,
        sha256,
        duration: 2,
        mediaStartAt: event.startAt - 8000,
        audio: true,
      };
      let acks = 0;
      const f = await createSessionsFixture({
        now: () => at,
        json: async (_node, path, options = {}) => {
          if (path === '/v1/camera-recordings') return { items: [receipt] };
          if (path === `/v1/camera-recordings/${event.id}`) {
            if (options.method === 'POST') {
              acks++;
              return { acknowledged: true };
            }
            return receipt;
          }
          throw Error('temporary_session_expired');
        },
        request: async () =>
          new Response(data, {
            headers: { 'content-length': String(data.length) },
          }),
      });
      try {
        const healthA = f.cluster.health.get('a');
        if (healthA?.remote) healthA.remote.features = { cameraRecordingRecovery: 1 };
        await f.sessions.recoverRecordings();
        assert.equal(await f.store.get(event.id), null);
        assert.equal(acks, 0);
        f.sessions.authorizeActivityRecording = (node, value) => {
          const eventWithOrigin = value.event as { origin?: { policyId?: string } };
          return node.id === 'a' && eventWithOrigin.origin?.policyId === event.origin.policyId;
        };
        at += 10001;
        await f.sessions.recoverRecordings();
        assert.equal((await f.store.get(event.id))?.status, 'ready');
        assert.equal((await f.store.get(event.id))?.cameraId, camera.id);
        assert.equal((await f.store.get(event.id))?.mediaStartAt, event.startAt - 8000);
        assert.deepEqual(await readFile(f.store.path(event.id)), data);
        assert.equal(acks, 1);
        at += 10001;
        await f.sessions.recoverRecordings();
        assert.equal(await f.source.manager.count('RecordingEvent'), 1);
      } finally {
        await f.cleanup();
      }
    } finally {
      await clip.cleanup();
    }
  });
});
