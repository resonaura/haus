/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IntegrationEntry } from '../../../ha/management';
import { nativeApi } from '../../../ha/management';
import type { Snapshot } from '../../../model';
import { serverRequest } from '../../servers/server-api';
import {
  deviceConfigEntryIds,
  findPendingTuyaCameras,
  groupPendingByDevice,
  groupPendingByEntry,
  hasTuyaCameraCandidates,
  splitTuyaEntryIds,
  type TuyaPendingCamera,
} from './tuya-camera-pending';
import {
  isCameraDpEntity,
  providerBridgeId,
  type HubDetectedTuyaCamera,
  type TuyaBridgeCamera,
  type TuyaBridgeProvider,
} from './tuya-cameras';

function extractHubTuyaCameras(
  entries:
    | ReadonlyArray<Pick<IntegrationEntry, 'entry_id' | 'domain' | 'disabled_by' | 'tuyaCameras'>>
    | undefined,
): HubDetectedTuyaCamera[] {
  if (!entries) return [];
  return entries.flatMap((entry) =>
    entry.domain === 'tuya' && !entry.disabled_by && Array.isArray(entry.tuyaCameras)
      ? entry.tuyaCameras.map((cam) => ({ ...cam, entryId: entry.entry_id }))
      : [],
  );
}

const listeners = new Set<() => void>();

/** Notifies all active pending-Tuya listeners to re-check bridge/import status immediately. */
export function notifyPendingTuyaCamerasChanged(): void {
  for (const listener of listeners) listener();
}

