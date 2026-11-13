/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { DesktopHubSessionManager } from '../hub-session';
import { isRecord } from './types';

/** Retry a read once when an idle keep-alive socket has been closed by the Hub. */
export async function readHubResponse(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    try {
      return await fetchFn(url, init);
    } catch (retryError) {
      if (retryError instanceof Error && retryError.name === 'AbortError') throw retryError;
      const path = new URL(url).pathname;
      const rawCause =
        typeof retryError === 'object' && retryError !== null
          ? Reflect.get(retryError, 'cause')
          : undefined;
      const cause = isRecord(rawCause) ? rawCause : undefined;
      const code =
        cause && typeof cause.code === 'string' && /^E[A-Z0-9_]{2,40}$/.test(cause.code)
          ? ` (${cause.code})`
          : '';
      throw new Error(`Could not reach the Haus Hub at ${new URL(url).host} for ${path}${code}.`);
    }
  }
}

/** Send a JSON POST request to a Hub endpoint and unwrap structured refusal errors. */
export async function postHubJson(
  fetchFn: typeof fetch,
  url: string,
  body: unknown,
): Promise<unknown> {
  const response = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = isRecord(data) && typeof data.error === 'string' ? data.error : '';
    throw new Error(
      code === 'invalid_pairing_code'
        ? 'That pairing code is not correct. Start again.'
        : `The Hub refused the request (${code || response.status}).`,
    );
  }
  return data;
}

/** Fetch `/api/auth/identity` from a Hub URL and validate the hub payload. */
export async function loadHubIdentity(
  fetchFn: typeof fetch,
  base: string,
): Promise<{ homeId: string; hubName?: string }> {
  const response = await readHubResponse(fetchFn, `${base}/api/auth/identity`, {
    signal: AbortSignal.timeout(15000),
  });
  const body: unknown = await response.json().catch(() => ({}));
  const hub = isRecord(body) && isRecord(body.hub) ? body.hub : undefined;
  if (response.status >= 500)
    throw new Error(`Haus Hub identity unavailable (${response.status}).`);
  if (!response.ok || !hub || typeof hub.homeId !== 'string')
    throw new Error('That address is not a Haus Hub.');
  const hubName = typeof hub.name === 'string' && hub.name ? hub.name : undefined;
  return { homeId: hub.homeId, hubName };
}

/** Call an authenticated Hub API endpoint, refreshing the session once on 401. */
export async function requestHubApi(
  fetchFn: typeof fetch,
  manager: DesktopHubSessionManager,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const bearer = manager.bearer();
    if (!bearer) throw new Error('Connect to your Haus Hub first.');
    const url = `${bearer.url}${path}`;
    const request: RequestInit = {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${bearer.token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(10000),
    };
    const response =
      request.method === 'GET'
        ? await readHubResponse(fetchFn, url, request)
        : await fetchFn(url, request);
    if (response.status === 401 && attempt === 0 && (await manager.reconnect())) continue;
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => ({}));
      const code = isRecord(body) && typeof body.error === 'string' ? body.error : undefined;
      const safeCode = code && /^[a-z0-9_]{1,96}$/.test(code) ? `: ${code}` : '';
      throw new Error(`The Hub request failed (${response.status}${safeCode}).`);
    }
    return response.json().catch(() => ({}));
  }
  throw new Error('Your Hub session expired. Connect again.');
}
