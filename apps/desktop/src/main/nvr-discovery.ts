/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isIP } from 'node:net';
import { Bonjour, type Service } from 'bonjour-service';
import type { DiscoveredHausNvr } from '../shared/native';
import { normalizeServerUrl } from './validation';

type DiscoveryService = Pick<Service, 'addresses' | 'host' | 'name' | 'port' | 'type' | 'txt'>;
type StopBrowse = () => void;
type Browse = (onService: (service: DiscoveryService) => void, onError: () => void) => StopBrowse;

interface DiscoveryTask {
  promise: Promise<DiscoveredHausNvr[]>;
  cancel: () => void;
}

let activeDiscovery: DiscoveryTask | undefined;

function isPrivateIpv4(value: string): boolean {
  if (isIP(value) !== 4) return false;
  const [first, second] = value.split('.').map(Number);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

/** mDNS is an untrusted hint; reject non-local targets and all advertised credentials. */
export function parseDiscoveredHausNvr(service: DiscoveryService): DiscoveredHausNvr | undefined {
  if (
    service.type !== 'haus-nvr' ||
    !service.txt ||
    typeof service.txt !== 'object' ||
    String(service.txt.protocol) !== '1' ||
    !Number.isSafeInteger(service.port) ||
    service.port < 1 ||
    service.port > 65535
  )
    return;

  const advertisedAddress = Array.isArray(service.addresses)
    ? service.addresses.find((address) => typeof address === 'string' && isPrivateIpv4(address))
    : undefined;
  const hostname =
    typeof service.host === 'string' ? service.host.trim().replace(/\.$/, '').toLowerCase() : '';
  const host = advertisedAddress || (hostname.endsWith('.local') ? hostname : '');
  if (!host) return;
  const authority = isIP(host) === 6 ? `[${host}]` : host;
  try {
    const url = normalizeServerUrl(`http://${authority}:${service.port}`);
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || parsed.pathname !== '/' || parsed.search || parsed.hash)
      return;
    const name =
      typeof service.name === 'string' && service.name.trim()
        ? [...service.name]
            .filter((character) => {
              const code = character.codePointAt(0) ?? 0;
              return code >= 32 && code !== 127;
            })
            .join('')
            .trim()
            .slice(0, 128)
        : 'Haus NVR';
    return {
      id: `haus-nvr:${url}`,
      name: name || 'Haus NVR',
      url,
      host,
      port: Number(parsed.port || 80),
    };
  } catch {
    return;
  }
}

const browseBonjour: Browse = (onService, onError) => {
  const bonjour = new Bonjour({}, onError);
  bonjour.find({ type: 'haus-nvr', protocol: 'tcp' }, onService);
  return () => bonjour.destroy();
};

export function createNvrDiscoveryTask(
  duration = 3500,
  signal?: AbortSignal,
  browse: Browse = browseBonjour,
): DiscoveryTask {
  const nodes = new Map<string, DiscoveredHausNvr>();
  let stop: StopBrowse | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let resolve!: (nodes: DiscoveredHausNvr[]) => void;
  const promise = new Promise<DiscoveredHausNvr[]>((done) => (resolve = done));
  const finish = () => {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', finish);
    try {
      stop?.();
    } catch {
      // Discovery is a hint; cleanup errors must not hang pairing.
    } finally {
      resolve([...nodes.values()].sort((a, b) => a.name.localeCompare(b.name)));
    }
  };
  if (signal?.aborted) {
    finish();
    return { promise, cancel: finish };
  }
  signal?.addEventListener('abort', finish, { once: true });
  try {
    const cleanup = browse((service) => {
      const node = parseDiscoveredHausNvr(service);
      if (node) nodes.set(node.id, node);
    }, finish);
    if (finished) cleanup();
    else stop = cleanup;
  } catch {
    finish();
  }
  if (!finished) timer = setTimeout(finish, Math.max(0, Math.min(duration, 10_000)));
  return { promise, cancel: finish };
}

export function discoverHausNvrNodes(duration = 3500): Promise<DiscoveredHausNvr[]> {
  if (activeDiscovery) return activeDiscovery.promise;
  const task = createNvrDiscoveryTask(duration);
  activeDiscovery = task;
  void task.promise.finally(() => {
    if (activeDiscovery === task) activeDiscovery = undefined;
  });
  return task.promise;
}

export function cancelHausNvrDiscovery(): void {
  activeDiscovery?.cancel();
}
