/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { listen, port, closeServer } from '../support/http.js';
import { test, onTestFinished } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openTestRecordingStore } from '../support/recording.js';
import { createApi, type CreateApiOptions } from '@haus/hub/runtime';
async function fixture(
  recorderOverrides: CreateApiOptions['recorder'] = {},
  apiOverrides: Partial<CreateApiOptions> = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'haus-api-'));
  const media = join(root, 'media');
  await mkdir(media);
  const store = await openTestRecordingStore(join(root, 'db.sqlite'), media);
  const camera: {
    id: string;
    enabled: boolean;
    available: boolean;
    sensors: string[];
    talkback?: unknown;
  } = {
    id: 'camera.test',
    enabled: true,
    available: true,
    sensors: [],
  };
  const server = createApi({
    config: {
      standalone: true,
      apiToken: 'test-token',
      recording_enabled: true,
      max_storage_gb: 10,
      retention_days: 7,
    },
    ha: { connected: true },
    store,
    recorder: {
      status: () => [],
      trigger: async () => ({ id: 'pending' }),
      ...recorderOverrides,
    },
    getRegistry: () => ({
      cameras: [camera],
      states: [],
    }),
    refresh: async () => {
      const entry = (await store.overrides())[camera.id] as { talkback?: unknown } | undefined;
      camera.talkback = entry?.talkback;
    },
    ...apiOverrides,
  });
  await listen(server);
  const base = `http://127.0.0.1:${port(server)}`;
  onTestFinished(async () => {
    server.closeAllConnections();
    await closeServer(server);
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { base, store, headers: { Authorization: 'Bearer test-token' } };
}
test('native handover status is authenticated and legacy migration blocks confirmation', async () => {
  let confirmed = 0,
    state = 'migration_required';
  const id = 'aa8031c2-95b0-441f-9f03-3da16b0b9357';
  const { base, headers } = await fixture(
    {},
    {
      providers: {
        list: () => [{ id }],
        add: async () => ({}),
        remove: async () => ({}),
      },
      nativeSources: {
        preview: () => ({}),
        import: async () => ({}),
      },
      ha: { connected: true, registry: async () => ({ cameras: [], entities: [] }) },
      nativeEntities: {
        revokeClient: async () => ({}),
        acknowledge: async () => ({}),
        devices: () => [],
        command: async () => ({}),
        handoverStatus: () => ({ bridgeId: id, state }),
        transaction: async <T>(_id: string, action: () => Promise<T> | T) => action(),
        completeHandover: async () => {
          confirmed++;
          return { native: true };
        },
      },
    },
  );
  assert.equal((await fetch(`${base}/api/providers/handover`)).status, 401);
  const status = await (await fetch(`${base}/api/providers/handover`, { headers })).json();
  assert.equal(status.bridges[0].state, 'migration_required');
  const post = () =>
    fetch(`${base}/api/providers/${id}/handover`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'X-Haus-Client': '1' },
      body: '{}',
    });
  assert.equal((await post()).status, 409);
  assert.equal(confirmed, 0);
  state = 'integration_required';
  assert.equal((await post()).status, 409);
  state = 'ready';
  assert.equal((await post()).status, 200);
  assert.equal(confirmed, 1);
});
test('native migration exposes only authenticated review and explicit validated actions', async () => {
  const id = 'aa8031c2-95b0-441f-9f03-3da16b0b9357',
    calls: unknown[][] = [];
  const { base, headers } = await fixture(
    {},
    {
      providers: {
        list: () => [{ id }],
        add: async () => ({}),
        remove: async () => ({}),
      },
      nativeSources: {
        preview: () => ({}),
        import: async () => ({}),
      },
      nativeMigration: {
        ignoredLegacy: () => new Set(),
        beforeHandover: async () => {},
        handoverStarted: async () => {},
        handoverFinished: async () => {},
        status: () => ({ phase: 'review' }),
        review: async (bridge: string) => {
          calls.push(['review', bridge]);
          return { phase: 'review' };
        },
        start: (...args: [string, unknown, boolean]) => {
          calls.push(args);
          return { phase: 'applying' };
        },
      },
    },
  );
  const path = `${base}/api/providers/${id}/migration`;
  assert.equal((await fetch(path)).status, 401);
  assert.equal((await fetch(path, { headers })).status, 200);
  const post = (operation: string, data: Record<string, unknown>) =>
    fetch(`${path}/${operation}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'X-Haus-Client': '1' },
      body: JSON.stringify(data),
    });
  assert.equal((await post('review', { force: true })).status, 400);
  assert.equal((await post('review', {})).status, 200);
  assert.equal((await post('apply', { revision: 'a'.repeat(64), retire: [] })).status, 202);
  assert.equal((await post('undo', { revision: 'a'.repeat(64) })).status, 202);
  assert.equal(calls.length, 3);
});
test('camera operating API requires authentication and fences exact controls before issuing a write', async () => {
  const writes: Array<[string, unknown, string, boolean]> = [];
  const { base, headers } = await fixture(
    {},
    {
      operating: {
        read: () => ({ nightVision: { id: 'switch.ir', value: true, available: true } }),
        write: async (...args: [string, unknown, string, boolean]) => writes.push(args),
      },
    },
  );
  const post = (data: Record<string, unknown>, auth: Record<string, string> = headers) =>
    fetch(`${base}/api/cameras/camera.test/operating`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', 'X-Haus-Client': '1' },
      body: JSON.stringify(data),
    });
  const input = { control: 'nightVision', entityId: 'switch.ir', value: false };
  assert.equal((await post(input, {})).status, 401);
  assert.equal((await post({ ...input, value: 'OFF' })).status, 400);
  assert.deepEqual(writes, []);
  assert.equal((await post(input)).status, 200);
  assert.deepEqual(writes, [['camera.test', 'nightVision', 'switch.ir', false]]);
  const result = await (await fetch(`${base}/api/cameras`, { headers })).json();
  assert.equal(result.cameras[0].operating.nightVision.id, 'switch.ir');
});
test('native media credentials never enter public camera metadata', async () => {
  const { base, headers } = await fixture(
    {},
    {
      getRegistry: () => ({
        cameras: [
          {
            id: 'camera.test',
            available: true,
            nativeProvider: { bridgeId: 'identity' },
            nativeSource: { kind: 'p2p-restream', url: 'rtsp://private:secret@192.168.1.2/live' },
            nativeTalkback: 'rtmp://private:secret@192.168.1.2/talk/one',
          },
        ],
        states: [],
      }),
    },
  );
  const result = await (await fetch(`${base}/api/cameras`, { headers })).json();
  assert.equal(result.cameras[0].nativeSource, undefined);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
test('requires authentication and never returns internal credentials in status', async () => {
  const { base, headers } = await fixture();
  assert.equal((await fetch(`${base}/api/status`)).status, 401);
  const status = await (await fetch(`${base}/api/status`, { headers })).json();
  assert.equal(status.protocol, 1);
  assert.equal(status.connected, true);
  assert.ok(!JSON.stringify(status).includes('test-token'));
  assert.equal((await fetch(`${base}/api/events?camera_id=../../secret`, { headers })).status, 400);
});
test('async preparation polls respond before encoding ends and coalesce repeated requests', async () => {
  let complete: () => void = () => {};
  const work = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let calls = 0;
  const { base, store, headers } = await fixture({
    preparePlayback: async (event) => {
      calls++;
      await work;
      await store.setPlayback(event.id, 100, 4, { duration: 2 });
    },
  });
  onTestFinished(() => complete());
  const event = await store.create('camera.test', 'motion', 1000, 3000);
  await store.finish(event.id, { bytes: 10, duration: 2 });
  const url = `${base}/api/events/${event.id}/prepare`;
  const poll = () =>
    fetch(url, {
      headers: { ...headers, 'X-Haus-Async-Prepare': '1' },
      signal: AbortSignal.timeout(3000),
    });
  for (let i = 0; i < 3; i++) {
    const response = await poll();
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      status: 'preparing',
      retryAfterMs: 1000,
    });
  }
  assert.equal(calls, 1);
  complete();
  await work;
  const response = await poll();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).playbackVersion, 4);
  assert.equal(calls, 1);
});
test('legacy preparation waits for completion without requiring the polling header', async () => {
  let complete: () => void = () => {};
  const work = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const { base, store, headers } = await fixture({
    preparePlayback: () => work,
  });
  onTestFinished(() => complete());
  const event = await store.create('camera.test', 'motion', 1000, 3000);
  await store.finish(event.id, { bytes: 10, duration: 2 });
  const pending = fetch(`${base}/api/events/${event.id}/prepare`, { headers });
  complete();
  assert.equal((await pending).status, 200);
});
test('streams authenticated seekable ranges with precise content lengths', async () => {
  const { base, store, headers } = await fixture();
  const event = await store.create('camera.test', 'motion', 1000, 3000);
  await writeFile(store.path(event.id), '0123456789');
  await store.finish(event.id, { bytes: 10, duration: 2 });
  const response = await fetch(`${base}/api/events/${event.id}/video`, {
    headers: { ...headers, Range: 'bytes=3-6' },
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 3-6/10');
  assert.equal(await response.text(), '3456');
  assert.equal(
    (
      await fetch(`${base}/api/events/${event.id}/video`, {
        headers: { ...headers, Range: 'bytes=30-' },
      })
    ).status,
    416,
  );
});
test('rejects cross-site form writes and validates detector overrides', async () => {
  const { base, headers } = await fixture();
  const bad = await fetch(`${base}/api/cameras/camera.test/record`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  assert.equal(bad.status, 400);
  const invalid = await fetch(`${base}/api/cameras/camera.test`, {
    method: 'PATCH',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'X-Haus-Client': '1',
    },
    body: JSON.stringify({ sensorIds: ['binary_sensor.unrelated'] }),
  });
  assert.equal(invalid.status, 400);
});

test('returns camera availability even on a day with no motion clips', async () => {
  const { base, store, headers } = await fixture();
  await store.observeAvailability('camera.test', 'offline', 1000);
  await store.observeAvailability('camera.test', 'online', 5000);
  const page = await (
    await fetch(`${base}/api/events?camera_id=camera.test&from=2000&to=4000`, {
      headers,
    })
  ).json();
  assert.deepEqual(page.events, []);
  assert.deepEqual(page.availability, [
    { cameraId: 'camera.test', startAt: 2000, endAt: 4000, state: 'offline' },
  ]);
});

test('calendar validates bounded local-day ranges and paged direction', async () => {
  const { base, store, headers } = await fixture();
  const event = await store.create('camera.test', 'motion', 2000, 3000);
  await store.finish(event.id, { duration: 1, bytes: 1 });
  const response = await fetch(
    `${base}/api/events/calendar?camera_id=camera.test&boundaries=1000,2000,4000`,
    { headers },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { days: [2000] });
  for (const path of [
    '/api/events/calendar?camera_id=camera.test&boundaries=3000,2000',
    '/api/events/calendar?camera_id=../../secret&boundaries=1000,2000',
    '/api/events?direction=arbitrary',
  ]) {
    assert.equal((await fetch(base + path, { headers })).status, 400);
  }
});

test('original recording reads stay authenticated and bypass compatibility encoding', async () => {
  let prepared = 0;
  const { base, store, headers } = await fixture({
    preparePlayback: async () => {
      prepared++;
      throw new Error('should_not_encode');
    },
  });
  const event = await store.create('camera.test', 'motion', 1000, 3000);
  await writeFile(store.path(event.id), 'original-camera-media');
  await store.finish(event.id, { bytes: 21, duration: 2 });
  const url = `${base}/api/events/${event.id}/original`;
  assert.equal((await fetch(url)).status, 401);
  const response = await fetch(url, {
    headers: { ...headers, Range: 'bytes=0-7' },
  });
  assert.equal(response.status, 206);
  assert.equal(await response.text(), 'original');
  assert.equal(prepared, 0);
  assert.equal((await store.get(event.id))?.playbackVersion, 0);
});

test('custom microphone credentials never enter public camera responses', async () => {
  const { base, headers, store } = await fixture();
  const talkback = {
    url: 'rtmp://fixture:private-camera-password@192.168.1.20/custom/talk',
  };
  const response = await fetch(base + '/api/cameras/camera.test', {
    method: 'PATCH',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'X-Haus-Client': '1',
    },
    body: JSON.stringify({ talkback }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(
    ((await store.overrides())['camera.test'] as { talkback?: unknown } | undefined)?.talkback,
    talkback,
  );
  assert.equal(JSON.stringify(await response.json()).includes('private-camera-password'), false);
  const cameras = await (await fetch(base + '/api/cameras', { headers })).json();
  assert.equal(JSON.stringify(cameras).includes('private-camera-password'), false);
});

test('explicit recording repair is authenticated, coalesced across POST polls and returns a preserved-copy marker', async () => {
  let complete: () => void = () => {},
    calls = 0,
    passedOptions: { forceCompatibility?: boolean } | undefined;
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const { base, store, headers } = await fixture({
    preparePlayback: async (event, _priority, options) => {
      calls++;
      passedOptions = options;
      await pending;
      await store.setPlayback(event.id, 100, 4, {
        compatibilityRepaired: true,
        originalCompatible: false,
      });
    },
  });
  onTestFinished(() => complete());
  const event = await store.create('camera.test', 'motion', 1000, 3000);
  await store.finish(event.id, { bytes: 20, duration: 2, playbackVersion: 4 });
  await store.setPlayback(event.id, 0, 4, { originalCompatible: true });
  const url = `${base}/api/events/${event.id}/repair`;
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', headers, body: '{}' })).status, 400);
  const options = {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'X-Haus-Client': '1',
    },
    body: '{}',
  };
  for (let i = 0; i < 3; i++) {
    const response = await fetch(url, options);
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      status: 'preparing',
      retryAfterMs: 1000,
    });
  }
  assert.equal(calls, 1);
  assert.equal(passedOptions?.forceCompatibility, true);
  complete();
  await pending;
  const ready = await fetch(url, options);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).playbackInfo.compatibilityRepaired, true);
  assert.equal((await fetch(url, options)).status, 200);
  assert.equal(calls, 1);
  assert.equal((await fetch(url, { ...options, body: '{"path":"private"}' })).status, 400);
  const status = await (await fetch(`${base}/api/status`, { headers })).json();
  assert.equal(status.features.recordingRepair, true);
});
