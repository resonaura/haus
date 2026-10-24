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
  expect(
    validateHelperRequest({
      method: 'PATCH',
      path: '/api/preferences',
      data: {
        baseRevision: '0',
        patch: { serverDevices: { miku: { name: 'Miku', areaId: 'narnia', icon: 'linux' } } },
      },
    }).data?.patch,
  ).toEqual({ serverDevices: { miku: { name: 'Miku', areaId: 'narnia', icon: 'linux' } } });
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

it('identifies an unavailable helper viewer route without confusing it with camera errors', async () => {
  const { createServer } = await import('node:http');
  let errorCode = 'not_found';
  const server = createServer((_request, response) => {
    response
      .writeHead(404, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: errorCode }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
  const helper = new HausHelper({
    request: async () => ({ addons: [{ slug: 'haus-helper', state: 'started' }] }),
    addonSurface: async () => ({ url: `http://127.0.0.1:${address.port}/` }),
  } as unknown as HomeAssistantConnection);
  try {
    await expect(
      helper.request({
        method: 'POST',
        path: '/api/cameras/camera.entry/viewer',
        data: { viewerId: '26c1f67d-9ce3-4099-8f1a-42c6826be001', offer: 'v=0\r\n' },
      }),
    ).rejects.toThrow('helper_viewer_route_missing');
    errorCode = 'camera_not_found';
    await expect(
      helper.request({
        method: 'POST',
        path: '/api/cameras/camera.entry/viewer',
        data: { viewerId: '26c1f67d-9ce3-4099-8f1a-42c6826be001', offer: 'v=0\r\n' },
      }),
    ).rejects.toThrow('helper_camera_not_registered');
  } finally {
    helper.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('shares clip preparation across the timeline and parallel NVR media reads', async () => {
  const { createServer } = await import('node:http');
  let prepared = false,
    preparations = 0,
    prematureGrant = false;
  let base = '';
  const server = createServer((request, response) => {
    if (request.url?.endsWith('/prepare')) {
      preparations++;
      expect(request.headers['x-haus-async-prepare']).toBe('1');
      if (preparations < 3) {
        response
          .writeHead(202, { 'Content-Type': 'application/json' })
          .end('{"status":"preparing"}');
        return;
      }
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
    const id = '00000000-0000-0000-0000-000000000001';
    const url = 'haus-media://recordings/00000000-0000-0000-0000-000000000001/video?format=1';
    const [preparedEvent, ...replies] = await Promise.all([
      helper.request({ method: 'GET', path: `/api/events/${id}/prepare` }),
      helper.media(url, null),
      helper.media(url, 'bytes=0-15'),
    ]);
    expect(preparedEvent).toEqual({});
    expect(await Promise.all(replies.map((response) => response.text()))).toEqual([
      'compatible-video',
      'compatible-video',
    ]);
    expect(preparations).toBe(3);
    expect(prematureGrant).toBe(false);
  } finally {
    helper.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('serves policy-verified original recordings without waiting for preparation', async () => {
  const { createServer } = await import('node:http');
  const requests: string[] = [];
  let base = '';
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    response.writeHead(200, { 'Content-Type': 'video/mp4' }).end('verified-original');
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
    const id = '00000000-0000-0000-0000-000000000002';
    const response = await helper.media(
      `haus-media://recordings/${id}/video?format=1&original=1`,
      'bytes=0-7',
    );
    expect(await response.text()).toBe('verified-original');
    expect(requests).toEqual([`/api/events/${id}/original`]);
    await expect(
      helper.media(`haus-media://recordings/${id}/video?original=1`, null),
    ).rejects.toThrow('Invalid recording address.');
  } finally {
    helper.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('permits bounded server quotas and host inventory without opening generic node administration', () => {
  expect(validateHelperRequest({ method: 'GET', path: '/api/servers' }).path).toBe('/api/servers');
  const node = '/api/cluster/nodes/00000000-0000-0000-0000-000000000001';
  for (const path of [node, '/api/servers/home-assistant']) {
    for (const storageLimitBytes of [null, 1024 ** 3, 1024 ** 4])
      expect(
        validateHelperRequest({ method: 'PATCH', path, data: { storageLimitBytes } }).data,
      ).toEqual({ storageLimitBytes });
    for (const storageLimitBytes of [-1, 0, 1.5, 'unlimited', Number.MAX_SAFE_INTEGER + 1])
      expect(() =>
        validateHelperRequest({ method: 'PATCH', path, data: { storageLimitBytes } }),
      ).toThrow();
    expect(() =>
      validateHelperRequest({
        method: 'PATCH',
        path,
        data: { storageLimitBytes: null, command: 'erase' },
      }),
    ).toThrow();
  }
  expect(
    validateHelperRequest({
      method: 'PATCH',
      path: node,
      data: { enabled: false, storageLimitBytes: null },
    }).data,
  ).toEqual({ enabled: false, storageLimitBytes: null });
  for (const request of [
    { method: 'PATCH', path: '/api/servers/home-assistant', data: { enabled: false } },
    { method: 'PATCH', path: node, data: {} },
    { method: 'GET', path: '/api/servers?token=private' },
    { method: 'POST', path: '/api/servers/home-assistant/reboot', data: {} },
  ])
    expect(() => validateHelperRequest(request)).toThrow();
});

it('repairs decoder failures once and discards the original media grant before reloading', async () => {
  const id = '00000000-0000-0000-0000-000000000001';
  let repaired = false,
    repairs = 0,
    prepares = 0,
    grants = 0;
  const server = createServer((req, res) => {
    if (req.url?.endsWith('/repair')) {
      expect(req.method).toBe('POST');
      repairs++;
      setTimeout(() => {
        repaired = true;
        res
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ id, repaired }));
      }, 25);
    } else if (req.url?.endsWith('/prepare')) {
      prepares++;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id }));
    } else if (req.url?.endsWith('/source')) {
      grants++;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    } else res.writeHead(200).end(repaired ? 'repaired-video' : 'original-video');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const helper = new HausHelper({
    request: async () => ({ addons: [{ slug: 'haus-helper', state: 'started' }] }),
    addonSurface: async () => ({ url: `http://127.0.0.1:${address.port}/` }),
  } as unknown as HomeAssistantConnection);
  const url = `haus-media://recordings/${id}/video?format=1`;
  try {
    expect(await (await helper.media(url, null)).text()).toBe('original-video');
    const request = { method: 'POST', path: `/api/events/${id}/repair`, data: {} };
    const [first, second, media] = await Promise.all([
      helper.request(request),
      helper.request(request),
      helper.media(url, null),
    ]);
    expect(first).toEqual({ id, repaired: true });
    expect(second).toEqual(first);
    expect(await media.text()).toBe('repaired-video');
    expect({ repairs, prepares, grants }).toEqual({ repairs: 1, prepares: 1, grants: 2 });
    for (const data of [undefined, { force: true }, { source: 'other' }])
      expect(() => validateHelperRequest({ ...request, data })).toThrow();
  } finally {
    helper.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('permits only scoped NVR viewer SDP and close operations, never source URLs or forged owners', () => {
  const request = {
    method: 'POST',
    path: '/api/cameras/camera.fixture/viewer',
    data: {
      viewerId: '26c1f67d-9ce3-4099-8f1a-42c6826be001',
      offer: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n',
    },
  };
  expect(validateHelperRequest(request)).toEqual(request);
  expect(
    validateHelperRequest({
      ...request,
      path: request.path + '/close',
      data: { viewerId: request.data.viewerId },
    }).method,
  ).toBe('POST');
  for (const data of [
    { ...request.data, owner: 'forged' },
    { ...request.data, url: 'rtsp://private' },
    { ...request.data, viewerId: '../../arbitrary' },
    { ...request.data, offer: 'rtsp://private' },
    { ...request.data, offer: 'v=0' + 'x'.repeat(62000) },
    { ...request.data, offer: 'v=0\0' },
  ])
    expect(() => validateHelperRequest({ ...request, data })).toThrow();
  expect(() => validateHelperRequest({ ...request, path: request.path + '/close' })).toThrow();
});

it('owns viewer leases in main and releases them against the old home on disconnect', async () => {
  const requests: { path: string; data: Record<string, unknown> }[] = [];
  let released!: () => void;
  const release = new Promise<void>((resolve) => {
    released = resolve;
  });
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ path: request.url!, data: JSON.parse(body) });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify(
        request.url?.endsWith('/viewer')
          ? { answer: { type: 'answer', sdp: 'v=0\r\n' } }
          : { warm: false },
      ),
    );
    if (request.url?.endsWith('/close')) released();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const helper = new HausHelper({
    request: async () => ({
      addons: [{ slug: 'local_haus-helper', name: 'Haus', state: 'started' }],
    }),
    addonSurface: async () => ({ url: `http://127.0.0.1:${address.port}/`, cookie: 'fixture' }),
  } as unknown as HomeAssistantConnection);
  try {
    const viewerId = '26c1f67d-9ce3-4099-8f1a-42c6826be001';
    await helper.request({
      method: 'POST',
      path: '/api/cameras/camera.fixture/warm',
      data: { active: true },
    });
    await helper.request({
      method: 'POST',
      path: '/api/cameras/camera.fixture/viewer',
      data: { viewerId, offer: 'v=0\r\n' },
    });
    helper.clear();
    await release;
    expect(requests.map((request) => request.path)).toContain('/api/cameras/camera.fixture/warm');
    expect(requests.find((request) => request.path.endsWith('/close'))?.data).toEqual({
      viewerId,
      owner: requests[0].data.owner,
    });
    expect(typeof requests[0].data.owner).toBe('string');
    expect(requests[1].data.owner).toBe(requests[0].data.owner);
  } finally {
    helper.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
