/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { cameraBridgeEndpoint } from '@haus/bridge/client';
import type { NativeProviders } from './native.js';

export const TUYA_BRIDGE_REGIONS = ['eu', 'we', 'us', 'ue', 'cn', 'in'] as const;
export type TuyaBridgeRegion = (typeof TUYA_BRIDGE_REGIONS)[number];

export interface TuyaBridgeLoginState {
  readonly loggedIn: boolean;
  readonly region: string;
  readonly regions: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly user?: { readonly username?: string; readonly nickname?: string };
}

export interface TuyaBridgeQrStartResult {
  readonly token: string;
  readonly qrDataUrl?: string;
  readonly qrPayload: string;
}

export interface TuyaBridgeQrPollResult {
  readonly loggedIn: boolean;
  readonly error?: string;
}

const REGION_SET = new Set<string>(TUYA_BRIDGE_REGIONS);
const DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

function isValidToken(token: unknown): token is string {
  return typeof token === 'string' && token.length > 0 && token.length <= 512 && !/\s/.test(token);
}

async function resolveTuyaBridgeBaseUrl(
  providers: Pick<NativeProviders, 'connections'>,
  bridgeId: string,
): Promise<string> {
  const row = providers.connections().find((item) => item.id === bridgeId);
  if (!row) throw new Error('native_provider_not_found');
  if (row.connection.provider !== 'tuya') throw new Error('provider_login_unsupported');
  const ep = await cameraBridgeEndpoint(
    row.connection.endpoint.url,
    Boolean(row.connection.endpoint.allowHttp),
  );
  return ep.url;
}

async function bridgeJsonRequest(
  baseUrl: string,
  path: string,
  init: RequestInit,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<Record<string, unknown>> {
  const target = new URL(path, baseUrl);
  const response = await fetchFn(target.href, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      typeof body?.message === 'string' ? body.message : `tuya_bridge_${response.status}`;
    throw new Error(message);
  }
  return body;
}

/** Query current TuyaProtect authentication state from an enrolled `tuya` bridge. */
export async function getTuyaBridgeLoginState(
  providers: Pick<NativeProviders, 'connections'>,
  bridgeId: string,
  fetchFn: typeof fetch = fetch,
): Promise<TuyaBridgeLoginState> {
  const baseUrl = await resolveTuyaBridgeBaseUrl(providers, bridgeId);
  const raw = await bridgeJsonRequest(
    baseUrl,
    '/api/auth/state',
    { method: 'GET' },
    8_000,
    fetchFn,
  );
  const regions = Array.isArray(raw.regions)
    ? raw.regions
        .filter(
          (item): item is { id: string; name: string } =>
            Boolean(item && typeof item === 'object') &&
            typeof (item as { id?: unknown }).id === 'string' &&
            typeof (item as { name?: unknown }).name === 'string',
        )
        .slice(0, 12)
        .map((item) => ({ id: item.id, name: item.name }))
    : [];
  const rawUser =
    raw.user && typeof raw.user === 'object' ? (raw.user as Record<string, unknown>) : undefined;
  const user =
    rawUser && (typeof rawUser.username === 'string' || typeof rawUser.nickname === 'string')
      ? {
          ...(typeof rawUser.username === 'string' ? { username: rawUser.username } : {}),
          ...(typeof rawUser.nickname === 'string' ? { nickname: rawUser.nickname } : {}),
        }
      : undefined;

  return {
    loggedIn: raw.loggedIn === true,
    region: typeof raw.region === 'string' ? raw.region : 'us',
    regions,
    ...(user ? { user } : {}),
  };
}

/** Generate a Tuya / Smart Life QR code login challenge on the enrolled `tuya` bridge. */
export async function startTuyaBridgeQrLogin(
  providers: Pick<NativeProviders, 'connections'>,
  bridgeId: string,
  region?: string,
  fetchFn: typeof fetch = fetch,
): Promise<TuyaBridgeQrStartResult> {
  if (region !== undefined && !REGION_SET.has(region)) {
    throw new Error('invalid_tuya_region');
  }
  const baseUrl = await resolveTuyaBridgeBaseUrl(providers, bridgeId);
  const raw = await bridgeJsonRequest(
    baseUrl,
    '/api/auth/qr/start',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(region ? { region } : {}),
    },
    10_000,
    fetchFn,
  );
  if (!isValidToken(raw.token) || typeof raw.qrPayload !== 'string' || raw.qrPayload.length === 0) {
    throw new Error('invalid_tuya_qr_response');
  }
  const qrDataUrl =
    typeof raw.qrDataUrl === 'string' && DATA_IMAGE_RE.test(raw.qrDataUrl)
      ? raw.qrDataUrl
      : undefined;
  return {
    token: raw.token,
    ...(qrDataUrl ? { qrDataUrl } : {}),
    qrPayload: raw.qrPayload.slice(0, 1024),
  };
}

/** Poll a pending Tuya QR challenge; triggers bridge camera refresh + Hub inventory sync once ready. */
export async function pollTuyaBridgeQrLogin(
  providers: Pick<NativeProviders, 'connections' | 'refresh'>,
  bridgeId: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<TuyaBridgeQrPollResult> {
  if (!isValidToken(token)) {
    throw new Error('invalid_qr_token');
  }
  const baseUrl = await resolveTuyaBridgeBaseUrl(providers, bridgeId);
  const raw = await bridgeJsonRequest(
    baseUrl,
    `/api/auth/qr/poll?token=${encodeURIComponent(token)}`,
    { method: 'GET' },
    10_000,
    fetchFn,
  );
  if (raw.loggedIn === true) {
    await bridgeJsonRequest(
      baseUrl,
      '/api/cameras/refresh',
      { method: 'POST' },
      15_000,
      fetchFn,
    ).catch(() => undefined);
    await providers.refresh(bridgeId).catch(() => undefined);
    return { loggedIn: true };
  }
  return {
    loggedIn: false,
    ...(typeof raw.error === 'string' && raw.error ? { error: raw.error.slice(0, 256) } : {}),
  };
}
