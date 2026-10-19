import { describe, it, expect } from 'vitest';
import { validateHelperRequest } from './helper';
describe('private Haus recordings bridge', () => {
  it('only permits the timeline, recording controls and known detector settings', () => {
    expect(
      validateHelperRequest({
        method: 'GET',
        path: '/api/events?camera_id=camera.entry&from=1000&limit=60',
      }).path,
    ).toContain('/api/events');
    expect(
      validateHelperRequest({
        method: 'PATCH',
        path: '/api/cameras/camera.entry',
        data: { enabled: true, sensorIds: ['binary_sensor.entry_motion'] },
      }).data,
    ).toEqual({ enabled: true, sensorIds: ['binary_sensor.entry_motion'] });
    expect(
      validateHelperRequest({ method: 'POST', path: '/api/cameras/camera.entry/record', data: {} })
        .method,
    ).toBe('POST');
  });
  it('rejects arbitrary targets, media through JSON, secret fields, and forged detector IDs', () => {
    for (const request of [
      { method: 'GET', path: 'https://other.test/api/status' },
      { method: 'GET', path: '/api/events?access_token=secret' },
      { method: 'GET', path: '/api/events/00000000-0000-0000-0000-000000000000/video' },
      { method: 'PATCH', path: '/api/cameras/camera.entry', data: { token: 'private' } },
      { method: 'PATCH', path: '/api/cameras/camera.entry', data: { sensorIds: ['camera.other'] } },
      { method: 'POST', path: '/api/cameras/camera.entry/record', data: { enabled: false } },
    ])
      expect(() => validateHelperRequest(request)).toThrow();
  });
});

