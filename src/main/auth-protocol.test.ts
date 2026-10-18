import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { authorize, InvalidSessionError, refreshAccessToken } from './auth-protocol';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

async function tokenServer(status = 200): Promise<{ url: string; bodies: URLSearchParams[] }> {
  const bodies: URLSearchParams[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    bodies.push(new URLSearchParams(Buffer.concat(chunks).toString()));
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        access_token: 'test-access',
        refresh_token: 'test-refresh',
        expires_in: 1800,
      }),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture port.');
  return { url: `http://127.0.0.1:${address.port}`, bodies };
}

describe('browser OAuth loopback flow', () => {
  it('rejects a wrong state, exchanges the valid code, then closes its callback listener', async () => {
    const fixture = await tokenServer();
    let callbackUrl = '';
    const result = await authorize(
      fixture.url,
      async (url) => {
        const authorization = new URL(url);
        callbackUrl = authorization.searchParams.get('redirect_uri')!;
        const incorrect = new URL(callbackUrl);
        incorrect.search = new URLSearchParams({ code: 'untrusted', state: 'wrong' }).toString();
        expect((await fetch(incorrect)).status).toBe(400);
        const correct = new URL(callbackUrl);
        correct.search = new URLSearchParams({
          code: 'one-time-code',
          state: authorization.searchParams.get('state')!,
        }).toString();
        expect((await fetch(correct)).status).toBe(200);
        expect(new URL(callbackUrl).origin).toBe(
          new URL(authorization.searchParams.get('client_id')!).origin,
        );
      },
      new AbortController().signal,
    );
    expect(result.session.refreshToken).toBe('test-refresh');
    expect(result.token.accessToken).toBe('test-access');
    expect(fixture.bodies).toHaveLength(1);
    expect(fixture.bodies[0].get('code')).toBe('one-time-code');
    expect(fixture.bodies[0].get('client_id')).toBe(result.session.clientId);
    await expect(fetch(callbackUrl)).rejects.toThrow();
  });

  it('cancels and releases the listener when the app disconnects', async () => {
    const fixture = await tokenServer();
    const controller = new AbortController();
    let callbackUrl = '';
    const flow = authorize(
      fixture.url,
      async (url) => {
        callbackUrl = new URL(url).searchParams.get('redirect_uri')!;
        controller.abort();
      },
      controller.signal,
    );
    await expect(flow).rejects.toThrow('cancelled');
    await expect(fetch(callbackUrl)).rejects.toThrow();
    expect(fixture.bodies).toHaveLength(0);
  });

  it('uses the original client id when refreshing and identifies revoked sessions', async () => {
    const fixture = await tokenServer(400);
    await expect(
      refreshAccessToken({
        url: fixture.url,
        name: 'Home',
        refreshToken: 'test-refresh',
        clientId: 'http://127.0.0.1:43210/',
      }),
    ).rejects.toBeInstanceOf(InvalidSessionError);
    expect(fixture.bodies[0].get('grant_type')).toBe('refresh_token');
    expect(fixture.bodies[0].get('client_id')).toBe('http://127.0.0.1:43210/');
  });
});
