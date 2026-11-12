/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientSessionCredentials } from '@haus/core/auth';
import { HubConnection } from './connection';

const hubUrl = 'http://127.0.0.1:8090';
const cameraId = 'camera.porch';
const jpeg = Buffer.from([255, 216, 255, 217]);
const credentials: ClientSessionCredentials = {
  hubUrl,
  sessionId: 'session-id',
  sessionToken: 'private-session-token',
  refreshToken: 'private-refresh-token',
  hubId: 'hub-id',
  homeId: 'home-id',
  clientId: 'client-id',
  clientName: 'Test Desktop',
  clientRole: 'admin',
  expiresAt: Date.now() + 60_000,
};

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

function createFixture(
  snapshot: () => Promise<Response> = async () =>
    new Response(jpeg, {
      status: 200,
      headers: {
        'content-type': 'image/jpeg',
        'content-length': String(jpeg.length),
        'x-haus-snapshot-stale': '0',
        'x-haus-snapshot-captured-at': '1700000000000',
      },
    }),
  session: ClientSessionCredentials = credentials,
  cache = new Map<string, { image: string; receivedAt: number; capturedAt?: number }>(),
) {
  const store = {
    assertAvailable: vi.fn(),
    loadHubSession: vi.fn(async () => session),
    saveHubSession: vi.fn(async () => undefined),
    clearHubSession: vi.fn(async () => undefined),
    cameraSnapshots: {
      get: vi.fn(async (home: string, id: string) => cache.get(`${home}\0${id}`) ?? null),
      put: vi.fn(
        (
          home: string,
          id: string,
          value: { image: string; receivedAt: number; capturedAt?: number },
        ) => {
          cache.set(`${home}\0${id}`, value);
        },
      ),
    },
  };
  const fetchFn = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url === `${session.hubUrl}/api/auth/resume`)
      return json({
        status: 'active',
        session: {
          sessionId: session.sessionId,
          hubId: session.hubId,
          homeId: session.homeId,
          clientId: session.clientId,
          clientRole: session.clientRole,
          clientName: session.clientName,
          issuedAt: Date.now() - 1000,
          expiresAt: session.expiresAt,
          state: 'active',
        },
      });
    if (url === `${session.hubUrl}/api/auth/identity`)
      return json({ hub: { hubId: session.hubId, homeId: session.homeId, name: 'Haus' } });
    if (url === `${session.hubUrl}/api/cameras/${cameraId}/snapshot`) return snapshot();
    return new Response('{}', { status: 404 });
  });
  const emit = vi.fn();
  const connection = new HubConnection(store, emit, fetchFn as typeof fetch);
  return { connection, emit, fetchFn, store, cache };
}

const connections: HubConnection[] = [];
afterEach(() => {
  for (const connection of connections.splice(0)) connection.dispose();
  vi.useRealTimers();
});