import { createServer } from 'node:http';
import { HausHelper } from './helper';
import type { HomeAssistantConnection } from './connection';
it('streams microphone chunks through the authenticated local helper and stops the session', async () => {
  let receive!: (bytes: Buffer) => void;
  const received = new Promise<Buffer>((resolve) => {
    receive = resolve;
  });
  const server = createServer((req, res) => {
    expect(req.url).toBe('/api/cameras/camera.entry/talk');
    expect(req.headers['x-haus-client']).toBe('1');
    expect(req.headers['content-type']).toContain('audio/webm');
    req.once('data', receive);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.flushHeaders();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const helper = new HausHelper({
    request: async () => ({
      addons: [{ slug: 'local_haus-helper', name: 'Haus', state: 'started' }],
    }),
    addonSurface: async () => ({ url: `http://127.0.0.1:${address.port}/` }),
  } as unknown as HomeAssistantConnection);
  try {
    const ready = helper.startTalk('camera.entry');
    helper.writeTalk(new Uint8Array([26, 69, 223, 163]));
    await ready;
    expect(await received).toEqual(Buffer.from([26, 69, 223, 163]));
    helper.stopTalk();
    expect(() => helper.writeTalk(new Uint8Array([1]))).toThrow('not active');
  } finally {
    helper.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it('allows only explicit node/backup/settings operations, keeping recovery and sources separate', () => {
  expect(
    validateHelperRequest({
      method: 'POST',
      path: '/api/cluster/nodes',
      data: {
        name: 'Node',
        url: 'https://node.test',
        key: 'k'.repeat(64),
        roles: ['storage'],
        allowHttp: false,
      },
    }).path,
  ).toBe('/api/cluster/nodes');
  expect(
    validateHelperRequest({
      method: 'POST',
      path: '/api/cameras/camera.test/warm',
      data: { active: true },
    }).data,
  ).toEqual({ active: true });
  expect(
    validateHelperRequest({
      method: 'POST',
      path: '/api/cameras/camera.test/warm',
      data: { active: true, preview: true },
    }).data,
  ).toEqual({ active: true, preview: true });
  for (const request of [
    {
      method: 'POST',
      path: '/api/cameras/camera.test/warm',
      data: { active: true, owner: 'forged' },
    },
    { method: 'POST', path: '/api/backups/restore', data: {} },
    {
      method: 'PATCH',
      path: '/api/preferences',
      data: { baseRevision: '0', patch: { access_token: 'secret' } },
    },
    { method: 'GET', path: '/api/backups/recovery' },
  ])
    expect(() => validateHelperRequest(request)).toThrow();
});
it('does not send an administrative operation to a different home after an auth check', async () => {
  let resolve!: (value: unknown) => void;
  let availabilityCalls = 0;
  const helper = new HausHelper({
    request: (input: { type: string }) =>
      input.type === 'auth/current_user'
        ? new Promise((r) => {
            resolve = r;
          })
        : (availabilityCalls++, Promise.resolve({ addons: [] })),
  } as unknown as HomeAssistantConnection);
  const pending = helper.request({
    method: 'POST',
    path: '/api/backups/create',
    data: { kind: 'haus' },
  });
  helper.clear();
  resolve({ is_admin: true });
  await expect(pending).rejects.toThrow('home changed');
  expect(availabilityCalls).toBe(0);
});
import { recordingSource } from './helper-service-validation';
it('accepts only short-lived media capabilities and rejects credentials, expired or malformed URLs', () => {
  const expiresAt = Date.now() + 60000,
    url = `http://192.168.1.10:8098/media/${'a'.repeat(64)}?expires=${expiresAt}&nonce=${'b'.repeat(32)}&signature=${'c'.repeat(64)}`;
  expect(recordingSource({ url, expiresAt })?.url).toBe(url);
  expect(recordingSource({ url: 'file:///etc/passwd', expiresAt })).toBeUndefined();
  expect(recordingSource({ url: 'not a url', expiresAt })).toBeUndefined();
  expect(recordingSource({ url, expiresAt: Date.now() - 1 })).toBeUndefined();
  expect(
    recordingSource({ url: url.replace('http://', 'http://user:password@'), expiresAt }),
  ).toBeUndefined();
});
it('keeps recovery keys out of the generic renderer request channel', async () => {
  const helper = new HausHelper({} as HomeAssistantConnection);
  await expect(
    helper.request({ method: 'POST', path: '/api/backups/recovery', data: {} }),
  ).rejects.toThrow('native export dialog');
});

it('allows bounded recording-calendar queries and bidirectional history paging', () => {
  expect(
    validateHelperRequest({
      method: 'GET',
      path: '/api/events/calendar?camera_id=camera.entry&boundaries=1000,2000,3000',
    }).path,
  ).toContain('/calendar');
  expect(
    validateHelperRequest({
      method: 'GET',
      path: '/api/events?camera_id=camera.entry&direction=newer&cursor=encoded',
    }).path,
  ).toContain('direction=newer');
  expect(() =>
    validateHelperRequest({
      method: 'GET',
      path: '/api/events/calendar?boundaries=' + '0'.repeat(513),
    }),
  ).toThrow('filter');
  expect(() =>
    validateHelperRequest({ method: 'POST', path: '/api/events/calendar', data: {} }),
  ).toThrow();
});

it('reports a restarting ingress cleanly and refreshes its cached surface on the next request', async () => {
  const { createServer } = await import('node:http');
  let requests = 0,
    surfaces = 0;
  const server = createServer((_request, response) => {
    requests++;
    response
      .writeHead(503, { 'Content-Type': 'text/plain' })
      .end('503: Service temporarily unavailable');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
  const helper = new HausHelper({
    request: async () => ({ addons: [{ slug: 'haus-helper', state: 'started' }] }),
    addonSurface: async () => {
      surfaces++;
      return { url: `http://127.0.0.1:${address.port}/` };
    },
  } as unknown as HomeAssistantConnection);
  try {
    await expect(helper.request({ method: 'GET', path: '/api/status' })).rejects.toThrow(
      'reconnecting',
    );
    await expect(helper.request({ method: 'GET', path: '/api/status' })).rejects.toThrow(
      'reconnecting',
    );
    expect(requests).toBe(2);
    expect(surfaces).toBe(2);
  } finally {
    helper.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('finishes compatibility preparation before acquiring an NVR media grant and shares repeated reads', async () => {
  const { createServer } = await import('node:http');
  let prepared = false,
    preparations = 0,
    prematureGrant = false;
  let base = '';
  const server = createServer((request, response) => {
    if (request.url?.endsWith('/prepare')) {
      preparations++;
      setTimeout(() => {
        prepared = true;
        response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
      }, 20);
    } else if (request.url?.endsWith('/source')) {
      prematureGrant ||= !prepared;
      const expiresAt = Date.now() + 60000;
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          source: {
            url: `${base}/media/${'a'.repeat(64)}?expires=${expiresAt}&nonce=${'b'.repeat(32)}&signature=${'c'.repeat(64)}`,
            expiresAt,
          },
        }),
      );
    } else
      response
        .writeHead(200, { 'Content-Type': 'video/mp4' })
        .end(prepared ? 'compatible-video' : 'legacy-video');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
  base = `http://127.0.0.1:${address.port}`;
  const helper = new HausHelper({
    request: async () => ({ addons: [{ slug: 'haus-helper', state: 'started' }] }),
    addonSurface: async () => ({ url: base + '/' }),
  } as unknown as HomeAssistantConnection);
  try {
    const url = 'haus-media://recordings/00000000-0000-0000-0000-000000000001/video?format=1';
    const replies = await Promise.all([helper.media(url, null), helper.media(url, 'bytes=0-15')]);
    expect(await Promise.all(replies.map((response) => response.text()))).toEqual([
      'compatible-video',
      'compatible-video',
    ]);
    expect(preparations).toBe(1);
    expect(prematureGrant).toBe(false);
  } finally {
    helper.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
