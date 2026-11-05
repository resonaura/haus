/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import {
  haCredentialCodec,
  haProviderAddress,
  refreshHaCredential,
} from '../src/provider/index.js';
import type { HaCredential } from '../src/provider/index.js';

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
});
async function fixture(handle: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handle);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('invalid_fixture_address');
  return haProviderAddress(`http://127.0.0.1:${address.port}/prefix`);
}
const credential: HaCredential = {
  kind: 'oauth',
  accessToken: 'private-original-access',
  refreshToken: 'private-original-refresh',
  clientId: 'https://haus.example/',
  expiresAt: 1,
};

it('encodes validated independent credentials and rejects extra or malformed fields without echoing secrets', () => {
  const bytes = haCredentialCodec.encode(credential);
  expect(haCredentialCodec.decode(bytes)).toEqual(credential);
  expect(haCredentialCodec.decode(bytes)).not.toBe(credential);
  for (const payload of [
    { version: 2, credential },
    { version: 1, credential, extra: true },
    { version: 1, credential: { ...credential, accessToken: '' } },
    { version: 1, credential: { ...credential, expiresAt: 'invalid' } },
    { version: 1, credential: { ...credential, kind: 'token' } },
  ])
    expect(() =>
      haCredentialCodec.decode(new TextEncoder().encode(JSON.stringify(payload))),
    ).toThrow('invalid_ha_credential');
  expect(() => haCredentialCodec.decode(new Uint8Array(65537))).toThrow('invalid_ha_credential');
  expect(() => haCredentialCodec.decode(new Uint8Array([255]))).toThrow('invalid_ha_credential');
  expect(
    haCredentialCodec.decode(
      haCredentialCodec.encode({ kind: 'token', accessToken: 'private-static' }),
    ),
  ).toEqual({ kind: 'token', accessToken: 'private-static' });
});

it('keeps proxy prefixes and permits only credential-free matching HTTP/WebSocket origins', () => {
  const address = haProviderAddress('https://ha.example/prefix');
  expect(address.base.href).toBe('https://ha.example/prefix/');
  expect(address.websocket.href).toBe('wss://ha.example/prefix/api/websocket');
  expect(
    haProviderAddress('http://supervisor/core', 'ws://supervisor/core/websocket').websocket.href,
  ).toBe('ws://supervisor/core/websocket');
  for (const [base, socket] of [
    ['ftp://ha.example/'],
    ['https://user:private@ha.example/'],
    ['https://ha.example/?token=private'],
    ['https://ha.example/#private'],
    ['https://ha.example/', 'ws://ha.example/api/websocket'],
    ['https://ha.example/', 'wss://other.example/api/websocket'],
    ['https://ha.example/', 'wss://ha.example/api/websocket?token=private'],
  ])
    expect(() => haProviderAddress(base, socket)).toThrow('invalid_ha_provider_address');
});

it.each([false, true])(
  'refreshes once on the enrolled prefixed endpoint; optional rotation=%s',
  async (rotate) => {
    const received: { path: string | undefined; body: URLSearchParams }[] = [];
    const address = await fixture((request, response) => {
      void (async () => {
        let body = '';
        for await (const value of request) {
          const bytes: unknown = value;
          if (!(bytes instanceof Uint8Array)) throw Error('invalid_fixture_body');
          body += new TextDecoder().decode(bytes);
        }
        received.push({ path: request.url, body: new URLSearchParams(body) });
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            access_token: 'private-new-access',
            expires_in: 1800,
            ...(rotate ? { refresh_token: 'private-new-refresh', token_type: 'Bearer' } : {}),
          }),
        );
      })().catch(() => {
        response.statusCode = 500;
        response.end();
      });
    });
    const result = await refreshHaCredential(address, credential, new AbortController().signal);
    expect(received).toHaveLength(1);
    expect(received[0]?.path).toBe('/prefix/auth/token');
    expect(received[0]?.body.get('refresh_token')).toBe('private-original-refresh');
    expect(received[0]?.body.get('client_id')).toBe('https://haus.example/');
    expect(received[0]?.body.get('grant_type')).toBe('refresh_token');
    expect(result).toMatchObject({
      status: 'renewed',
      credential: {
        accessToken: 'private-new-access',
        refreshToken: rotate ? 'private-new-refresh' : 'private-original-refresh',
      },
    });
    if (result.status !== 'renewed' || result.credential.kind !== 'oauth')
      throw Error('invalid_fixture_result');
    expect(result.credential.expiresAt).toBeGreaterThan(Date.now());
  },
);

it.each([400, 401, 403])(
  'reports definitive rejection %s without retrying or returning the provider body',
  async (status) => {
    let calls = 0;
    const address = await fixture((_request, response) => {
      calls++;
      response.statusCode = status;
      response.end('private-provider-details');
    });
    expect(await refreshHaCredential(address, credential, new AbortController().signal)).toEqual({
      status: 'reauth-required',
    });
    expect(calls).toBe(1);
  },
);

it.each(['redirect', 'server', 'malformed', 'oversized', 'token-type'] as const)(
  'fails closed without retrying an uncertain %s refresh',
  async (mode) => {
    let calls = 0,
      targetCalls = 0;
    const target = await fixture((_request, response) => {
      targetCalls++;
      response.end('must-not-follow');
    });
    const address = await fixture((_request, response) => {
      calls++;
      if (mode === 'redirect') response.writeHead(307, { Location: target.base.href });
      if (mode === 'server') response.statusCode = 503;
      response.end(
        mode === 'oversized'
          ? JSON.stringify({
              access_token: 'private-token',
              expires_in: 1800,
              padding: 'x'.repeat(65537),
            })
          : mode === 'token-type'
            ? JSON.stringify({
                access_token: 'private-token',
                expires_in: 1800,
                token_type: 'Invalid',
              })
            : 'private-malformed-body',
      );
    });
    await expect(
      refreshHaCredential(address, credential, new AbortController().signal),
    ).rejects.toThrow('ha_refresh_unavailable');
    expect(calls).toBe(1);
    expect(targetCalls).toBe(0);
  },
);

it('does not request refresh for static credentials or an already-cancelled attempt', async () => {
  let calls = 0;
  const address = await fixture((_request, response) => {
    calls++;
    response.end();
  });
  const controller = new AbortController();
  controller.abort();
  await expect(refreshHaCredential(address, credential, controller.signal)).rejects.toThrow(
    'ha_refresh_unavailable',
  );
  expect(
    await refreshHaCredential(
      address,
      { kind: 'token', accessToken: 'private-static' },
      new AbortController().signal,
    ),
  ).toEqual({ status: 'reauth-required' });
  expect(calls).toBe(0);
});

it('cancels an in-flight refresh without retrying after the server has accepted the request', async () => {
  let calls = 0,
    accept = () => {};
  const accepted = new Promise<void>((resolve) => {
    accept = resolve;
  });
  const address = await fixture(() => {
    calls++;
    accept();
  });
  const controller = new AbortController();
  const pending = refreshHaCredential(address, credential, controller.signal);
  const rejected = expect(pending).rejects.toThrow('ha_refresh_unavailable');
  await accepted;
  controller.abort();
  await rejected;
  expect(calls).toBe(1);
});
