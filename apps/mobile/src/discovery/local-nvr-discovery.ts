/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { AppState } from 'react-native';
import { parseLocalHausNvrService, type LocalNvrCandidate } from './local-nvr-candidate';

const HAUS_NVR_SERVICE = '_haus-nvr._tcp';
const DISCOVERY_SECONDS = 4;
const DISCOVERY_SETUP_TIMEOUT_MS = 30_000;
const ADDRESS_RESOLVE_TIMEOUT_MS = 1_500;

export type LocalNvrDiscoveryOutcome =
  | { status: 'complete'; nodes: LocalNvrCandidate[] }
  | { status: 'permission-denied'; nodes: [] }
  | { status: 'unavailable'; nodes: [] }
  | { status: 'cancelled'; nodes: LocalNvrCandidate[] };

export interface LocalNvrDiscoveryTask {
  result: Promise<LocalNvrDiscoveryOutcome>;
  cancel(): void;
}

/** A bounded native NVR scan; cancellation/backgrounding always closes the Bonjour scanner. */
export function createLocalHausNvrDiscovery(): LocalNvrDiscoveryTask {
  let resolve!: (outcome: LocalNvrDiscoveryOutcome) => void;
  let settled = false;
  let scanner: import('@dawidzawada/bonjour-zeroconf').BonjourScanner | undefined;
  let resultsListener: { remove(): void } | undefined;
  let failureListener: { remove(): void } | undefined;
  let appStateListener: { remove(): void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const nodes = new Map<string, LocalNvrCandidate>();
  const result = new Promise<LocalNvrDiscoveryOutcome>((done) => (resolve = done));

  const finish = (status: LocalNvrDiscoveryOutcome['status']) => {
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
        ? { status, nodes: [...nodes.values()].sort((a, b) => a.name.localeCompare(b.name)) }
        : { status, nodes: [] },
    );
  };

  appStateListener = AppState.addEventListener('change', (state) => {
    if (state === 'background') finish('cancelled');
  });
  // Bound native module startup and permission UI; the short scan starts after permission.
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

      scanner = new native.BonjourScanner({ id: 'haus-nvr' });
      resultsListener = scanner.listenForScanResults((results) => {
        if (settled) return;
        for (const service of results) {
          const candidate = parseLocalHausNvrService(service);
          if (candidate) nodes.set(candidate.id, candidate);
        }
      });
      failureListener = scanner.listenForScanFail((failure) => {
        if (failure === native.BonjourFail.DISCOVERY_FAILED)
          finish(nodes.size > 0 ? 'complete' : 'unavailable');
      });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => finish('complete'), DISCOVERY_SECONDS * 1_000);
      scanner.scan(HAUS_NVR_SERVICE, 'local', {
        addressResolveTimeout: ADDRESS_RESOLVE_TIMEOUT_MS,
      });
    } catch {
      finish('unavailable');
    }
  })();

  return { result, cancel: () => finish('cancelled') };
}
