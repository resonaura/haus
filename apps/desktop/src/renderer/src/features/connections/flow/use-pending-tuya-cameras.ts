/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  type TuyaBridgeCamera,
  type TuyaBridgeProvider,
} from './tuya-cameras';

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
    entries?: ReadonlyArray<Pick<IntegrationEntry, 'entry_id' | 'domain' | 'disabled_by'>>;
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
  const splitFromEntries = useMemo(
    () => (options?.entries ? splitTuyaEntryIds(options.entries) : undefined),
    [options?.entries],
  );
  const resolvedExplicitIds = options?.knownTuyaEntryIds ?? splitFromEntries?.tuyaEntryIds;
  const resolvedDisabledIds = options?.disabledEntryIds ?? splitFromEntries?.disabledTuyaEntryIds;
  const explicitIdsKey = resolvedExplicitIds?.join(',') ?? '';
  const disabledIdsKey = resolvedDisabledIds?.join(',') ?? '';

  const candidateSignature = useMemo(() => {
    if (
      demo ||
      snapshot.config.demo === true ||
      !enabled ||
      typeof window === 'undefined' ||
      !window.hausNative?.management ||
      !hasTuyaCameraCandidates(snapshot, resolvedExplicitIds, resolvedDisabledIds)
    ) {
      return '';
    }
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
    return `${explicitIdsKey}|${disabledIdsKey}|${parts.join(',')}|${camEntities.join(',')}`;
  }, [
    demo,
    disabledIdsKey,
    enabled,
    explicitIdsKey,
    resolvedDisabledIds,
    resolvedExplicitIds,
    snapshot,
  ]);

  const refresh = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    const onChanged = () => setNonce((n) => n + 1);
    listeners.add(onChanged);
    return () => {
      listeners.delete(onChanged);
    };
  }, []);

  useEffect(() => {
    if (!candidateSignature) {
      setState({ signature: '', loading: false, pending: [] });
      return;
    }

    let cancelled = false;
    setState((prev) => ({
      signature: candidateSignature,
      loading: prev.signature !== candidateSignature && prev.pending.length === 0,
      pending: prev.signature === candidateSignature ? prev.pending : [],
    }));

    void (async () => {
      const [fetchedEntries, providersRes] = await Promise.all([
        resolvedExplicitIds
          ? Promise.resolve<ReturnType<typeof splitTuyaEntryIds> | undefined>(undefined)
          : nativeApi()
              .request<IntegrationEntry[]>({ type: 'config_entries/get' })
              .then((rows) => splitTuyaEntryIds(rows))
              .catch(() => undefined),
        serverRequest<{ providers: TuyaBridgeProvider[] }>('GET', '/api/providers').catch(() => ({
          providers: [] as TuyaBridgeProvider[],
        })),
      ]);
      if (cancelled) return;

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
        snapshot,
        tuyaEntryIds: resolvedExplicitIds ?? fetchedEntries?.tuyaEntryIds,
        disabledEntryIds: resolvedDisabledIds ?? fetchedEntries?.disabledTuyaEntryIds,
        pairedProviders: tuyaBridges,
        pairedBridgeCameras,
      });
      setState({ signature: candidateSignature, loading: false, pending: items });
    })();

    return () => {
      cancelled = true;
    };
  }, [candidateSignature, nonce, snapshot, resolvedExplicitIds, resolvedDisabledIds]);

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
