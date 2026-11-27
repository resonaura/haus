/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { groupDiscoveredHomeTargets } from '@haus/core/pairing';
import { AppState } from 'react-native';
import {
  parseLocalHausHubService,
  parseLocalHomeAssistantService,
  type LocalHomeCandidate,
} from './local-home-candidate.js';

export { parseLocalHausHubService, parseLocalHomeAssistantService, type LocalHomeCandidate };

const HAUS_HUB_SERVICE = '_haus-hub._tcp';
const HOME_ASSISTANT_SERVICE = '_home-assistant._tcp';
const DISCOVERY_SECONDS = 4;
const DISCOVERY_SETUP_TIMEOUT_MS = 30_000;
const ADDRESS_RESOLVE_TIMEOUT_MS = 1_500;

export type LocalDiscoveryOutcome =
  | { status: 'complete'; servers: LocalHomeCandidate[] }
  | { status: 'permission-denied'; servers: [] }
  | { status: 'unavailable'; servers: [] }
  | { status: 'cancelled'; servers: LocalHomeCandidate[] };

export interface LocalDiscoveryTask {
  result: Promise<LocalDiscoveryOutcome>;
  cancel(): void;
}

async function enrichCandidateIdentity(candidate: LocalHomeCandidate): Promise<LocalHomeCandidate> {
  if (candidate.kind === 'home-assistant') return candidate;
  try {
    const res = await fetch(`${candidate.url.replace(/\/+$/, '')}/api/auth/identity`, {
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

/** A bounded native mDNS scan. Default discovers Haus Homes & Hubs; explicitHa scans Home Assistant. */
export function createLocalHomeDiscovery(options?: { explicitHa?: boolean }): LocalDiscoveryTask {
  let resolve!: (outcome: LocalDiscoveryOutcome) => void;
  let settled = false;
  let scanner: import('@dawidzawada/bonjour-zeroconf').BonjourScanner | undefined;
  let resultsListener: { remove(): void } | undefined;
  let failureListener: { remove(): void } | undefined;
  let appStateListener: { remove(): void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const servers = new Map<string, LocalHomeCandidate>();
  const result = new Promise<LocalDiscoveryOutcome>((done) => (resolve = done));

  const targetService = options?.explicitHa ? HOME_ASSISTANT_SERVICE : HAUS_HUB_SERVICE;
  const parser = options?.explicitHa ? parseLocalHomeAssistantService : parseLocalHausHubService;

  const finish = (status: LocalDiscoveryOutcome['status']) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    appStateListener?.remove();
    resultsListener?.remove();
    failureListener?.remove();
    try {
      scanner?.stop();
    } catch {
      // Native cleanup is best-effort; the result still settles promptly.
    }
    if (status !== 'complete' && status !== 'cancelled') {
      resolve({ status, servers: [] });
      return;
    }
    void (async () => {
      const raw = [...servers.values()];
      if (options?.explicitHa || status === 'cancelled') {
        resolve({ status, servers: raw.sort((a, b) => a.name.localeCompare(b.name)) });
        return;
      }
      const enriched = await Promise.all(raw.map(enrichCandidateIdentity));
      const grouped = groupDiscoveredHomeTargets(enriched).map((target) => ({
        id: target.id,
        name: target.name,
        url: target.url,
        host: target.host ?? new URL(target.url).hostname,
        port: target.port ?? Number(new URL(target.url).port || 80),
        kind: target.kind ?? 'haus-hub',
        ...(target.targetType ? { targetType: target.targetType } : {}),
        ...(target.hubId ? { hubId: target.hubId } : {}),
        ...(target.homeId ? { homeId: target.homeId } : {}),
        ...(target.hubCount !== undefined ? { hubCount: target.hubCount } : {}),
        ...(target.onboarded !== undefined ? { onboarded: target.onboarded } : {}),
        ...(target.memberUrls ? { memberUrls: target.memberUrls } : {}),
        ...(target.memberNames ? { memberNames: target.memberNames } : {}),
      }));
      resolve({ status, servers: grouped });
    })();
  };

  appStateListener = AppState.addEventListener('change', (state) => {
    if (state === 'background') finish('cancelled');
  });
  timer = setTimeout(() => finish('complete'), DISCOVERY_SETUP_TIMEOUT_MS);

  void (async () => {
    try {
      const native = await import('@dawidzawada/bonjour-zeroconf');
      if (settled) return;
      if (!(await native.requestLocalNetworkPermission())) {
        finish('permission-denied');
        return;
      }
      if (settled) return;

      scanner = new native.BonjourScanner({ id: 'haus-home' });
      resultsListener = scanner.listenForScanResults((results) => {
        if (settled) return;
        for (const service of results) {
          const candidate = parser(service);
          if (candidate) servers.set(candidate.id, candidate);
        }
      });
      failureListener = scanner.listenForScanFail((failure) => {
        if (failure === native.BonjourFail.DISCOVERY_FAILED)
          finish(servers.size > 0 ? 'complete' : 'unavailable');
      });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => finish('complete'), DISCOVERY_SECONDS * 1_000);
      scanner.scan(targetService, 'local', {
        addressResolveTimeout: ADDRESS_RESOLVE_TIMEOUT_MS,
      });
    } catch {
      finish('unavailable');
    }
  })();

  return { result, cancel: () => finish('cancelled') };
}
