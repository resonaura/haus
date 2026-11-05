/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { AppState } from 'react-native';
import {
  parseLocalHausHubService,
  parseLocalHomeAssistantService,
  type LocalHomeCandidate,
} from './local-home-candidate.js';

export { parseLocalHausHubService, parseLocalHomeAssistantService, type LocalHomeCandidate };

const HAUS_HUB_SERVICE = '_haus._tcp';
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

/** A bounded native mDNS scan. Default discovers Haus Hubs; explicitHa scans Home Assistant. */
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
    resolve(
      status === 'complete' || status === 'cancelled'
        ? {
            status,
            servers: [...servers.values()].sort((a, b) => a.name.localeCompare(b.name)),
          }
        : { status, servers: [] },
    );
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
