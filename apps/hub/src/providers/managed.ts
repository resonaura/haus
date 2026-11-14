/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { request } from 'node:http';
import { networkInterfaces } from 'node:os';
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

export type ConnectDiscoveredProviderOptions = ConnectManagedProviderOptions & {
  isLocalAddress?: (address: string) => boolean;
};

function isInterfaceAddress(address: string): boolean {
  return new Set(
    Object.values(networkInterfaces()).flatMap(
      (entries) => entries?.map((entry) => entry.address.split('%')[0]!) ?? [],
    ),
  ).has(address);
}

function bridgePort(hint: DiscoveredProviderBridge): number {
  const url = new URL(hint.url);
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('managed_provider_unavailable');
  }
  return port;
}

async function enrollLocalBridge<TResult>(
  hint: DiscoveredProviderBridge,
  providers: ManagedProviderTarget<TResult>,
  local: NonNullable<ConnectManagedProviderOptions['local']>,
  identity?: Record<string, unknown>,
): Promise<TResult> {
  const port = bridgePort(hint);
  const info = identity ?? (await local(port, '/api/haus/v2/info'));
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
  return enrollLocalBridge(hint, providers, local);
}

/** Pair selected LAN bridges on this Hub without returning their one-use code to clients. */
export async function connectDiscoveredProvider<TResult = unknown>(
  config: ProviderDiscoveryConfig,
  providers: ManagedProviderTarget<TResult>,
  bridgeId: string,
  {
    discover = discoverProviderBridges,
    local = loopbackProviderJson,
    isLocalAddress = isInterfaceAddress,
  }: ConnectDiscoveredProviderOptions = {},
): Promise<TResult | undefined> {
  const hint = (await discover(config)).find((item) => item.bridgeId === bridgeId);
  if (!hint) throw new Error('managed_provider_unavailable');

  if (hint.source === 'supervisor' && hint.managed) {
    if (config.standalone || !config.token) throw new Error('managed_provider_unavailable');
    return enrollLocalBridge(hint, providers, local);
  }
  if (hint.source !== 'mdns' && hint.source !== 'app') return undefined;

  const host = new URL(hint.url).hostname.replace(/^\[|\]$/g, '').split('%')[0]!;
  if (!isLocalAddress(host)) return undefined;

  const port = bridgePort(hint);
  let identity: Record<string, unknown>;
  try {
    identity = await local(port, '/api/haus/v2/info');
  } catch {
    return undefined;
  }
  if (
    identity.version !== 2 ||
    identity.bridgeId !== hint.bridgeId ||
    identity.provider !== hint.provider
  )
    return undefined;
  let pairing: Record<string, unknown>;
  try {
    pairing = await local(port, '/api/haus/v2/pairing', true);
  } catch {
    return undefined;
  }
  if (typeof pairing.code !== 'string' || !/^[a-f0-9]{48}$/.test(pairing.code)) return undefined;
  return providers.add({ url: hint.url, code: pairing.code, allowHttp: true });
}
