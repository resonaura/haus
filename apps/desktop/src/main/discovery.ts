/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Bonjour, type Service } from 'bonjour-service';
import { parseDiscoveredHub } from '@haus/core';
import type { DiscoveredServer } from '../shared/native.js';
import {
  createDiscoveryTask as createHaDiscoveryTask,
  parseDiscoveredHomeAssistant,
} from '@haus/ha/native/discovery';

export { parseDiscoveredHomeAssistant };

export type DiscoveryService = Pick<
  Service,
  'addresses' | 'host' | 'name' | 'port' | 'txt' | 'type'
>;
export type StopBrowse = () => void;
export type Browse = (
  onService: (service: DiscoveryService) => void,
  onError: () => void,
) => StopBrowse;

export interface DiscoveryTask {
  promise: Promise<DiscoveredServer[]>;
  cancel: () => void;
}

let activeDiscovery: DiscoveryTask | undefined;

export function parseDiscoveredHausHub(service: DiscoveryService): DiscoveredServer | undefined {
  const hub = parseDiscoveredHub({
    type: service.type ?? 'haus-hub',
    host: service.host,
    addresses: Array.isArray(service.addresses) ? service.addresses : undefined,
    port: service.port,
    name: service.name,
    txt: service.txt as Record<string, unknown> | undefined,
  });
  if (!hub) return undefined;

  return {
    id: hub.id,
    name: hub.name,
    url: hub.url,
    host: hub.host,
    port: hub.port,
    kind: 'haus-hub',
  };
}

const browseBonjourHausHub: Browse = (onService, onError) => {
  const bonjour = new Bonjour({}, onError);
  bonjour.find({ type: 'haus-hub', protocol: 'tcp' }, onService);
  bonjour.find({ type: 'haus', protocol: 'tcp' }, onService);
  return () => bonjour.destroy();
};

export function createHausHubDiscoveryTask(
  duration = 3500,
  signal?: AbortSignal,
  browse: Browse = browseBonjourHausHub,
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
    try {
      stop?.();
    } catch {
      // Best-effort cleanup
    }
    resolve([...servers.values()].sort((a, b) => a.name.localeCompare(b.name)));
  };

  if (signal?.aborted) {
    finish();
    return { promise, cancel: finish };
  }
  signal?.addEventListener('abort', finish, { once: true });
  timer = setTimeout(finish, duration);

  try {
    stop = browse(
      (service) => {
        const candidate = parseDiscoveredHausHub(service);
        if (candidate) servers.set(candidate.id, candidate);
      },
      () => finish(),
    );
  } catch {
    finish();
  }

  return { promise, cancel: finish };
}

export function createHomeAssistantDiscoveryTask(
  duration = 3500,
  signal?: AbortSignal,
): DiscoveryTask {
  const task = createHaDiscoveryTask(duration, signal);
  const promise = task.promise.then((servers) =>
    servers.map((server) => ({
      ...server,
      kind: 'home-assistant' as const,
    })),
  );
  return { promise, cancel: task.cancel };
}

export function createDiscoveryTask(
  duration = 3500,
  signal?: AbortSignal,
  browse?: Browse,
  options?: { explicitHa?: boolean },
): DiscoveryTask {
  if (options?.explicitHa === true) {
    return createHomeAssistantDiscoveryTask(duration, signal);
  }
  return createHausHubDiscoveryTask(duration, signal, browse);
}

export function discoverServers(options?: { explicitHa?: boolean }): Promise<DiscoveredServer[]> {
  activeDiscovery?.cancel();
  const task = createDiscoveryTask(3500, undefined, undefined, options);
  activeDiscovery = task;
  return task.promise.finally(() => {
    if (activeDiscovery === task) activeDiscovery = undefined;
  });
}

export function cancelDiscovery(): void {
  activeDiscovery?.cancel();
  activeDiscovery = undefined;
}
