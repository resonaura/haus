import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { StoredSession } from './secure-store';
import { isRecord } from './validation';

export interface AccessToken {
  accessToken: string;
  expiresAt: number;
}

export class InvalidSessionError extends Error {}

export function matchesOAuthState(expected: string, actual: string | null): boolean {
  if (!actual) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Exact loopback client/redirect origin works with HA's IndieAuth rules without a public website. */
export async function authorize(
  baseUrl: string,
  openBrowser: (url: string) => Promise<void>,
  signal: AbortSignal,
): Promise<{ session: StoredSession; token: AccessToken }> {
  const state = randomBytes(32).toString('base64url');
  let clientId = '';
  let complete: (code: string) => void;
  let fail: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  // The browser callback can arrive while shell.openExternal is still resolving.
  void codePromise.catch(() => undefined);
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    );
    response.setHeader('Referrer-Policy', 'no-referrer');
    const callback = new URL(request.url ?? '/', clientId || 'http://127.0.0.1');
    if (request.method !== 'GET' || request.headers.host !== new URL(clientId).host) {
      response.writeHead(400).end('Invalid request.');
      return;
    }
    if (callback.pathname === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(
        '<!doctype html><title>Haus</title><h1>Haus</h1><p>A Home Assistant desktop client.</p>',
      );
      return;
    }
    if (callback.pathname !== '/auth/callback') {
      response.writeHead(404).end();
      return;
    }
    if (!matchesOAuthState(state, callback.searchParams.get('state'))) {
      response.writeHead(400).end('This sign-in link has expired or belongs to another app.');
      return;
    }
    const code = callback.searchParams.get('code');
    if (!code || code.length > 4096 || callback.searchParams.has('error')) {
      response.writeHead(400).end('Home Assistant sign-in was cancelled.');
      fail(new Error('Home Assistant sign-in was cancelled.'));
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(
      '<!doctype html><title>Connected to Haus</title><body style="font:18px system-ui;background:#f5f3ed;color:#272b2a;padding:64px"><h1>You’re connected.</h1><p>You can close this tab and return to Haus.</p></body>',
    );
    complete(code);
  });
  const abort = (): void => fail(new Error('Home Assistant sign-in was cancelled.'));
  const timeout = setTimeout(
    () => fail(new Error('Sign-in timed out. Try connecting again.')),
    5 * 60_000,
  );
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw new Error('Home Assistant sign-in was cancelled.');
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Could not start the local sign-in callback.');
    clientId = `http://127.0.0.1:${address.port}/`;
    const authorizeUrl = new URL('/auth/authorize', baseUrl);
    authorizeUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${clientId}auth/callback`,
      response_type: 'code',
      state,
    }).toString();
    await openBrowser(authorizeUrl.href);
    const code = await codePromise;
    const result = await tokenRequest(baseUrl, {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
    });
    if (typeof result.refresh_token !== 'string' || !result.refresh_token) {
      throw new Error('Home Assistant did not return a refresh token.');
    }
    return {
      session: {
        url: baseUrl,
        name: new URL(baseUrl).hostname,
        clientId,
        refreshToken: result.refresh_token,
      },
      token: parseAccessToken(result),
    };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    server.close();
    server.closeAllConnections();
  }
}

export async function refreshAccessToken(session: StoredSession): Promise<AccessToken> {
  return parseAccessToken(
    await tokenRequest(session.url, {
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
      client_id: session.clientId,
    }),
  );
}

export async function revokeSession(session: StoredSession): Promise<void> {
  await fetch(new URL('/auth/revoke', session.url), {
    method: 'POST',
    body: new URLSearchParams({ token: session.refreshToken }),
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
}

async function tokenRequest(
  baseUrl: string,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(new URL('/auth/token', baseUrl), {
      method: 'POST',
      body: new URLSearchParams(body),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('Could not reach Home Assistant. Check the address and your connection.');
  }
  if ([400, 401, 403].includes(response.status)) {
    throw new InvalidSessionError('Your Home Assistant session expired. Sign in again.');
  }
  if (!response.ok) throw new Error('Home Assistant could not complete sign-in. Try again.');
  const result: unknown = await response.json();
  if (!isRecord(result)) throw new Error('Home Assistant returned an invalid sign-in response.');
  return result;
}

function parseAccessToken(value: Record<string, unknown>): AccessToken {
  if (
    typeof value.access_token !== 'string' ||
    !value.access_token ||
    typeof value.expires_in !== 'number' ||
    value.expires_in <= 0
  ) {
    throw new Error('Home Assistant returned an invalid access token.');
  }
  return { accessToken: value.access_token, expiresAt: Date.now() + value.expires_in * 1000 };
}
