/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { createHash } from 'node:crypto';
import { HomeCache } from '../home-cache';
import type { DesktopHubSessionManager } from '../hub-session';
import { isRecord } from './types';

/** Builds a Hub-scoped persistent home snapshot cache bound to the active credential scope. */
export function createHubHomeCache(
  store: {
    loadHomeCache?: () => Promise<unknown>;
    saveHomeCache?: (value: unknown) => Promise<void>;
  },
  getScope: () => string | undefined,
): HomeCache {
  return new HomeCache(
    {
      loadHomeCache: () => store.loadHomeCache?.() ?? Promise.resolve(null),
      saveHomeCache: (v) => store.saveHomeCache?.(v) ?? Promise.resolve(),
    },
    () => {
      const scope = getScope();
      return scope ? createHash('sha256').update(scope).digest('hex') : undefined;
    },
  );
}

/** True when an address returns the identity envelope of a Haus Hub. */
export async function probeHubAddress(fetchFn: typeof fetch, url: string): Promise<boolean> {
  try {
    const response = await fetchFn(`${url.replace(/\/+$/, '')}/api/auth/identity`, {
      signal: AbortSignal.timeout(10000),
    });
    const body: unknown = await response.json();
    return (
      response.ok && isRecord(body) && isRecord(body.hub) && typeof body.hub.hubId === 'string'
    );
  } catch {
    return false;
  }
}

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

function hubRequestTimeoutMs(path: string): number {
  const pathname = path.split('?')[0] ?? path;
  // Native and repair flows can connect to hardware and install requirements (120s worker + 60s cold start).
  if (
    /^\/api\/commissioning\/flows(?:\/[^/]+(?:\/step)?)?$/.test(pathname) ||
    /^\/api\/repairs\/issues\/fix(?:\/[^/]+)?$/.test(pathname)
  ) {
    return 185_000;
  }
  // Cloud-backed compatibility plugins may acknowledge after the device already changed state.
  if (/^\/api\/devices\/[^/]+\/command$/.test(pathname)) return 35_000;
  if (
    pathname === '/api/apps/install' ||
    pathname === '/api/updates/install' ||
    /^\/api\/apps\/[^/]+\/(update|operate)$/.test(pathname)
  ) {
    return 300_000;
  }
  if (
    pathname === '/api/providers/discover' ||
    /^\/api\/providers\/[^/]+\/login\/qr(?:\/poll)?$/.test(pathname) ||
    /^\/api\/providers\/[^/]+\/(?:handover|migration\/(?:review|apply|undo))$/.test(pathname)
  ) {
    return 25_000;
  }
  return 10_000;
}

interface CachedGetEntry {
  readonly expiresAt: number;
  readonly value: unknown;
}

interface HubGetCache {
  readonly entries: Map<string, CachedGetEntry>;
  readonly inFlight: Map<string, Promise<unknown>>;
}

const hubGetCaches = new WeakMap<DesktopHubSessionManager, HubGetCache>();

const CACHEABLE_GET_TTL_MS: Readonly<Record<string, number>> = {
  '/api/catalog/integrations': 5 * 60_000,
  '/api/commissioning/integrations': 2_000,
  '/api/apps': 1_500,
};

function getManagerCache(manager: DesktopHubSessionManager): HubGetCache {
  let cache = hubGetCaches.get(manager);
  if (!cache) {
    cache = { entries: new Map(), inFlight: new Map() };
    hubGetCaches.set(manager, cache);
  }
  return cache;
}

function invalidateCacheForMutation(manager: DesktopHubSessionManager, path: string): void {
  const cache = hubGetCaches.get(manager);
  if (!cache) return;
  const pathname = path.split('?')[0] ?? path;
  if (pathname.startsWith('/api/commissioning') || pathname.startsWith('/api/apps')) {
    cache.entries.delete('/api/commissioning/integrations');
    cache.entries.delete('/api/apps');
  }
  if (pathname.startsWith('/api/updates') || pathname.startsWith('/api/catalog')) {
    cache.entries.delete('/api/catalog/integrations');
    cache.entries.delete('/api/commissioning/integrations');
    cache.entries.delete('/api/apps');
  }
}

async function fetchHubApiUncached(
  fetchFn: typeof fetch,
  manager: DesktopHubSessionManager,
  path: string,
  init: { method?: string; body?: unknown },
): Promise<unknown> {
  const timeoutMs = hubRequestTimeoutMs(path);
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
      signal: AbortSignal.timeout(timeoutMs),
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

/** Call an authenticated Hub API endpoint, coalescing & caching hot GETs and refreshing once on 401. */
export async function requestHubApi(
  fetchFn: typeof fetch,
  manager: DesktopHubSessionManager,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET') {
    invalidateCacheForMutation(manager, path);
    const result = await fetchHubApiUncached(fetchFn, manager, path, init);
    invalidateCacheForMutation(manager, path);
    return result;
  }

  const ttlMs = CACHEABLE_GET_TTL_MS[path];
  if (!ttlMs) {
    return fetchHubApiUncached(fetchFn, manager, path, init);
  }

  const cache = getManagerCache(manager);
  const cached = cache.entries.get(path);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }

  const pending = cache.inFlight.get(path);
  if (pending) return pending;

  const job = fetchHubApiUncached(fetchFn, manager, path, init)
    .then((value) => {
      cache.entries.set(path, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      cache.inFlight.delete(path);
    });
  cache.inFlight.set(path, job);
  return job;
}
