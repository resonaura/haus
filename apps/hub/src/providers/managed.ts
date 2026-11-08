/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { request } from 'node:http';
import {
  discoverProviderBridges,
  type DiscoveredProviderBridge,
  type ProviderDiscoveryConfig,
} from './discovery.js';

/** Local pairing codes never pass through the renderer or an unverified multicast endpoint. */
export function loopbackProviderJson(
  port: number,
  path: string,
  post = false,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: post ? 'POST' : 'GET',
        headers: {
          'X-Haus-Client': '1',
          ...(post ? { 'Content-Type': 'application/json' } : {}),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.destroy();
          reject(new Error('managed_provider_unavailable'));
          return;
        }
        let text = '';
        res.on('data', (chunk: Buffer | string) => {
          text += chunk;
          if (Buffer.byteLength(text) > 4096) {
            req.destroy(new Error('invalid_managed_provider_response'));
          }
        });
        res.on('error', () => reject(new Error('managed_provider_unavailable')));
        res.on('end', () => {
          try {
            resolve(JSON.parse(text) as Record<string, unknown>);
          } catch {
            reject(new Error('invalid_managed_provider_response'));
          }
        });
      },
    );
    const timer = setTimeout(() => req.destroy(new Error('managed_provider_unavailable')), 3000);
    req.on('error', () => reject(new Error('managed_provider_unavailable')));
    req.on('close', () => clearTimeout(timer));
    req.end(post ? '{}' : undefined);
  });
}

export interface ManagedProviderTarget<TResult = unknown> {
  add(input: { url: string; code: string; allowHttp: boolean }): Promise<TResult>;
}

export interface ConnectManagedProviderOptions {
  discover?: (config: ProviderDiscoveryConfig) => Promise<DiscoveredProviderBridge[]>;
  local?: (port: number, path: string, post?: boolean) => Promise<Record<string, unknown>>;
}

export async function connectManagedProvider<TResult = unknown>(
  config: ProviderDiscoveryConfig,
  providers: ManagedProviderTarget<TResult>,
  bridgeId: string,
  {
    discover = discoverProviderBridges,
    local = loopbackProviderJson,
  }: ConnectManagedProviderOptions = {},
): Promise<TResult> {
  if (config.standalone || !config.token) throw new Error('managed_provider_unavailable');
  const hint = (await discover(config)).find(
    (item) => item.bridgeId === bridgeId && item.source === 'supervisor' && item.managed,
  );
  if (!hint) throw new Error('managed_provider_unavailable');
  const port = Number(new URL(hint.url).port);
  const info = await local(port, '/api/haus/v2/info');
  if (info.version !== 2 || info.bridgeId !== hint.bridgeId || info.provider !== hint.provider) {
    throw new Error('invalid_managed_provider_identity');
  }
  const pairing = await local(port, '/api/haus/v2/pairing', true);
  const code = pairing.code;
  if (typeof code !== 'string' || !/^[a-f0-9]{48}$/.test(code)) {
    throw new Error('invalid_managed_provider_response');
  }
  return providers.add({ url: hint.url, code, allowHttp: true });
}
