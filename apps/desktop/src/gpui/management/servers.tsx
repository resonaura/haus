/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  buildDemoServersState,
  buildServiceConsoleRequest,
  formatRatio,
  resolveServerConnectionState,
  type ActiveServiceConsole,
  type ServerDetailTabId,
  type ServerResourceSample,
  type ServerSummaryRecord,
} from '@haus/core/transport';
import type { Snapshot } from '@haus/ha/types';
import {
  ServerDetailView,
  ServersOverviewView,
  type SidebarContextualNav,
} from '@haus/ui/components';
import { buildServerSidebarNav } from '../home/navigation.js';
import { GpuiLiveTerminal } from './live-terminal.js';
import type { GpuiSystemPorts } from './servers-port.js';
import { GpuiServiceConsoleModal } from './service-console.js';

export function GpuiServersView({
  snapshot,
  columns = 3,
  demo,
  system,
  onCopyText,
  onSaved,
  onContextualSidebarChange,
}: {
  readonly snapshot: Snapshot;
  readonly columns?: number;
  readonly demo?: boolean;
  readonly system?: GpuiSystemPorts;
  readonly onCopyText?: (text: string) => void;
  readonly onSaved?: () => void;
  readonly onContextualSidebarChange?: (context: SidebarContextualNav | undefined) => void;
}) {
  const demoInitial = useMemo(() => (demo ? buildDemoServersState() : undefined), [demo]);
  const [servers, setServers] = useState<readonly ServerSummaryRecord[]>(
    () => demoInitial?.servers ?? [],
  );
  const [historyByServer, setHistoryByServer] = useState<
    Readonly<Record<string, readonly ServerResourceSample[]>>
  >(() => demoInitial?.historyByServerId ?? {});
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<ServerDetailTabId>('overview');
  const [activeServiceConsole, setActiveServiceConsole] = useState<ActiveServiceConsole>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadServers = useCallback(
    async (silent = false) => {
      if (demo) {
        const next = buildDemoServersState();
        setServers(next.servers);
        return;
      }
      if (!system) {
        setError('Connect to a Haus Hub or enable Demo mode to view servers.');
        return;
      }
      if (!silent) setLoading(true);
      try {
        const loaded = await system.servers.loadServers();
        setServers(loaded);
        const now = Date.now();
        setHistoryByServer((prev) => {
          const next: Record<string, readonly ServerResourceSample[]> = { ...prev };
          for (const item of loaded) {
            const sample: ServerResourceSample = {
              time: now,
              cpu: item.cpuUsage,
              memory: formatRatio(item.memoryUsedBytes, item.memoryTotalBytes),
              swap: item.swapSupported
                ? formatRatio(item.swapUsedBytes, item.swapTotalBytes)
                : null,
            };
            const list = prev[item.id] ?? [];
            next[item.id] = [...list.slice(-59), sample];
          }
          return next;
        });
        setError('');
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Could not load server telemetry.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [demo, system],
  );

  useEffect(() => {
    void loadServers(false);
    if (demo) return;
    const timer = setInterval(() => void loadServers(true), 2500);
    return () => clearInterval(timer);
  }, [demo, loadServers]);

  useEffect(() => {
    if (!demo || !selectedId || activeTab !== 'overview') return;
    let tick = 0;
    const timer = setInterval(() => {
      tick += 1;
      const now = Date.now();
      setHistoryByServer((prev) => {
        const current = prev[selectedId] ?? [];
        const base = current.at(-1);
        const cpu = Math.max(
          0.04,
          Math.min(0.92, (base?.cpu ?? 0.2) + Math.sin(tick * 0.7) * 0.025),
        );
        const memory = Math.max(
          0.1,
          Math.min(0.95, (base?.memory ?? 0.4) + Math.cos(tick * 0.4) * 0.008),
        );
        const swap = base?.swap ?? 0.08;
        return {
          ...prev,
          [selectedId]: [...current.slice(-59), { time: now, cpu, memory, swap }],
        };
      });
    }, 1500);
    return () => clearInterval(timer);
  }, [activeTab, demo, selectedId]);

  const selectedServer = selectedId ? servers.find((item) => item.id === selectedId) : undefined;

  const selectTabRef = useRef<(nextTab: ServerDetailTabId) => void>(() => {});
  const closeServerRef = useRef<() => void>(() => {});
  const sidebarCallbackRef = useRef(onContextualSidebarChange);
  sidebarCallbackRef.current = onContextualSidebarChange;

  const handleSelectTab = (nextTab: ServerDetailTabId) => {
    setError('');
    setActiveTab(nextTab);
  };

  const handleBack = () => {
    setSelectedId(undefined);
    setActiveTab('overview');
    setActiveServiceConsole(undefined);
    setError('');
  };

  selectTabRef.current = handleSelectTab;
  closeServerRef.current = handleBack;

  const selectedServerId = selectedServer?.id;
  const selectedServerName = selectedServer?.name;
  const selectedServerKind = selectedServer?.kind;
  const selectedServerManaged = Boolean(selectedServer?.managedId);
  const selectedServerHasNvr = Boolean(selectedServer?.nvr?.hasNvr);
  const selectedServerStatus = selectedServer
    ? resolveServerConnectionState(selectedServer)
    : undefined;

  useLayoutEffect(() => {
    const notify = sidebarCallbackRef.current;
    if (!notify) return;
    if (!selectedServerId || !selectedServerName || !selectedServerKind) {
      notify(undefined);
      return;
    }
    notify(
      buildServerSidebarNav({
        name: selectedServerName,
        kind: selectedServerKind,
        managed: selectedServerManaged,
        hasNvr: selectedServerHasNvr,
        status: selectedServerStatus,
        activeTab,
        onSelectTab: (tab) => selectTabRef.current(tab),
        onBack: () => closeServerRef.current(),
      }),
    );
  }, [
    activeTab,
    selectedServerHasNvr,
    selectedServerId,
    selectedServerKind,
    selectedServerManaged,
    selectedServerName,
    selectedServerStatus,
  ]);

  useLayoutEffect(() => () => sidebarCallbackRef.current?.(undefined), []);

  if (selectedServer) {
    const serverTargetId = selectedServer.managedId ?? selectedServer.id;
    const logsSlot =
      activeTab === 'logs' ? (
        <GpuiLiveTerminal
          serverId={serverTargetId}
          serverName={selectedServer.name}
          target={{ kind: 'hub-logs' }}
          demo={demo}
          demoLogs={demoInitial?.logsByServerId[selectedServer.id]}
          terminal={system?.terminal}
          onCopyText={onCopyText}
        />
      ) : undefined;
    const terminalSlot =
      activeTab === 'terminal' ? (
        <GpuiLiveTerminal
          serverId={serverTargetId}
          serverName={selectedServer.name}
          target={{ kind: 'shell' }}
          demo={demo}
          terminal={system?.terminal}
          onCopyText={onCopyText}
        />
      ) : undefined;

    return (
      <>
        <ServerDetailView
          server={selectedServer}
          history={historyByServer[selectedServer.id] ?? []}
          activeTab={activeTab}
          canManage={Boolean(demo || snapshot.user.is_admin)}
          contextualNavigation={Boolean(onContextualSidebarChange)}
          busy={busy}
          error={error || undefined}
          logsSlot={logsSlot}
          terminalSlot={terminalSlot}
          onInspectService={(service, mode) =>
            setActiveServiceConsole(buildServiceConsoleRequest(service, mode))
          }
          onSelectTab={handleSelectTab}
          onBack={handleBack}
          onToggleEnabled={() => {
            if (demo) {
              setServers((prev) =>
                prev.map((item) =>
                  item.id === selectedServer.id ? { ...item, enabled: !item.enabled } : item,
                ),
              );
              return;
            }
            if (!system) return;
            setBusy(true);
            setError('');
            void system.servers
              .setServerEnabled(selectedServer.id, !selectedServer.enabled)
              .then(() => {
                onSaved?.();
                return loadServers(true);
              })
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : 'Could not update server.');
              })
              .finally(() => setBusy(false));
          }}
        />
        {activeServiceConsole && (
          <GpuiServiceConsoleModal
            serverId={serverTargetId}
            serverName={selectedServer.name}
            consoleState={activeServiceConsole}
            demo={demo}
            terminal={system?.terminal}
            onCopyText={onCopyText}
            onChangeMode={setActiveServiceConsole}
            onClose={() => setActiveServiceConsole(undefined)}
          />
        )}
      </>
    );
  }

  return (
    <ServersOverviewView
      columns={columns}
      servers={servers}
      loading={loading}
      error={error || undefined}
      notice={notice || undefined}
      onRefresh={() => {
        setNotice('');
        void loadServers(false);
      }}
      onSelectServer={(id) => {
        setError('');
        setNotice('');
        setSelectedId(id);
        setActiveTab('overview');
      }}
    />
  );
}
