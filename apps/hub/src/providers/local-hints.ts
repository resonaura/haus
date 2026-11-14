/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isIP } from 'node:net';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import type { StandaloneHomeService } from '../home/home.service.js';
import type { ProviderDiscoveryHint } from './discovery.js';

interface KnownBridgeSpec {
  readonly provider: 'aqara' | 'tuya';
  readonly port: number;
}

const APP_BRIDGE_SPECS: Readonly<Record<string, KnownBridgeSpec>> = {
  'tuya-rtsp-bridge': { provider: 'tuya', port: 6766 },
  'aqara-cameras': { provider: 'aqara', port: 8795 },
};

const CONTAINER_INTERFACE_RE = /^(docker|veth|br-|virbr|cni|flannel|podman)/i;

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split('.').map(Number);
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (family === 6) {
    const normalized = address.split('%')[0]?.toLowerCase() ?? '';
    return normalized.startsWith('fc') || normalized.startsWith('fd');
  }
  return false;
}

function collectPrivateInterfaceAddresses(
  interfacesFn: () => NodeJS.Dict<NetworkInterfaceInfo[]>,
): string[] {
  const preferred: string[] = [];
  const fallback: string[] = [];
  for (const [name, entries] of Object.entries(interfacesFn())) {
    if (!entries) continue;
    const bucket = CONTAINER_INTERFACE_RE.test(name) ? fallback : preferred;
    for (const info of entries) {
      if (info.internal) continue;
      const address = info.address.split('%')[0] ?? '';
      if (!isPrivateAddress(address)) continue;
      bucket.push(address);
    }
  }
  return [...new Set([...preferred, ...fallback])].slice(0, 4);
}

/** Build discovery hints for Hub-managed standalone camera bridge apps (e.g. tuya-rtsp-bridge). */
export function createLocalAppBridgeHints(
  home?: Pick<StandaloneHomeService, 'listApps'>,
  interfacesFn: () => NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces,
): () => Promise<readonly ProviderDiscoveryHint[]> {
  return async () => {
    if (!home) return [];
    const inventory = await home.listApps('hub').catch(() => undefined);
    if (!inventory) return [];

    const runningBridges = inventory.apps
      .filter((app) => app.state === 'running')
      .map((app) => {
        const spec = APP_BRIDGE_SPECS[app.source.externalId];
        return spec ? { appId: app.source.externalId, spec } : undefined;
      })
      .filter((item): item is { appId: string; spec: KnownBridgeSpec } => Boolean(item));

    if (runningBridges.length === 0) return [];
    const addresses = collectPrivateInterfaceAddresses(interfacesFn);
    if (addresses.length === 0) return [];

    const hints: ProviderDiscoveryHint[] = [];
    for (const { appId, spec } of runningBridges) {
      for (const address of addresses) {
        const host = address.includes(':') ? `[${address}]` : address;
        hints.push({
          url: `http://${host}:${spec.port}`,
          provider: spec.provider,
          source: 'app',
          addonSlug: appId,
          managed: true,
        });
      }
    }
    return hints;
  };
}