export function usePendingTuyaCameras(
  snapshot: Snapshot,
  options?: {
    demo?: boolean;
    enabled?: boolean;
    entries?: ReadonlyArray<
      Pick<IntegrationEntry, 'entry_id' | 'domain' | 'disabled_by' | 'tuyaCameras'>
    >;
    knownTuyaEntryIds?: ReadonlyArray<string>;
    disabledEntryIds?: ReadonlyArray<string>;
  },
) {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{
    signature: string;
    loading: boolean;
    pending: TuyaPendingCamera[];
  }>({ signature: '', loading: false, pending: [] });

  const demo = options?.demo ?? false;
  const enabled = options?.enabled ?? true;
  const active =
    enabled &&
    !demo &&
    snapshot.config.demo !== true &&
    typeof window !== 'undefined' &&
    Boolean(window.hausNative?.management);

  const splitFromEntries = useMemo(
    () => (active && options?.entries ? splitTuyaEntryIds(options.entries) : undefined),
    [active, options?.entries],
  );
  const providedHubCameras = useMemo(
    () => (active ? extractHubTuyaCameras(options?.entries) : []),
    [active, options?.entries],
  );
  const resolvedExplicitIds = options?.knownTuyaEntryIds ?? splitFromEntries?.tuyaEntryIds;
  const resolvedDisabledIds = options?.disabledEntryIds ?? splitFromEntries?.disabledTuyaEntryIds;
  const explicitIdsKey = resolvedExplicitIds?.join(',') ?? '';
  const disabledIdsKey = resolvedDisabledIds?.join(',') ?? '';
  const hubCamerasKey = useMemo(
    () => providedHubCameras.map((c) => `${c.entryId ?? ''}:${c.id}`).join(','),
    [providedHubCameras],
  );

  // Extract only Tuya-bridge and native-camera state markers so unrelated sensor ticks
  // (temperature, power, clock, lights) never invalidate the memo or re-fetch providers.
  const tuyaCameraStateSignature = useMemo(() => {
    if (!active) return '';
    const markers: string[] = [];
    for (const st of snapshot.states) {
      if (st.attributes.haus_bridge_provider === 'tuya') {
        markers.push(`b:${st.entity_id}`);
      } else if (st.entity_id.startsWith('camera.') && st.attributes.haus_native_camera === 1) {
        const friendly =
          typeof st.attributes.friendly_name === 'string' ? st.attributes.friendly_name : '';
        markers.push(`c:${st.entity_id}:${friendly}`);
      }
    }
    return markers.join('|');
  }, [active, snapshot.states]);

  const candidateSignature = useMemo(() => {
    if (!active) return '';
    const hasActiveTuyaContext =
      (resolvedExplicitIds && resolvedExplicitIds.length > 0) ||
      tuyaCameraStateSignature.includes('b:') ||
      providedHubCameras.length > 0 ||
      snapshot.devices.some((dev) => dev.id.startsWith('tuya:')) ||
      hasTuyaCameraCandidates(
        snapshot,
        resolvedExplicitIds,
        resolvedDisabledIds,
        providedHubCameras,
      );
    if (!hasActiveTuyaContext) return '';

    const parts = snapshot.devices
      .filter((dev) => dev.id.startsWith('tuya:') || deviceConfigEntryIds(dev).length > 0)
      .map((dev) => dev.id)
      .sort()
      .slice(0, 64);
    const camEntities = snapshot.entities
      .filter((e) => !e.disabled_by && isCameraDpEntity(e))
      .map((e) => `${e.entity_id}:${e.device_id ?? ''}`)
      .sort()
      .slice(0, 128);
    return `${explicitIdsKey}|${disabledIdsKey}|${hubCamerasKey}|${tuyaCameraStateSignature}|${parts.join(',')}|${camEntities.join(',')}`;
  }, [
    active,
    disabledIdsKey,
    explicitIdsKey,
    hubCamerasKey,
    providedHubCameras,
    resolvedDisabledIds,
    resolvedExplicitIds,
    snapshot.devices,
    snapshot.entities,
    tuyaCameraStateSignature,
  ]);

  const latestRef = useRef({
    snapshot,
    hasEntries: Boolean(options?.entries),
    providedHubCameras,
    resolvedExplicitIds,
    resolvedDisabledIds,
  });
  latestRef.current = {
    snapshot,
    hasEntries: Boolean(options?.entries),
    providedHubCameras,
    resolvedExplicitIds,
    resolvedDisabledIds,
  };

  const refresh = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!active) return;
    const onChanged = () => setNonce((n) => n + 1);
    listeners.add(onChanged);
    return () => {
      listeners.delete(onChanged);
    };
  }, [active]);

  useEffect(() => {
    if (!candidateSignature) {
      setState((prev) =>
        prev.signature === '' && !prev.loading && prev.pending.length === 0
          ? prev
          : { signature: '', loading: false, pending: [] },
      );
      return;
    }

    let cancelled = false;
    setState((prev) => ({
      signature: candidateSignature,
      loading: prev.signature !== candidateSignature && prev.pending.length === 0,
      pending: prev.signature === candidateSignature ? prev.pending : [],
    }));

    void (async () => {
      const current = latestRef.current;
      const [fetchedRows, providersRes] = await Promise.all([
        current.hasEntries
          ? Promise.resolve<IntegrationEntry[] | undefined>(undefined)
          : nativeApi()
              .request<IntegrationEntry[]>({ type: 'config_entries/get' })
              .catch(() => undefined),
        serverRequest<{ providers: TuyaBridgeProvider[] }>('GET', '/api/providers').catch(() => ({
          providers: [] as TuyaBridgeProvider[],
        })),
      ]);
      if (cancelled) return;
      const fetchedEntries = fetchedRows ? splitTuyaEntryIds(fetchedRows) : undefined;
      const hubTuyaCameras = current.hasEntries
        ? current.providedHubCameras
        : extractHubTuyaCameras(fetchedRows);

      const tuyaBridges = providersRes.providers.filter((item) => item.provider === 'tuya');
      const pairedBridgeCameras: Record<string, TuyaBridgeCamera[]> = {};
      await Promise.all(
        tuyaBridges.map(async (bridge) => {
          const id = providerBridgeId(bridge);
          if (!id) return;
          const res = await serverRequest<{ cameras: TuyaBridgeCamera[] }>(
            'GET',
            `/api/providers/${encodeURIComponent(id)}`,
          ).catch(() => null);
          if (res?.cameras) pairedBridgeCameras[id] = res.cameras;
        }),
      );
      if (cancelled) return;

      const items = findPendingTuyaCameras({
        snapshot: latestRef.current.snapshot,
        tuyaEntryIds: latestRef.current.resolvedExplicitIds ?? fetchedEntries?.tuyaEntryIds,
        disabledEntryIds:
          latestRef.current.resolvedDisabledIds ?? fetchedEntries?.disabledTuyaEntryIds,
        pairedProviders: tuyaBridges,
        pairedBridgeCameras,
        hubTuyaCameras,
      });
      setState({ signature: candidateSignature, loading: false, pending: items });
    })();

    return () => {
      cancelled = true;
    };
  }, [candidateSignature, nonce]);

  const byDevice = useMemo(() => groupPendingByDevice(state.pending), [state.pending]);
  const byEntry = useMemo(() => groupPendingByEntry(state.pending), [state.pending]);

  return {
    pending: state.pending,
    byDevice,
    byEntry,
    loading: state.loading,
    refresh,
  };
}
