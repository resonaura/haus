import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { CameraAccessClient } from './camera-access-client';

it('uses an already ready replacement before a pinned node that is still warming, preserving the pin when both are ready', async () => {
  const expiresAt = Date.now() + 3600000;
  const requests: string[] = [];
  const ready = [true, false];
  const servers = [0, 1].map((index) =>
    createServer((req, res) => {
      req.resume();
      if (req.method === 'POST') requests.push(`${index}:${req.url}`);
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify(
          req.method === 'GET'
            ? { cameraId: 'camera.fixture', ready: ready[index], present: true, active: 1, max: 1 }
            : { warm: true, answer: { type: 'answer', sdp: 'v=0\r\nfixture' } },
        ),
      );
    }),
  );
  await Promise.all(
    servers.map((server) => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))),
  );
  const client = new CameraAccessClient(
    () => 'home',
    {
      loadCameraAccess: async () => undefined,
      saveCameraAccess: async () => {},
    },
    async () => ({
      cameraId: 'camera.fixture',
      expiresAt,
      nodes: servers.map((server, index) => ({
        nodeId: String(index),
        url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
        allowHttp: true,
        id: String(index + 1).repeat(32),
        key: String(index + 1).repeat(64),
        cameraId: 'camera.fixture',
        expiresAt,
      })),
    }),
  );
  try {
    await client.prepare('camera.fixture');
    await client.request('camera.fixture', 'warm', { active: true });
    expect(requests.at(-1)).toBe('0:/v1/client/camera/warm');
    ready[0] = false;
    ready[1] = true;
    await client.request('camera.fixture', 'viewer', {
      viewerId: randomUUID(),
      offer: 'v=0\r\nfixture',
    });
    expect(requests.at(-1)).toBe('1:/v1/client/camera/viewer');
    ready[0] = true;
    await client.request('camera.fixture', 'warm', { active: true });
    expect(requests.at(-1)).toBe('1:/v1/client/camera/warm');
  } finally {
    client.clear();
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
    );
  }
});

it('cannot use an already loaded camera capability after its account session disappears', async () => {
  let scope: string | undefined = 'home';
  const expiresAt = Date.now() + 3600000;
  const client = new CameraAccessClient(
    () => scope,
    {
      loadCameraAccess: async () => ({
        scope: 'home',
        cameras: {
          'camera.fixture': {
            cameraId: 'camera.fixture',
            requestedId: 'camera.fixture',
            expiresAt,
            nodes: [
              {
                nodeId: 'fixture',
                url: 'http://127.0.0.1:1',
                allowHttp: true,
                id: 'a'.repeat(32),
                key: 'b'.repeat(64),
                cameraId: 'camera.fixture',
                expiresAt,
              },
            ],
          },
        },
      }),
      saveCameraAccess: async () => {},
    },
    async () => null,
  );
  try {
    expect(await client.available('camera.fixture')).toBe(true);
    scope = undefined;
    expect(await client.available('camera.fixture')).toBe(false);
    await expect(client.request('camera.fixture', 'warm', { active: true })).rejects.toThrow(
      'Connect to your home first',
    );
  } finally {
    client.clear();
  }
});

it('reconnects to a scoped healthy node without Helper and isolates simultaneous instances sharing an encrypted cache', async () => {
  const key = '1'.repeat(64),
    requests: { path: string; data: Record<string, unknown> }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks).toString();
    const h = req.headers;
    expect(h['x-haus-digest']).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(h['x-haus-signature']).toBe(
      createHmac('sha256', key)
        .update(
          [req.method, req.url, h['x-haus-time'], h['x-haus-nonce'], h['x-haus-digest']].join('\n'),
        )
        .digest('hex'),
    );
    const data = bytes ? JSON.parse(bytes) : {};
    requests.push({ path: req.url!, data });
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        req.method === 'GET'
          ? { cameraId: 'camera.fixture', ready: true, present: true, active: 1, max: 1 }
          : req.url?.endsWith('/viewer')
            ? { answer: { type: 'answer', sdp: 'v=0\r\nfixture' }, candidates: [] }
            : { warm: data.active, closed: true },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const value = {
    cameraId: 'camera.fixture',
    expiresAt: Date.now() + 20 * 3600000,
    nodes: [
      {
        nodeId: 'dead',
        url: 'http://127.0.0.1:1',
        allowHttp: true,
        id: 'a'.repeat(32),
        cameraId: 'camera.fixture',
        expiresAt: 0,
        key,
      },
      {
        nodeId: 'healthy',
        url: `http://127.0.0.1:${port}`,
        allowHttp: true,
        id: 'b'.repeat(32),
        cameraId: 'camera.fixture',
        expiresAt: 0,
        key,
      },
    ],
  };
  value.nodes.forEach((node) => (node.expiresAt = value.expiresAt));
  let cache: unknown;
  const store = {
    loadCameraAccess: async () => cache,
    saveCameraAccess: async (scope: string, clientId: string, id: string, routes: unknown) => {
      cache = { scope, clientId, cameras: { [id]: routes } };
    },
  };
  let issues = 0,
    helper = true;
  const observed: unknown[] = [];
  const a = new CameraAccessClient(
    () => 'https://home.fixture',
    store,
    async (camera) => {
      issues++;
      return { ...value, requestedId: camera };
    },
    () => helper,
    (_scope, sources) => observed.push(sources),
  );
  let b: CameraAccessClient | undefined;
  try {
    await a.prepare('camera.fixture');
    expect(issues).toBe(1);
    await a.prepare('camera.fixture');
    expect(issues).toBe(1);
    helper = false;
    b = new CameraAccessClient(
      () => 'https://home.fixture',
      store,
      async () => {
        throw Error('HA is unavailable');
      },
    );
    await b.prepare('camera.fixture');
    expect(await b.available('camera.fixture')).toBe(true);
    const first = await a.request('camera.fixture', 'viewer', {
      viewerId: randomUUID(),
      offer: 'v=0\r\nfixture',
    });
    const second = await b.request('camera.fixture', 'viewer', {
      viewerId: randomUUID(),
      offer: 'v=0\r\nfixture',
    });
    expect(first.answer.type).toBe('answer');
    expect(second.answer.type).toBe('answer');
    const owners = requests
      .filter((request) => request.path.endsWith('/viewer'))
      .map((request) => request.data.clientSession);
    expect(new Set(owners).size).toBe(2);
    expect(requests.every((request) => request.path.startsWith('/v1/client/camera/'))).toBe(true);
    expect(JSON.stringify(requests)).not.toContain(key);
    await a.poll();
    expect(observed).toMatchObject([[{ id: 'camera.fixture', available: true }]]);
    a.invalidate();
    expect(await a.available('camera.fixture')).toBe(false);
    await a.prepare('camera.fixture');
    expect(issues).toBe(2);
    expect(await a.available('camera.fixture')).toBe(true);
    await a.prepare('camera.alias');
    expect(await a.available('camera.alias')).toBe(true);
    await a.request('camera.alias', 'warm', { active: true });
    await expect(
      a.request('camera.fixture', 'warm', { active: true }, 'https://another.fixture'),
    ).rejects.toThrow('home changed');
  } finally {
    a.clear();
    b?.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
