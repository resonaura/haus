/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import {
  computeTuyaHashKey,
  generateTuyaAesSecret,
  signTuyaRequest,
  tuyaAesGcmDecrypt,
  tuyaAesGcmEncrypt,
} from './crypto.js';
import {
  TUYA_CLIENT_ID,
  TUYA_DEFAULT_AUTH_BASE_URL,
  TUYA_SCHEMA,
  type TuyaCloudDevice,
  type TuyaCommandItem,
  type TuyaHome,
  type TuyaLoginPollResult,
  type TuyaQrCodeResult,
  type TuyaStatusItem,
  type TuyaStoredCredentials,
  type TuyaTokenInfo,
} from './types.js';

export interface TuyaClientOptions {
  readonly fetchFn?: typeof fetch;
  readonly authBaseUrl?: string;
  readonly clientId?: string;
  readonly schema?: string;
  readonly timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Ensures regional Tuya API endpoints have an HTTPS origin and no trailing slash. */
export function normalizeTuyaEndpoint(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return TUYA_DEFAULT_AUTH_BASE_URL;
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeStatusList(
  raw: unknown,
): ReadonlyArray<TuyaStatusItem> | Readonly<Record<string, unknown>> | undefined {
  if (Array.isArray(raw)) {
    const items: TuyaStatusItem[] = [];
    for (const entry of raw) {
      if (isRecord(entry) && typeof entry.code === 'string') {
        items.push({ code: entry.code, value: entry.value });
      }
    }
    return items;
  }
  if (isRecord(raw)) return raw;
  return undefined;
}

/** Client for Tuya Home Assistant Device Sharing QR auth and encrypted REST calls. */
export class TuyaClient {
  private readonly fetchFn: typeof fetch;
  private readonly authBaseUrl: string;
  private readonly clientId: string;
  private readonly schema: string;
  private readonly timeoutMs: number;

  constructor(options: TuyaClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.authBaseUrl = normalizeTuyaEndpoint(options.authBaseUrl ?? TUYA_DEFAULT_AUTH_BASE_URL);
    this.clientId = options.clientId ?? TUYA_CLIENT_ID;
    this.schema = options.schema ?? TUYA_SCHEMA;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /** Requests a fresh Tuya QR login token for the user's case-sensitive Smart Life user code. */
  async requestQrCode(userCode: string): Promise<TuyaQrCodeResult> {
    const url = new URL('/v1.0/m/life/home-assistant/qrcode/tokens', this.authBaseUrl);
    url.searchParams.set('clientid', this.clientId);
    url.searchParams.set('usercode', userCode);
    url.searchParams.set('schema', this.schema);

    try {
      const res = await this.fetchFn(url.toString(), {
        method: 'POST',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const payload = (await res.json()) as unknown;
      if (!isRecord(payload)) {
        return {
          success: false,
          code: res.status || 'invalid_response',
          msg: 'Invalid Tuya response',
        };
      }
      if (
        payload.success === true &&
        isRecord(payload.result) &&
        typeof payload.result.qrcode === 'string'
      ) {
        return { success: true, qrcode: payload.result.qrcode };
      }
      return {
        success: false,
        code:
          typeof payload.code === 'string' || typeof payload.code === 'number'
            ? payload.code
            : res.status,
        msg: asString(payload.msg) ?? `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        success: false,
        code: 'cannot_connect',
        msg: err instanceof Error ? err.message : 'Network error',
      };
    }
  }

  /** Polls Tuya Cloud to check whether the displayed QR login token was confirmed in the mobile app. */
  async pollLoginResult(qrToken: string, userCode: string): Promise<TuyaLoginPollResult> {
    const url = new URL(
      `/v1.0/m/life/home-assistant/qrcode/tokens/${encodeURIComponent(qrToken)}`,
      this.authBaseUrl,
    );
    url.searchParams.set('clientid', this.clientId);
    url.searchParams.set('usercode', userCode);

    try {
      const res = await this.fetchFn(url.toString(), {
        method: 'GET',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const payload = (await res.json()) as unknown;
      if (!isRecord(payload)) {
        return {
          success: false,
          code: res.status || 'invalid_response',
          msg: 'Invalid Tuya response',
        };
      }
      if (payload.success === true && isRecord(payload.result)) {
        const result = payload.result;
        const accessToken = asString(result.access_token);
        const refreshToken = asString(result.refresh_token);
        const uid = asString(result.uid);
        const terminalId = asString(result.terminal_id);
        if (!accessToken || !refreshToken || !uid || !terminalId) {
          return {
            success: false,
            code: 'invalid_token_payload',
            msg: 'Incomplete Tuya authorization result',
          };
        }
        const t = asNumber(payload.t) ?? Date.now();
        const expireTime = asNumber(result.expire_time) ?? 7200;
        const credentials: TuyaStoredCredentials = {
          user_code: userCode,
          endpoint: normalizeTuyaEndpoint(asString(result.endpoint) ?? this.authBaseUrl),
          terminal_id: terminalId,
          uid,
          ...(asString(result.username) ? { username: asString(result.username) } : {}),
          token_info: {
            t,
            uid,
            expire_time: expireTime,
            access_token: accessToken,
            refresh_token: refreshToken,
          },
        };
        return { success: true, credentials };
      }
      return {
        success: false,
        code:
          typeof payload.code === 'string' || typeof payload.code === 'number'
            ? payload.code
            : res.status,
        msg: asString(payload.msg) ?? `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        success: false,
        code: 'cannot_connect',
        msg: err instanceof Error ? err.message : 'Network error',
      };
    }
  }

  /** Creates an authenticated signed/encrypted API session from persisted credentials. */
  createSession(
    credentials: TuyaStoredCredentials,
    onTokenRefreshed?: (next: TuyaStoredCredentials) => Promise<void> | void,
  ): TuyaApiSession {
    return new TuyaApiSession(
      this.fetchFn,
      this.clientId,
      this.timeoutMs,
      credentials,
      onTokenRefreshed,
    );
  }
}

/** Authenticated Tuya Sharing REST client handling AES-128-GCM payloads and token refresh. */
export class TuyaApiSession {
  private credentials: TuyaStoredCredentials;
  private refreshing = false;

  constructor(
    private readonly fetchFn: typeof fetch,
    private readonly clientId: string,
    private readonly timeoutMs: number,
    initialCredentials: TuyaStoredCredentials,
    private readonly onTokenRefreshed?: (next: TuyaStoredCredentials) => Promise<void> | void,
  ) {
    this.credentials = initialCredentials;
  }

  getCredentials(): TuyaStoredCredentials {
    return this.credentials;
  }

  private getTokenExpiryMs(tokenInfo: TuyaTokenInfo): number {
    return tokenInfo.t + tokenInfo.expire_time * 1000;
  }

  async refreshAccessTokenIfNeeded(): Promise<void> {
    if (this.refreshing) return;
    if (this.getTokenExpiryMs(this.credentials.token_info) - 60_000 > Date.now()) {
      return;
    }
    this.refreshing = true;
    try {
      const refreshPath = `/v1.0/m/token/${encodeURIComponent(this.credentials.token_info.refresh_token)}`;
      const res = await this.signedRequest('GET', refreshPath);
      const result = res.result;
      if (!isRecord(result)) return;
      const accessToken = asString(result.accessToken) ?? asString(result.access_token);
      const refreshToken = asString(result.refreshToken) ?? asString(result.refresh_token);
      const uid = asString(result.uid) ?? this.credentials.uid;
      const expireTime = asNumber(result.expireTime) ?? asNumber(result.expire_time);
      if (!accessToken || !refreshToken || expireTime === undefined) return;
      this.credentials = {
        ...this.credentials,
        uid,
        token_info: {
          t: res.t ?? Date.now(),
          uid,
          expire_time: expireTime,
          access_token: accessToken,
          refresh_token: refreshToken,
        },
      };
      await this.onTokenRefreshed?.(this.credentials);
    } finally {
      this.refreshing = false;
    }
  }

  async queryHomes(): Promise<readonly TuyaHome[]> {
    const res = await this.signedRequest('GET', '/v1.0/m/life/users/homes');
    if (!Array.isArray(res.result)) return [];
    const homes: TuyaHome[] = [];
    for (const item of res.result) {
      if (!isRecord(item)) continue;
      const id =
        typeof item.ownerId === 'string' || typeof item.ownerId === 'number'
          ? String(item.ownerId)
          : undefined;
      if (!id) continue;
      homes.push({
        id,
        name: asString(item.name) ?? `Home ${id}`,
      });
    }
    return homes;
  }

  async queryDevicesByHome(homeId: string): Promise<readonly TuyaCloudDevice[]> {
    const res = await this.signedRequest('GET', '/v1.0/m/life/ha/home/devices', { homeId });
    if (!Array.isArray(res.result)) return [];
    const devices: TuyaCloudDevice[] = [];
    for (const item of res.result) {
      if (!isRecord(item) || typeof item.id !== 'string') continue;
      devices.push({
        id: item.id,
        name: asString(item.name) ?? item.id,
        category: asString(item.category),
        product_id: asString(item.product_id),
        product_name: asString(item.product_name),
        sub: typeof item.sub === 'boolean' ? item.sub : undefined,
        uuid: asString(item.uuid),
        asset_id: asString(item.asset_id),
        online: typeof item.online === 'boolean' ? item.online : undefined,
        icon: asString(item.icon),
        ip: asString(item.ip),
        time_zone: asString(item.time_zone),
        status: normalizeStatusList(item.status),
      });
    }
    return devices;
  }

  async sendCommands(deviceId: string, commands: readonly TuyaCommandItem[]): Promise<void> {
    if (commands.length === 0) return;
    await this.signedRequest(
      'POST',
      `/v1.1/m/thing/${encodeURIComponent(deviceId)}/commands`,
      undefined,
      { commands },
    );
  }

  async expireTerminal(): Promise<void> {
    await this.signedRequest('POST', '/v1.0/m/token/terminal/expire', undefined, {
      accessToken: this.credentials.token_info.access_token,
      terminalId: this.credentials.terminal_id,
    });
  }

  private async signedRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    params?: Readonly<Record<string, unknown>>,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly t?: number; readonly result: unknown }> {
    await this.refreshAccessTokenIfNeeded();

    const rid = randomUUID();
    const sid = '';
    const hashKey = computeTuyaHashKey(rid, this.credentials.token_info.refresh_token);
    const secret = generateTuyaAesSecret(rid, sid, hashKey);

    const url = new URL(path, normalizeTuyaEndpoint(this.credentials.endpoint));
    let queryEncdata = '';
    if (params && Object.keys(params).length > 0) {
      queryEncdata = tuyaAesGcmEncrypt(JSON.stringify(params), secret);
      url.searchParams.set('encdata', queryEncdata);
    }

    let bodyEncdata = '';
    let serializedBody: string | undefined;
    if (body && Object.keys(body).length > 0) {
      bodyEncdata = tuyaAesGcmEncrypt(JSON.stringify(body), secret);
      serializedBody = JSON.stringify({ encdata: bodyEncdata });
    }

    const headers: Record<string, string> = {
      'X-appKey': this.clientId,
      'X-requestId': rid,
      'X-sid': sid,
      'X-time': String(Date.now()),
    };
    if (this.credentials.token_info.access_token) {
      headers['X-token'] = this.credentials.token_info.access_token;
    }
    headers['X-sign'] = signTuyaRequest(hashKey, queryEncdata, bodyEncdata, headers);
    if (serializedBody !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await this.fetchFn(url.toString(), {
      method,
      headers,
      ...(serializedBody !== undefined ? { body: serializedBody } : {}),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`tuya_http_${res.status}`);
    }

    const payload = (await res.json()) as unknown;
    if (!isRecord(payload)) {
      throw new Error('tuya_invalid_response');
    }
    if (payload.success !== true) {
      const code = payload.code ?? 'error';
      const msg = asString(payload.msg) ?? 'Unknown error';
      throw new Error(`tuya_api_error:${code}:${msg}`);
    }

    let decoded: unknown = payload.result;
    if (typeof payload.result === 'string' && payload.result.length > 0) {
      const plain = tuyaAesGcmDecrypt(payload.result, secret);
      try {
        decoded = JSON.parse(plain) as unknown;
      } catch {
        decoded = plain;
      }
    }

    return { t: asNumber(payload.t), result: decoded };
  }
}
