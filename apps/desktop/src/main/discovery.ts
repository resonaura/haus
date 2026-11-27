/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Bonjour, type Service } from 'bonjour-service';
import {
  groupDiscoveredHomeTargets,
  parseDiscoveredHub,
  type DiscoveredHubEndpointInput,
} from '@haus/core';
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

export interface DiscoveryOptions {
  readonly explicitHa?: boolean;
  readonly rawHubsOnly?: boolean;
  readonly excludeHomeId?: string;
}

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

function parseDiscoveredHausHubExtended(
  service: DiscoveryService,
): (DiscoveredServer & DiscoveredHubEndpointInput) | undefined {
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
    ...(hub.hubId ? { hubId: hub.hubId } : {}),
    ...(hub.homeId ? { homeId: hub.homeId } : {}),
    ...(hub.homeName ? { homeName: hub.homeName } : {}),
    ...(hub.onboarded !== undefined ? { onboarded: hub.onboarded } : {}),
    ...(hub.clusterRole ? { clusterRole: hub.clusterRole } : {}),
    ...(hub.coordinatorHubId ? { coordinatorHubId: hub.coordinatorHubId } : {}),
    ...(hub.hubCount !== undefined ? { hubCount: hub.hubCount } : {}),
  };
}

async function enrichHubIdentity(
  candidate: DiscoveredServer & DiscoveredHubEndpointInput,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<DiscoveredServer & DiscoveredHubEndpointInput> {
  try {
    const res = await fetchFn(`${candidate.url.replace(/\/+$/, '')}/api/auth/identity`, {
      redirect: 'error',
      signal: AbortSignal.timeout(1_200),
    });
    if (!res.ok) return candidate;
    const body = (await res.json()) as {
      hub?: {
        hubId?: string;
        homeId?: string;
        name?: string;
        homeName?: string;
        onboarded?: boolean;
        cluster?: {
          role?: 'standalone' | 'coordinator' | 'node' | 'fenced';
          coordinatorHubId?: string;
          hubCount?: number;
        };
      };
    };
    const hub = body?.hub;
    if (!hub || typeof hub.hubId !== 'string') return candidate;
    return {
      ...candidate,
      id: `haus-hub:${hub.hubId}`,
      hubId: hub.hubId,
      ...(typeof hub.homeId === 'string' && hub.homeId ? { homeId: hub.homeId } : {}),
      ...(typeof hub.name === 'string' && hub.name ? { name: hub.name } : {}),
      ...(typeof hub.homeName === 'string' && hub.homeName ? { homeName: hub.homeName } : {}),
      ...(typeof hub.onboarded === 'boolean' ? { onboarded: hub.onboarded } : {}),
      ...(hub.cluster?.role ? { clusterRole: hub.cluster.role } : {}),
      ...(hub.cluster?.coordinatorHubId ? { coordinatorHubId: hub.cluster.coordinatorHubId } : {}),
      ...(typeof hub.cluster?.hubCount === 'number' ? { hubCount: hub.cluster.hubCount } : {}),
    };
  } catch {
    return candidate;
  }
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
  options?: DiscoveryOptions,
): DiscoveryTask {
  const servers = new Map<string, DiscoveredServer & DiscoveredHubEndpointInput>();
  const shouldProbeLive = browse === browseBonjourHausHub;
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
    void (async () => {
      const rawList = [...servers.values()];
      const enriched =
        shouldProbeLive && !signal?.aborted
          ? await Promise.all(rawList.map((item) => enrichHubIdentity(item)))
          : rawList;
      const filtered = options?.excludeHomeId
        ? enriched.filter((item) => item.homeId !== options.excludeHomeId)
        : enriched;
      if (options?.rawHubsOnly) {
        resolve(
          filtered
            .map((item) => ({
              id: item.id,
              name: item.name,
              url: item.url,
              host: item.host,
              port: item.port,
              kind: 'haus-hub' as const,
              ...(item.hubId ? { hubId: item.hubId } : {}),
              ...(item.homeId ? { homeId: item.homeId } : {}),
              ...(item.onboarded !== undefined ? { onboarded: item.onboarded } : {}),
              ...(item.hubCount !== undefined ? { hubCount: item.hubCount } : {}),
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
        return;
      }
      const grouped = groupDiscoveredHomeTargets(filtered);
      resolve(
        grouped.map((target) => ({
          id: target.id,
          name: target.name,
          url: target.url,
          host: target.host ?? new URL(target.url).hostname,
          port: target.port ?? Number(new URL(target.url).port || 80),
          kind: target.kind ?? 'haus-hub',
          ...(target.targetType ? { targetType: target.targetType } : {}),
          ...(target.homeId ? { homeId: target.homeId } : {}),
          ...(target.hubId ? { hubId: target.hubId } : {}),
          ...(target.hubCount !== undefined ? { hubCount: target.hubCount } : {}),
          ...(target.onboarded !== undefined ? { onboarded: target.onboarded } : {}),
          ...(target.memberUrls ? { memberUrls: target.memberUrls } : {}),
          ...(target.memberNames ? { memberNames: target.memberNames } : {}),
        })),
      );
    })();
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
        const candidate = parseDiscoveredHausHubExtended(service);
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
  options?: DiscoveryOptions,
): DiscoveryTask {
  if (options?.explicitHa === true) {
    return createHomeAssistantDiscoveryTask(duration, signal);
  }
  return createHausHubDiscoveryTask(duration, signal, browse, options);
}

export function discoverServers(options?: DiscoveryOptions): Promise<DiscoveredServer[]> {
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
