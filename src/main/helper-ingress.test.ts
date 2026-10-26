import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { HausHelper } from './helper';
import type { HomeAssistantConnection } from './connection';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Fixture did not bind');
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return `http://127.0.0.1:${address.port}/`;
}
function connection(surface: () => Promise<{ url: string; cookie?: string }>) {
  return {
    request: async () => ({ addons: [{ slug: 'haus-helper', state: 'started' }] }),
    addonSurface: surface,
  } as unknown as HomeAssistantConnection;
}

it('renews a rejected ingress read once and returns the recovered timeline', async () => {
  let sessions = 0;
  const cookies: (string | undefined)[] = [];
  const url = await fixture((req, res) => {
    cookies.push(req.headers.cookie);
    if (req.headers.cookie === 'ingress_session=old') res.writeHead(503).end('Gateway offline');
    else res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"events":[]}');
  });
  const helper = new HausHelper(
    connection(async () => ({ url, cookie: ++sessions === 1 ? 'old' : 'new' })),
  );
  cleanup.push(async () => helper.clear());
  await expect(helper.request({ method: 'GET', path: '/api/events' })).resolves.toEqual({
    events: [],
  });
  expect(cookies).toEqual(['ingress_session=old', 'ingress_session=new']);
  expect(sessions).toBe(2);
});

it('coalesces simultaneous old-session failures into one renewal', async () => {
  let sessions = 0;
  const failed: ServerResponse[] = [];
  const url = await fixture((req, res) => {
    if (req.headers.cookie === 'ingress_session=old') {
      failed.push(res);
      if (failed.length === 3)
        for (const response of failed) response.writeHead(403).end('Expired');
    } else res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
  });
  const helper = new HausHelper(
    connection(async () => {
      sessions++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { url, cookie: sessions === 1 ? 'old' : 'new' };
    }),
  );
  cleanup.push(async () => helper.clear());
  await expect(
    Promise.all(
      ['/api/status', '/api/events', '/api/cameras'].map((path) =>
        helper.request({ method: 'GET', path }),
      ),
    ),
  ).resolves.toEqual([{ ok: true }, { ok: true }, { ok: true }]);
  expect(sessions).toBe(2);
});

it('never replays a recording command after a gateway failure', async () => {
  let writes = 0;
  const url = await fixture((_req, res) => {
    writes++;
    res.writeHead(503).end('Unavailable');
  });
  const helper = new HausHelper(connection(async () => ({ url })));
  cleanup.push(async () => helper.clear());
  await expect(
    helper.request({ method: 'POST', path: '/api/cameras/camera.entry/record', data: {} }),
  ).rejects.toThrow('reconnecting');
  expect(writes).toBe(1);
});

it('does not renew a valid helper error response or replay its request', async () => {
  let reads = 0,
    sessions = 0;
  const url = await fixture((_req, res) => {
    reads++;
    res
      .writeHead(503, { 'Content-Type': 'application/json' })
      .end('{"error":"source_not_available"}');
  });
  const helper = new HausHelper(
    connection(async () => {
      sessions++;
      return { url };
    }),
  );
  cleanup.push(async () => helper.clear());
  await expect(helper.request({ method: 'GET', path: '/api/status' })).rejects.toThrow();
  expect(reads).toBe(1);
  expect(sessions).toBe(1);
});

it('cannot send a renewed read into a different connected home', async () => {
  let sessions = 0,
    reads = 0;
  let renewalStarted!: () => void;
  const renewing = new Promise<void>((resolve) => {
    renewalStarted = resolve;
  });
  let finish!: (value: { url: string }) => void;
  const url = await fixture((_req, res) => {
    reads++;
    res.writeHead(401).end('Expired');
  });
  const helper = new HausHelper(
    connection(async () => {
      if (++sessions === 1) return { url };
      renewalStarted();
      return new Promise((resolve) => {
        finish = resolve;
      });
    }),
  );
  cleanup.push(async () => helper.clear());
  const request = helper.request({ method: 'GET', path: '/api/events' });
  const result = expect(request).rejects.toThrow();
  await renewing;
  helper.clear();
  await result;
  finish({ url });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(reads).toBe(1);
});

it('keeps a new session when an older request fails after renewal has finished', async () => {
  let sessions = 0;
  let late!: ServerResponse;
  let received!: () => void;
  const oldRequests = new Promise<void>((resolve) => {
    received = resolve;
  });
  let failed!: ServerResponse;
  const url = await fixture((req, res) => {
    if (req.headers.cookie === 'ingress_session=old' && req.url !== '/api/cameras') {
      if (req.url === '/api/events') late = res;
      else failed = res;
      if (late && failed) {
        failed.writeHead(503).end('Expired');
        received();
      }
    } else res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
  });
  const helper = new HausHelper(
    connection(async () => ({ url, cookie: ++sessions === 1 ? 'old' : 'new' })),
  );
  cleanup.push(async () => helper.clear());
  await helper.request({ method: 'GET', path: '/api/cameras' });
  const first = helper.request({ method: 'GET', path: '/api/status' });
  const second = helper.request({ method: 'GET', path: '/api/events' });
  await oldRequests;
  await first;
  late.writeHead(503).end('Expired old session');
  await expect(second).resolves.toEqual({ ok: true });
  expect(sessions).toBe(2);
});

it('cancels one media waiter during renewal without cancelling another caller', async () => {
  let sessions = 0,
    reads = 0;
  let started!: () => void;
  const renewing = new Promise<void>((resolve) => {
    started = resolve;
  });
  let finish!: (value: { url: string; cookie: string }) => void;
  const url = await fixture((req, res) => {
    reads++;
    if (req.headers.cookie === 'ingress_session=old') res.writeHead(503).end('Expired');
    else res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
  });
  const helper = new HausHelper(
    connection(async () => {
      if (++sessions === 1) return { url, cookie: 'old' };
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    }),
  );
  cleanup.push(async () => helper.clear());
  const abort = new AbortController();
  const cancelled = helper.media(
    'haus-media://streams/camera.entry/index.m3u8',
    null,
    abort.signal,
  );
  const rejected = expect(cancelled).rejects.toThrow();
  await renewing;
  const other = helper.request({ method: 'GET', path: '/api/status' });
  abort.abort();
  await rejected;
  finish({ url, cookie: 'new' });
  await expect(other).resolves.toEqual({ ok: true });
  expect(sessions).toBe(2);
  expect(reads).toBe(2);
});