describe('HubConnection camera snapshots', () => {
  it('retries a transient network failure for idempotent Hub reads', async () => {
    const fixture = createFixture();
    connections.push(fixture.connection);
    const fallback = fixture.fetchFn.getMockImplementation();
    if (!fallback) throw new Error('Expected a fetch fixture.');
    let identityReads = 0;
    fixture.fetchFn.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/auth/identity' && identityReads++ === 0)
        throw new TypeError('fetch failed');
      if (path === '/api/devices') return json({ devices: [] });
      if (path === '/api/states') return json({ states: {} });
      return fallback(input, init);
    });

    await expect(fixture.connection.getSession()).resolves.toMatchObject({
      kind: 'haus-hub',
      url: hubUrl,
    });
    await expect(fixture.connection.request({ type: 'get_states' })).resolves.toEqual([]);
    expect(identityReads).toBe(2);
    expect(
      fixture.fetchFn.mock.calls.filter(([input]) => String(input).endsWith('/api/devices')),
    ).toHaveLength(1);
  });

  it('reports the failed Hub path without exposing the origin or credentials', async () => {
    const fixture = createFixture();
    connections.push(fixture.connection);
    fixture.fetchFn.mockImplementation(async (input) => {
      if (String(input).endsWith('/api/auth/resume'))
        return json({
          status: 'active',
          session: {
            sessionId: credentials.sessionId,
            hubId: credentials.hubId,
            homeId: credentials.homeId,
            clientId: credentials.clientId,
            clientRole: credentials.clientRole,
            clientName: credentials.clientName,
            issuedAt: Date.now() - 1000,
            expiresAt: credentials.expiresAt,
            state: 'active',
          },
        });
      if (String(input).endsWith('/api/auth/identity'))
        return json({
          hub: { hubId: credentials.hubId, homeId: credentials.homeId, name: 'Haus' },
        });
      if (String(input).endsWith('/api/devices')) return json({ devices: [] });
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    });

    await fixture.connection.getSession();
    await expect(fixture.connection.request({ type: 'get_states' })).rejects.toThrow(
      'Could not reach the Haus Hub at 127.0.0.1:8090 for /api/states (ECONNREFUSED).',
    );
    expect(
      fixture.fetchFn.mock.calls.every(
        ([input]) => !String(input).includes('private-session-token'),
      ),
    ).toBe(true);
  });

  it('keeps the saved Hub selected offline and resumes polling when it returns', async () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    connections.push(fixture.connection);
    const fallback = fixture.fetchFn.getMockImplementation();
    if (!fallback) throw new Error('Expected a fetch fixture.');
    let resumeReads = 0;
    fixture.fetchFn.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/auth/resume') {
        resumeReads += 1;
        if (resumeReads < 3) throw new TypeError('fetch failed');
      }
      if (path === '/api/devices') return json({ devices: [] });
      if (path === '/api/states') return json({ states: {} });
      return fallback(input, init);
    });

    await expect(fixture.connection.getSession()).resolves.toMatchObject({
      kind: 'haus-hub',
      url: hubUrl,
    });
    expect(fixture.connection.connected).toBe(false);
    expect(fixture.emit).toHaveBeenCalledWith({ type: 'connection', status: 'reconnecting' });

    await vi.advanceTimersByTimeAsync(2000);
    expect(fixture.connection.connected).toBe(true);
    expect(resumeReads).toBe(3);
    expect(fixture.emit).toHaveBeenCalledWith({ type: 'connection', status: 'connected' });
  });

  it('uses the authenticated Hub endpoint and caches the captured frame by Hub', async () => {
    const fixture = createFixture();
    connections.push(fixture.connection);
    await fixture.connection.getSession();

    const frame = await fixture.connection.cameraSnapshot(cameraId);
    expect(frame).toMatchObject({
      image: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      capturedAt: 1_700_000_000_000,
      fresh: true,
    });
    const request = fixture.fetchFn.mock.calls.find(([input]) =>
      String(input).endsWith(`/api/cameras/${cameraId}/snapshot`),
    );
    expect(request?.[1]?.headers).toEqual({ authorization: `Bearer ${credentials.sessionToken}` });
    expect(request?.[1]?.redirect).toBe('error');
    expect(fixture.store.cameraSnapshots.put).toHaveBeenCalledWith(
      credentials.homeId,
      cameraId,
      expect.objectContaining({ capturedAt: 1_700_000_000_000 }),
    );
    expect(await fixture.connection.cameraLastSnapshot(cameraId)).toMatchObject({
      capturedAt: 1_700_000_000_000,
    });
  });

  it('deduplicates concurrent reads and carries forward the last capture time for stale frames', async () => {
    let resolveSnapshot!: (response: Response) => void;
    const held = new Promise<Response>((resolve) => {
      resolveSnapshot = resolve;
    });
    let requestCount = 0;
    const fixture = createFixture(() => {
      requestCount += 1;
      if (requestCount === 1) return held;
      return Promise.resolve(
        new Response(jpeg, {
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
            'x-haus-snapshot-stale': '1',
            'x-haus-snapshot-captured-at': '0',
          },
        }),
      );
    });
    connections.push(fixture.connection);
    await fixture.connection.getSession();

    const first = fixture.connection.cameraSnapshot(cameraId);
    const second = fixture.connection.cameraSnapshot(cameraId);
    await Promise.resolve();
    expect(
      fixture.fetchFn.mock.calls.filter(([input]) => String(input).endsWith('/snapshot')),
    ).toHaveLength(1);
    resolveSnapshot(
      new Response(jpeg, {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
          'x-haus-snapshot-stale': '0',
          'x-haus-snapshot-captured-at': '1700000000000',
        },
      }),
    );
    const [one, two] = await Promise.all([first, second]);
    expect(one).toEqual(two);
    expect(one).toMatchObject({ fresh: true, capturedAt: 1_700_000_000_000 });
    const stale = await fixture.connection.cameraSnapshot(cameraId);
    expect(stale).toMatchObject({ fresh: false, capturedAt: 1_700_000_000_000 });
  });

  it('rejects invalid camera IDs and unsupported image bodies', async () => {
    const fixture = createFixture(
      async () =>
        new Response('not an image', {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
    );
    connections.push(fixture.connection);
    await fixture.connection.getSession();

    await expect(fixture.connection.cameraSnapshot('camera.Bad')).rejects.toThrow(
      'Select a valid camera.',
    );
    await expect(fixture.connection.cameraSnapshot(cameraId)).rejects.toThrow(
      'The Hub returned an invalid snapshot.',
    );
  });

  it('bounds declared and streamed snapshot payloads', async () => {
    const declared = createFixture(
      async () =>
        new Response(jpeg, {
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
            'content-length': String(6 * 1024 * 1024 + 1),
          },
        }),
    );
    connections.push(declared.connection);
    await declared.connection.getSession();
    await expect(declared.connection.cameraSnapshot(cameraId)).rejects.toThrow(
      'The Hub returned an unsupported snapshot.',
    );

    const fixture = createFixture(
      async () =>
        new Response(new Uint8Array(6 * 1024 * 1024 + 1), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
    );
    connections.push(fixture.connection);
    await fixture.connection.getSession();

    await expect(fixture.connection.cameraSnapshot(cameraId)).rejects.toThrow(
      'The camera snapshot is too large.',
    );
  });

  it('keeps cached frames scoped to the current home, not just the Hub address', async () => {
    const cache = new Map<string, { image: string; receivedAt: number; capturedAt?: number }>();
    const first = createFixture(undefined, credentials, cache);
    connections.push(first.connection);
    await first.connection.getSession();
    await first.connection.cameraSnapshot(cameraId);

    const otherHome = { ...credentials, homeId: 'another-home-id' };
    const second = createFixture(undefined, otherHome, cache);
    connections.push(second.connection);
    await second.connection.getSession();
    await expect(second.connection.cameraLastSnapshot(cameraId)).resolves.toBeNull();
  });

  it('does not cache a pending frame after the active Hub session is disconnected', async () => {
    let resolveSnapshot!: (response: Response) => void;
    const held = new Promise<Response>((resolve) => {
      resolveSnapshot = resolve;
    });
    const fixture = createFixture(() => held);
    connections.push(fixture.connection);
    await fixture.connection.getSession();

    const pending = fixture.connection.cameraSnapshot(cameraId);
    await Promise.resolve();
    await fixture.connection.disconnect();
    resolveSnapshot(
      new Response(jpeg, {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
          'x-haus-snapshot-stale': '0',
          'x-haus-snapshot-captured-at': '1700000000000',
        },
      }),
    );

    await expect(pending).rejects.toThrow('The connected home changed.');
    expect(fixture.cache.size).toBe(0);
  });
});
