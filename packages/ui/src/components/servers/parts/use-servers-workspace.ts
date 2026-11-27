/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  buildDemoServersState,
  formatRatio,
  resolveServerConnectionState,
  type ServerDetailTabId,
  type ServerResourceSample,
  type ServerRoomOption,
  type ServerSummaryRecord,
} from '@haus/core/transport';
import type { ClusterMeshStatusView, ClusterOperationProgressView } from '../cluster-banner.js';
import type { DiscoveredClusterHubCandidate } from '../cluster-modal.js';
import type {
  ActiveServerSelection,
  PortableServersManagementPort,
  ServerDevicePreferenceInput,
} from '../servers-workspace.js';
import { appendHistoryTick, applyServerPreferences } from './server-options-dialog.js';

export function useServersWorkspaceController({
  demo,
  rooms,
  serverPreferences,
  port,
  onActiveServerChange,
}: {
  readonly demo: boolean;
  readonly rooms: readonly ServerRoomOption[];
  readonly serverPreferences: Readonly<Record<string, ServerDevicePreferenceInput | undefined>>;
  readonly port?: PortableServersManagementPort;
  readonly onActiveServerChange?: (selection: ActiveServerSelection | undefined) => void;
}) {
  const demoInitial = useMemo(() => (demo ? buildDemoServersState() : undefined), [demo]);
  const [rawServers, setRawServers] = useState<readonly ServerSummaryRecord[]>(
    () => demoInitial?.servers ?? [],
  );
  const [historyByServer, setHistoryByServer] = useState<
    Readonly<Record<string, readonly ServerResourceSample[]>>
  >(() => demoInitial?.historyByServerId ?? {});
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<ServerDetailTabId>('overview');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cluster, setCluster] = useState<ClusterMeshStatusView | undefined>(undefined);
  const [clusterProgress, setClusterProgress] = useState<ClusterOperationProgressView>();
  const [addHubOpen, setAddHubOpen] = useState(false);
  const [candidateHubs, setCandidateHubs] = useState<DiscoveredClusterHubCandidate[]>([]);
  const [scanningHubs, setScanningHubs] = useState(false);
  const [optionsServer, setOptionsServer] = useState<ServerSummaryRecord | undefined>(undefined);

  const rawServersRef = useRef(rawServers);
  rawServersRef.current = rawServers;

  const servers = useMemo(
    () => applyServerPreferences(rawServers, rooms, serverPreferences),
    [rawServers, rooms, serverPreferences],
  );

  const recordSampleBatch = useCallback(
    (items: readonly ServerSummaryRecord[], timestamp: number) => {
      setHistoryByServer((prev) => {
        const next: Record<string, readonly ServerResourceSample[]> = { ...prev };
        for (const item of items) {
          const online = item.online === true && item.monitoringOnline !== false;
          const sample: ServerResourceSample = {
            time: timestamp,
            cpu: online ? item.cpuUsage : null,
            memory: online ? formatRatio(item.memoryUsedBytes, item.memoryTotalBytes) : null,
            swap:
              online && item.swapSupported
                ? formatRatio(item.swapUsedBytes, item.swapTotalBytes)
                : null,
          };
          next[item.id] = appendHistoryTick(prev[item.id] ?? [], sample);
        }
        return next;
      });
    },
    [],
  );

  const loadServers = useCallback(
    async (silent = false) => {
      if (demo) {
        setRawServers(buildDemoServersState().servers);
        return;
      }
      if (!port) {
        setError('Connect to a Haus Hub or enable Demo mode to view servers.');
        return;
      }
      if (!silent) setLoading(true);
      try {
        const [loaded, loadedCluster] = await Promise.all([
          port.loadServers(),
          port.loadCluster ? port.loadCluster().catch(() => undefined) : undefined,
        ]);
        setRawServers(loaded);
        if (loadedCluster) setCluster(loadedCluster);
        recordSampleBatch(loaded, Date.now());
        setError('');
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Could not load server telemetry.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [demo, port, recordSampleBatch],
  );

  useEffect(() => {
    void loadServers(false);
    if (demo) return;
    const timer = setInterval(() => void loadServers(true), 2000);
    return () => clearInterval(timer);
  }, [demo, loadServers]);

  useEffect(() => {
    let tick = 0;
    const timer = setInterval(() => {
      tick += 1;
      const now = Date.now();
      if (demo) {
        setHistoryByServer((prev) => {
          const next: Record<string, readonly ServerResourceSample[]> = { ...prev };
          for (const item of rawServersRef.current) {
            const current = prev[item.id] ?? [];
            const base = current.at(-1);
            const cpu = Math.max(
              0.04,
              Math.min(0.92, (base?.cpu ?? item.cpuUsage ?? 0.2) + Math.sin(tick * 0.55) * 0.022),
            );
            const memory = Math.max(
              0.1,
              Math.min(0.95, (base?.memory ?? 0.4) + Math.cos(tick * 0.35) * 0.006),
            );
            next[item.id] = appendHistoryTick(current, {
              time: now,
              cpu,
              memory,
              swap: base?.swap ?? 0.08,
            });
          }
          return next;
        });
        return;
      }
      if (rawServersRef.current.length > 0) recordSampleBatch(rawServersRef.current, now);
    }, 1000);
    return () => clearInterval(timer);
  }, [demo, recordSampleBatch]);

  const selectedServer = selectedId ? servers.find((item) => item.id === selectedId) : undefined;
  const activeCallbackRef = useRef(onActiveServerChange);
  activeCallbackRef.current = onActiveServerChange;
  const selectTabRef = useRef<(tab: ServerDetailTabId) => void>(() => {});
  const backRef = useRef<() => void>(() => {});

  const handleSelectTab = (nextTab: ServerDetailTabId) => {
    setError('');
    setActiveTab(nextTab);
  };
  const handleBack = () => {
    setSelectedId(undefined);
    setActiveTab('overview');
    setError('');
  };
  selectTabRef.current = handleSelectTab;
  backRef.current = handleBack;

  const selectedStatus = selectedServer ? resolveServerConnectionState(selectedServer) : undefined;

  useLayoutEffect(() => {
    const notify = activeCallbackRef.current;
    if (!notify) return;
    if (!selectedServer) {
      notify(undefined);
      return;
    }
    notify({
      server: selectedServer,
      activeTab,
      onSelectTab: (tab) => selectTabRef.current(tab),
      onBack: () => backRef.current(),
    });
  }, [
    activeTab,
    selectedServer?.id,
    selectedServer?.name,
    selectedServer?.kind,
    selectedServer?.managedId,
    selectedServer?.nvr?.hasNvr,
    selectedStatus,
  ]);

  useLayoutEffect(() => () => activeCallbackRef.current?.(undefined), []);

  const scanHubs = useCallback(() => {
    if (!port?.discoverCandidateHubs) return;
    setScanningHubs(true);
    void port
      .discoverCandidateHubs()
      .then(setCandidateHubs)
      .catch(() => undefined)
      .finally(() => setScanningHubs(false));
  }, [port]);

  const runClusterAction = (label: string, fn: () => Promise<void>, doneMsg: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    const logs = [`[CLUSTER] ${label}`];
    setClusterProgress({
      title: label,
      detail: 'Coordinating single-active cluster state & peer leases…',
      percent: 45,
      state: 'running',
      logs,
    });
    void fn()
      .then(async () => {
        setNotice(doneMsg);
        setClusterProgress({
          title: doneMsg,
          percent: 100,
          state: 'complete',
          logs: [...logs, `[OK] ${doneMsg}`],
          onDismiss: () => setClusterProgress(undefined),
        });
        await loadServers(true);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Cluster operation failed.';
        setError(msg);
        setClusterProgress({
          title: 'Cluster operation failed',
          detail: msg,
          percent: 100,
          state: 'failed',
          logs: [...logs, `[ERROR] ${msg}`],
          onDismiss: () => setClusterProgress(undefined),
        });
      })
      .finally(() => setBusy(false));
  };

  return {
    demoInitial,
    servers,
    selectedServer,
    historyByServer,
    activeTab,
    loading,
    busy,
    error,
    notice,
    cluster,
    clusterProgress,
    addHubOpen,
    candidateHubs,
    scanningHubs,
    optionsServer,
    setRawServers,
    setSelectedId,
    setActiveTab,
    setBusy,
    setError,
    setNotice,
    setAddHubOpen,
    setOptionsServer,
    loadServers,
    handleSelectTab,
    handleBack,
    scanHubs,
    runClusterAction,
  };
}
