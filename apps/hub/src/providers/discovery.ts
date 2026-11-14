/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isIP } from 'node:net';
import { bridgeJson, cameraBridgeEndpoint } from '@haus/bridge/client';
import { discoverCameraBridges } from '@haus/bridge/discovery';
import { bridgeAddon, isBridgeProvider } from '@haus/kitsune/native';

export interface ProviderDiscoveryHint {
  url: string;
  bridgeId?: string;
  provider?: string;
  source?: 'mdns' | 'supervisor' | 'app';
  addonSlug?: string;
  managed?: boolean;
}

export interface DiscoveredProviderBridge {
  bridgeId: string;
  provider: string;
  name: string;
  url: string;
  source: 'mdns' | 'supervisor' | 'app';
  addonSlug?: string;
  managed?: boolean;
  paired: boolean;
}

export interface ProviderDiscoveryConfig {
  standalone?: boolean;
  token?: string;
  localBridgeHints?: () => Promise<readonly ProviderDiscoveryHint[]>;
}

export interface ProviderDiscoveryOptions {
  scan?: (options: {
    onFound: (hint: ProviderDiscoveryHint) => void;
    onError: () => void;
    timeoutMs: number;
  }) => () => void;
  fetchRequest?: (
    url: string,
    init: { headers: Record<string, string>; redirect: 'error'; signal: AbortSignal },
  ) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  endpoint?: (url: string, allowHttp: boolean) => Promise<{ url: string }>;
  request?: (
    target: { url: string },
    path: string,
    options?: { timeout?: number },
  ) => Promise<unknown>;
  duration?: number;
}

/** Supervisor hints plus LAN advertisements; neither pairing nor MQTT ownership is granted here. */
export async function discoverProviderBridges(
  config: ProviderDiscoveryConfig,
  {
    scan = discoverCameraBridges as ProviderDiscoveryOptions['scan'],
    fetchRequest = fetch as NonNullable<ProviderDiscoveryOptions['fetchRequest']>,
    endpoint = cameraBridgeEndpoint as NonNullable<ProviderDiscoveryOptions['endpoint']>,
    request = bridgeJson as NonNullable<ProviderDiscoveryOptions['request']>,
    duration = 3500,
  }: ProviderDiscoveryOptions = {},
): Promise<DiscoveredProviderBridge[]> {
  const hints = new Map<string, ProviderDiscoveryHint>();
  const add = (value: ProviderDiscoveryHint) => {
    if (hints.size < 16 && typeof value.url === 'string') hints.set(value.url, value);
  };
  const mdns = new Promise<void>((resolve) => {
    let stop = () => {};
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      stop();
      resolve();
    };
    const timer = setTimeout(finish, duration);
    try {
      stop =
        scan?.({
          onFound: add,
          onError: () => {
            clearTimeout(timer);
            finish();
          },
          timeoutMs: Math.max(1000, duration),
        }) ?? (() => {});
      if (finished) stop();
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
  const supervisor = (async () => {
    if (config.standalone || !config.token) return;
    const get = async (path: string): Promise<Record<string, unknown>> => {
      const response = await fetchRequest('http://supervisor' + path, {
        headers: { Authorization: `Bearer ${config.token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) throw new Error('provider_discovery_unavailable');
      const body = (await response.json()) as { data?: Record<string, unknown> };
      return body.data ?? {};
    };
    try {
      const info = (await get('/supervisor/info')) as {
        addons?: Array<{ slug: string; state: string }>;
      };
      await Promise.all(
        (info.addons ?? [])
          .filter((addon) => addon.state === 'started' && bridgeAddon(addon.slug))
          .slice(0, 8)
          .map(async (addon) => {
            try {
              const addonInfo = (await get(`/addons/${addon.slug}/info`)) as {
                ip_address?: string;
                options?: Record<string, unknown>;
                host_network?: boolean;
              };
              const address = addonInfo.ip_address ?? '';
              if (!isIP(address)) return;
              const { provider, port } = bridgeAddon(addon.slug, addonInfo.options) ?? {};
              if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
                return;
              }
              add({
                url: `http://${address.includes(':') ? '[' + address + ']' : address}:${port}`,
                provider,
                source: 'supervisor',
                addonSlug: addon.slug,
                managed: addonInfo.host_network === true,
              });
            } catch {
              /* Unavailable add-ons do not prevent other LAN discovery. */
            }
          }),
      );
    } catch {
      /* Manual URL and multicast remain usable without Supervisor. */
    }
  })();
  const localApps = (async () => {
    try {
      const items = await config.localBridgeHints?.();
      for (const item of items ?? []) add(item);
    } catch {
      /* Local bridge hints remain optional fallback alongside mDNS/Supervisor. */
    }
  })();
  await Promise.all([mdns, supervisor, localApps]);
  const found: DiscoveredProviderBridge[] = [];
  const candidates = [...hints.values()];
  for (let offset = 0; offset < candidates.length; offset += 4) {
    await Promise.all(
      candidates.slice(offset, offset + 4).map(async (hint) => {
        try {
          const target = await endpoint(hint.url, true);
          const info = (await request(target, '/api/haus/v2/info', { timeout: 2500 })) as
            | {
                version?: number;
                bridgeId?: string;
                provider?: string;
                name?: string;
              }
            | undefined;
          if (
            info?.version !== 2 ||
            typeof info.bridgeId !== 'string' ||
            !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(info.bridgeId) ||
            typeof info.provider !== 'string' ||
            !isBridgeProvider(info.provider) ||
            (hint.bridgeId && hint.bridgeId !== info.bridgeId) ||
            (hint.provider && hint.provider !== info.provider)
          ) {
            return;
          }
          const name =
            typeof info.name === 'string'
              ? [...info.name]
                  .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
                  .join('')
                  .slice(0, 128)
              : 'Camera bridge';
          found.push({
            bridgeId: info.bridgeId,
            provider: info.provider,
            name,
            url: target.url,
            source: hint.source ?? 'mdns',
            ...(hint.source === 'supervisor' || hint.source === 'app'
              ? { addonSlug: hint.addonSlug, managed: hint.managed === true }
              : {}),
            paired: false,
          });
        } catch {
          /* Older providers without native enrollment remain on their existing path. */
        }
      }),
    );
  }
  // Prefer Supervisor proof over managed local app hints, then multicast.
  const rank = (item: DiscoveredProviderBridge) =>
    item.source === 'supervisor' ? 2 : item.source === 'app' ? 1 : 0;
  return [
    ...new Map(
      found.sort((a, b) => rank(a) - rank(b)).map((item) => [item.bridgeId, item]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
}
