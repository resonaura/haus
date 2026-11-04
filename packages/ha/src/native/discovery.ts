/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isIP } from 'node:net';
import { Bonjour, type Service } from 'bonjour-service';
import type { DiscoveredServer } from '../native-types.js';
import { isLocalHostname, normalizeServerUrl } from './validation.js';

type DiscoveryService = Pick<Service, 'host' | 'name' | 'port' | 'txt'>;
type StopBrowse = () => void;
type Browse = (onService: (service: DiscoveryService) => void, onError: () => void) => StopBrowse;

interface DiscoveryTask {
  promise: Promise<DiscoveredServer[]>;
  cancel: () => void;
}

let activeDiscovery: DiscoveryTask | undefined;

/** Treat multicast records as untrusted hints: accept only local, credential-free HA URLs. */
export function parseDiscoveredHomeAssistant(
  service: DiscoveryService,
): DiscoveredServer | undefined {
  const text = service.txt;
  if (
    !text ||
    typeof text !== 'object' ||
    String(text.landingpage).toLowerCase() === 'true' ||
    !Number.isSafeInteger(service.port) ||
    service.port < 1 ||
    service.port > 65535
  )
    return;

  const advertised = [text.internal_url, text.base_url].find(
    (value): value is string =>
      typeof value === 'string' && value.length > 0 && value.length <= 2048,
  );
  const rawHost = service.host
    .trim()
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '');
  if (!advertised && !rawHost) return;
  const urlHost = isIP(rawHost) === 6 ? `[${rawHost}]` : rawHost;

  try {
    const url = normalizeServerUrl(advertised || `http://${urlHost}:${service.port}`);
    const parsed = new URL(url);
    if (!isLocalHostname(parsed.hostname)) return;

    const id =
      typeof text.uuid === 'string' && text.uuid.length > 0 && text.uuid.length <= 160
        ? text.uuid
        : url;
    const name = [text.location_name, service.name].find(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    );
    const version =
      typeof text.version === 'string' && text.version.length <= 64 && text.version !== '0000.0.0'
        ? text.version
        : undefined;

    return {
      id,
      name: (name ?? 'Home Assistant').trim().slice(0, 128),
      url,
      host: rawHost || parsed.hostname,
      port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
      ...(version ? { version } : {}),
    };
  } catch {
    return;
  }
}

const browseBonjour: Browse = (onService, onError) => {
  const bonjour = new Bonjour({}, onError);
  bonjour.find({ type: 'home-assistant', protocol: 'tcp' }, onService);
  return () => bonjour.destroy();
};

/** Exposed for deterministic lifecycle tests; production uses the Bonjour adapter below. */
export function createDiscoveryTask(
  duration = 3500,
  signal?: AbortSignal,
  browse: Browse = browseBonjour,
): DiscoveryTask {
  const servers = new Map<string, DiscoveredServer>();
  let stop: StopBrowse | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let resolve!: (servers: DiscoveredServer[]) => void;
  const promise = new Promise<DiscoveredServer[]>((done) => (resolve = done));

  const finish = () => {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', finish);
    try {
      stop?.();
    } catch {
      // Discovery remains a best-effort hint; cleanup errors must not hang the caller.
    } finally {
      resolve([...servers.values()].sort((a, b) => a.name.localeCompare(b.name)));
    }
  };

  if (signal?.aborted) {
    finish();
    return { promise, cancel: finish };
  }
  signal?.addEventListener('abort', finish, { once: true });

  try {
    const cleanup = browse((service) => {
      const server = parseDiscoveredHomeAssistant(service);
      if (server) servers.set(server.id, server);
    }, finish);
    if (finished) cleanup();
    else stop = cleanup;
  } catch {
    finish();
  }
  if (!finished) timer = setTimeout(finish, Math.max(0, Math.min(duration, 10_000)));
  return { promise, cancel: finish };
}

/** Bounded local discovery; cancellation always closes the multicast socket. */
export function discoverServers(duration = 3500): Promise<DiscoveredServer[]> {
  if (activeDiscovery) return activeDiscovery.promise;
  const task = createDiscoveryTask(duration);
  activeDiscovery = task;
  void task.promise.finally(() => {
    if (activeDiscovery === task) activeDiscovery = undefined;
  });
  return task.promise;
}

export function cancelDiscovery(): void {
  activeDiscovery?.cancel();
}
