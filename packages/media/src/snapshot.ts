/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { privateIp } from './source.js';

export interface BridgeSnapshotSource {
  version: 1;
  provider: 'aqara' | 'tuya';
  url: string;
}
export interface BridgeSnapshot {
  buffer: Buffer;
  at: number;
  stale: boolean;
}
interface Entity {
  entity_id: string;
  state: string;
  attributes?: Record<string, unknown>;
}
interface Registry {
  states?: Entity[];
  entities?: {
    entity_id: string;
    device_id?: string;
    platform?: string;
    disabled_by?: unknown;
    hidden_by?: unknown;
  }[];
}

/** Only an explicit capability on the same registered physical camera can supply a URL. */
export function bridgeSnapshotSource(
  camera: { id: string; aliases?: string[]; deviceId?: string; deviceIds?: string[] },
  registry: Registry,
): BridgeSnapshotSource | undefined {
  const entries = new Map(registry.entities?.map((entry) => [entry.entity_id, entry]));
  const devices = new Set([camera.deviceId, ...(camera.deviceIds ?? [])].filter(Boolean));
  const ids = new Set([camera.id, ...(camera.aliases ?? [])]);
  const sources = new Map<string, BridgeSnapshotSource>();
  for (const state of registry.states ?? []) {
    const entry = entries.get(state.entity_id);
    const attrs = state.attributes ?? {};
    if (
      !entry ||
      entry.disabled_by ||
      entry.hidden_by ||
      entry.platform === 'haus' ||
      attrs.haus_camera_proxy ||
      (!ids.has(state.entity_id) && (!entry.device_id || !devices.has(entry.device_id)))
    )
      continue;
    if (
      attrs.haus_snapshot_profile !== 1 ||
      !['aqara', 'tuya'].includes(String(attrs.haus_snapshot_provider)) ||
      typeof attrs.haus_snapshot_url !== 'string'
    )
      continue;
    const source = {
      version: 1 as const,
      provider: attrs.haus_snapshot_provider as 'aqara' | 'tuya',
      url: attrs.haus_snapshot_url,
    };
    sources.set(JSON.stringify(source), source);
  }
  return sources.size === 1 ? [...sources.values()][0] : undefined;
}

/** LAN-only, pinned DNS, no redirects, credentials, proxying, placeholders or unbounded bodies. */
export async function fetchBridgeSnapshot(
  source: BridgeSnapshotSource,
  { now = Date.now, resolve = lookup }: { now?: () => number; resolve?: typeof lookup } = {},
): Promise<BridgeSnapshot> {
  const fail = () => new Error('bridge_snapshot_unavailable');
  if (
    source?.version !== 1 ||
    !['aqara', 'tuya'].includes(source.provider) ||
    typeof source.url !== 'string' ||
    source.url.length > 2048
  )
    throw fail();
  const url = new URL(source.url);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !/^\/api\/cameras\/[a-zA-Z0-9_-]{1,128}\/snapshot\/last-live$/.test(url.pathname)
  )
    throw fail();
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let timer: NodeJS.Timeout | undefined;
  const addresses = await Promise.race([
    isIP(host)
      ? Promise.resolve([{ address: host, family: isIP(host) }])
      : resolve(host, { all: true }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(fail()), 1500);
    }),
  ]).finally(() => clearTimeout(timer));
  if (
    !addresses.length ||
    addresses.some(
      ({ address }) => !privateIp(address) || /^127\./.test(address) || address === '::1',
    )
  )
    throw fail();
  const pinned = addresses[0];
  return new Promise((resolveResult, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        headers: { Accept: 'image/jpeg' },
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
          else callback(null, pinned.address, pinned.family);
        },
      },
      (response) => {
        const captured = Number(response.headers['x-haus-snapshot-captured-at']);
        const at = now();
        if (
          response.statusCode !== 200 ||
          response.headers['x-haus-snapshot-profile'] !== '1' ||
          response.headers['x-haus-snapshot-provider'] !== source.provider ||
          response.headers['content-type']?.split(';')[0] !== 'image/jpeg' ||
          !Number.isFinite(captured) ||
          captured <= 0 ||
          captured > at + 5000 ||
          Number(response.headers['content-length'] ?? 0) > 2 * 1024 ** 2
        ) {
          reject(fail());
          response.destroy();
          request.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 ** 2) {
            reject(fail());
            response.destroy();
            request.destroy();
          } else chunks.push(chunk);
        });
        response.on('error', () => reject(fail()));
        response.on('aborted', () => reject(fail()));
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (
            buffer.length < 4 ||
            buffer[0] !== 255 ||
            buffer[1] !== 216 ||
            buffer.at(-2) !== 255 ||
            buffer.at(-1) !== 217
          ) {
            reject(fail());
            return;
          }
          resolveResult({
            buffer,
            at: Math.min(at, captured),
            stale: response.headers['x-haus-snapshot-stale'] === '1' || at - captured >= 30000,
          });
        });
      },
    );
    timer = setTimeout(() => request.destroy(fail()), 2500);
    request.on('error', () => reject(fail()));
    request.on('close', () => clearTimeout(timer));
    request.end();
  });
}
