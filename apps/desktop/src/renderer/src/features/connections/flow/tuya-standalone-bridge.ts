/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { nativeApi, supervisor } from '../../../ha/management';
import { serverRequest } from '../../servers/server-api';
import {
  TUYA_BRIDGE_APP_ID,
  detectTuyaCameraCandidates,
  findTuyaBridgeAddon,
  formatBridgeInstallProgress,
  providerBridgeId,
  resolveStandaloneTuyaBridge,
  type TuyaAddonCandidate,
  type TuyaAppInstallProgress,
  type TuyaBridgeCamera,
  type TuyaBridgeProvider,
  type TuyaCameraDetectionResult,
  type TuyaCameraRegistryDevice,
  type TuyaCameraRegistryEntity,
  type TuyaStandaloneBridgeState,
} from './tuya-cameras';

export interface TuyaFollowupSnapshot {
  readonly hubSession: boolean;
  readonly result: TuyaCameraDetectionResult;
  readonly addonCandidate?: TuyaAddonCandidate;
  readonly standaloneCandidate?: TuyaStandaloneBridgeState;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fetch current Tuya integration cameras, paired/discovered bridges, and add-on/Hub app status. */
export async function fetchTuyaFollowupSnapshot(entryId?: string): Promise<TuyaFollowupSnapshot> {
  const session = await nativeApi()
    .getSession()
    .catch(() => null);
  const hubSession = session?.kind === 'haus-hub';
  const [entities, devices, pairedRes, discoveredRes, appsRes, catalogRes, addonsRes, storeRes] =
    await Promise.all([
      nativeApi()
        .request<TuyaCameraRegistryEntity[]>({ type: 'config/entity_registry/list' })
        .catch(() => []),
      nativeApi()
        .request<TuyaCameraRegistryDevice[]>({ type: 'config/device_registry/list' })
        .catch(() => []),
      serverRequest<{ providers: TuyaBridgeProvider[] }>('GET', '/api/providers').catch(() => ({
        providers: [],
      })),
      serverRequest<{ providers: TuyaBridgeProvider[] }>(
        'POST',
        '/api/providers/discover',
        {},
      ).catch(() => ({ providers: [] })),
      hubSession
        ? nativeApi()
            .management<{ apps?: Array<Record<string, unknown>> }>({ method: 'GET', path: 'apps' })
            .catch(() => null)
        : Promise.resolve(null),
      hubSession
        ? nativeApi()
            .management<{ entry?: { manifest?: Record<string, unknown> } }>({
              method: 'GET',
              path: `apps/catalog/${TUYA_BRIDGE_APP_ID}`,
            })
            .catch(() => null)
        : Promise.resolve(null),
      hubSession
        ? Promise.resolve({ addons: [] })
        : supervisor<{ addons?: TuyaAddonCandidate[] }>('/addons').catch(() => ({ addons: [] })),
      hubSession
        ? Promise.resolve({ addons: [] })
        : supervisor<{ addons?: TuyaAddonCandidate[] }>('/store').catch(() => ({ addons: [] })),
    ]);

  const pairedBridge = pairedRes.providers.find((item) => item.provider === 'tuya');
  const pairedId = providerBridgeId(pairedBridge);
  const pairedBridgeCameras: Record<string, TuyaBridgeCamera[]> = {};
  if (pairedId) {
    const preview = await serverRequest<{ cameras: TuyaBridgeCamera[] }>(
      'GET',
      `/api/providers/${encodeURIComponent(pairedId)}`,
    ).catch(() => null);
    if (preview?.cameras) pairedBridgeCameras[pairedId] = preview.cameras;
  }

  const result = detectTuyaCameraCandidates({
    entryId,
    entities,
    devices,
    pairedProviders: pairedRes.providers,
    discoveredProviders: discoveredRes.providers,
    pairedBridgeCameras,
  });
  const addonCandidate = hubSession
    ? undefined
    : findTuyaBridgeAddon(addonsRes.addons ?? [], storeRes.addons ?? []);
  const standaloneCandidate = hubSession
    ? resolveStandaloneTuyaBridge(appsRes, catalogRes)
    : undefined;
  return { hubSession, result, addonCandidate, standaloneCandidate };
}

/** Install/start the standalone Hub Tuya bridge with explicit `network:host` consent & wait for pair. */
export async function installAndPairStandaloneTuyaBridge({
  entryId,
  initialBridge,
  isActive,
  onStatus,
  onSnapshot,
  onPaired,
  onManualPair,
}: {
  entryId?: string;
  initialBridge?: TuyaStandaloneBridgeState;
  isActive: () => boolean;
  onStatus: (status: string) => void;
  onSnapshot: (snap: TuyaFollowupSnapshot) => void;
  onPaired: (bridgeId: string) => Promise<void>;
  onManualPair: (url?: string) => void;
}): Promise<boolean> {
  let timer: number | undefined;
  try {
    if (!initialBridge?.installed) {
      let manifest = initialBridge?.manifest;
      if (!manifest) {
        const catalogRes = await nativeApi().management<{
          entry?: { manifest?: Record<string, unknown> };
        }>({
          method: 'GET',
          path: `apps/catalog/${TUYA_BRIDGE_APP_ID}`,
        });
        manifest = catalogRes?.entry?.manifest;
      }
      if (!manifest) {
        throw new Error('Tuya Camera Bridge catalog manifest is unavailable on this Hub.');
      }

      onStatus('Pulling latest Tuya Camera Bridge image…');
      timer = window.setInterval(() => {
        void nativeApi()
          .management<TuyaAppInstallProgress>({
            method: 'GET',
            path: `apps/${TUYA_BRIDGE_APP_ID}/install-progress`,
          })
          .then((progress) => {
            if (isActive()) onStatus(formatBridgeInstallProgress(progress));
          })
          .catch(() => undefined);
      }, 800);

      try {
        await nativeApi().management({
          method: 'POST',
          path: 'apps/install',
          data: { manifest, grantedPermissions: ['network:host'] },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (!msg.includes('app_already_installed')) throw err;
      } finally {
        if (timer !== undefined) window.clearInterval(timer);
        timer = undefined;
      }
    }

    const appsAfter = await nativeApi()
      .management<{
        apps?: Array<{ id?: string; state?: string; source?: { externalId?: string } }>;
      }>({
        method: 'GET',
        path: 'apps',
      })
      .catch(() => null);
    const installed = appsAfter?.apps?.find(
      (item) => item.source?.externalId === TUYA_BRIDGE_APP_ID || item.id === TUYA_BRIDGE_APP_ID,
    );
    if (installed && installed.state !== 'running') {
      onStatus('Starting Tuya Camera Bridge container…');
      await nativeApi().management({
        method: 'POST',
        path: `apps/${TUYA_BRIDGE_APP_ID}/execute`,
        data: { action: 'start' },
      });
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (!isActive()) return true;
      onStatus('Waiting for Tuya Camera Bridge pairing service…');
      const snap = await fetchTuyaFollowupSnapshot(entryId);
      if (!isActive()) return true;
      onSnapshot(snap);
      const pairedId = providerBridgeId(snap.result.pairedBridge);
      if (pairedId) {
        await onPaired(pairedId);
        return true;
      }
      const discovered = snap.result.discoveredBridge;
      const discoveredId = discovered?.bridgeId ?? discovered?.id;
      if (discovered && discoveredId) {
        const connected = await serverRequest<{ id?: string; manual?: boolean }>(
          'POST',
          '/api/providers/connect',
          { bridgeId: discoveredId },
        );
        if (!isActive()) return true;
        if (connected.manual) {
          onManualPair(discovered.url);
          return true;
        }
        if (connected.id) {
          await onPaired(connected.id);
          return true;
        }
      }
      await sleep(1500);
    }
    return false;
  } finally {
    if (timer !== undefined) window.clearInterval(timer);
    if (isActive()) onStatus('');
  }
}
