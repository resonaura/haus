/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { RefreshResult } from '@haus/core/session';
import { credentialText, type HaCredential } from './credential.js';
import type { HaProviderAddress } from './address.js';

async function responseValue(response: Response): Promise<unknown> {
  if (!response.body) throw Error('ha_refresh_unavailable');
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 65536) throw Error('ha_refresh_unavailable');
      chunks.push(chunk.value);
    }
  } finally {
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** Invoked exclusively by TokenRefresh; no retry and no automatic refresh in a WebSocket Auth object. */
export async function refreshHaCredential(
  address: HaProviderAddress,
  credential: HaCredential,
  signal: AbortSignal,
): Promise<RefreshResult<HaCredential>> {
  if (credential.kind === 'token') return { status: 'reauth-required' };
  try {
    signal.throwIfAborted();
    const response = await fetch(new URL('auth/token', address.base), {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credential.refreshToken,
        client_id: credential.clientId,
      }),
    });
    if ([400, 401, 403].includes(response.status)) {
      await response.body?.cancel();
      return { status: 'reauth-required' };
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw Error('ha_refresh_unavailable');
    }
    const value = await responseValue(response);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('access_token' in value) ||
      !credentialText(value.access_token) ||
      ('token_type' in value &&
        (typeof value.token_type !== 'string' || value.token_type.toLowerCase() !== 'bearer')) ||
      !('expires_in' in value) ||
      typeof value.expires_in !== 'number' ||
      !Number.isSafeInteger(value.expires_in) ||
      value.expires_in <= 0
    )
      throw Error('ha_refresh_unavailable');
    const expiresAt = Date.now() + value.expires_in * 1000;
    if (!Number.isSafeInteger(expiresAt)) throw Error('ha_refresh_unavailable');
    const refreshToken = 'refresh_token' in value ? value.refresh_token : credential.refreshToken;
    if (!credentialText(refreshToken)) throw Error('ha_refresh_unavailable');
    return {
      status: 'renewed',
      credential: {
        kind: 'oauth',
        accessToken: value.access_token,
        refreshToken,
        clientId: credential.clientId,
        expiresAt,
      },
    };
  } catch {
    throw Error('ha_refresh_unavailable');
  }
}
