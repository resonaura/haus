/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { randomUUID } from 'node:crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  appendTerminalOutput,
  buildDemoServersState,
  runDemoTerminalCommand,
  type ServerDetailTabId,
  type ServerSummaryRecord,
} from '@haus/core/transport';
import type { Snapshot } from '@haus/ha/types';
import {
  ServerConsoleView,
  ServerDetailView,
  ServersOverviewView,
  type ConsoleConnectionState,
  type PendingHostKeyPrompt,
} from '@haus/ui/components';
import type { GpuiSystemPorts } from './servers-port.js';

function buildDemoConsoleSnapshot(
  server: ServerSummaryRecord,
  tab: 'logs' | 'terminal',
  logsByServerId?: Readonly<Record<string, string>>,
): { state: ConsoleConnectionState; status: string; output: string } {
  if (tab === 'logs') {
    return {
      state: 'connected',
      status: 'Demo live logs',
      output: logsByServerId?.[server.id] ?? '[demo] waiting for log lines…\n',
    };
  }
  return {
    state: 'connected',
    status: 'Demo interactive shell',
    output: `Connected to ${server.name} (demo shell).\nType 'help' for built-in commands.\n\n`,
  };
}

export function GpuiServersView({
  snapshot,
  columns = 3,
  demo,
  system,
  onSaved,
}: {
  readonly snapshot: Snapshot;
  readonly columns?: number;
  readonly demo?: boolean;
  readonly system?: GpuiSystemPorts;
  readonly onSaved?: () => void;
}) {
  const demoInitial = useMemo(() => (demo ? buildDemoServersState() : undefined), [demo]);
  const [servers, setServers] = useState<readonly ServerSummaryRecord[]>(
    () => demoInitial?.servers ?? [],
  );
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<ServerDetailTabId>('overview');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Console state (shared across Logs and Terminal tabs)
  const [consoleState, setConsoleState] = useState<ConsoleConnectionState>('idle');
  const [consolePaused, setConsolePaused] = useState(false);
  const [consoleStatusMsg, setConsoleStatusMsg] = useState('');
  const [consoleOutput, setConsoleOutput] = useState('');
  const [hostKeyPrompt, setHostKeyPrompt] = useState<PendingHostKeyPrompt | undefined>(undefined);
  const [reconnectSeq, setReconnectSeq] = useState(0);
  const [trustFingerprint, setTrustFingerprint] = useState<string | undefined>(undefined);

  const sessionIdRef = useRef<string | undefined>(undefined);
  const pausedRef = useRef(consolePaused);
  pausedRef.current = consolePaused;
  const consoleStateRef = useRef(consoleState);
  consoleStateRef.current = consoleState;

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
    const timer = setInterval(() => void loadServers(true), 5000);
    return () => clearInterval(timer);
  }, [demo, loadServers]);

  const selectedServer = selectedId ? servers.find((item) => item.id === selectedId) : undefined;
  const isConsoleTab = activeTab === 'logs' || activeTab === 'terminal';

  // Manage live or demo stream lifecycle for Logs and Terminal tabs.
  useEffect(() => {
    if (!selectedServer || !isConsoleTab) {
      sessionIdRef.current = undefined;
      setConsoleState('idle');
      setHostKeyPrompt(undefined);
      return;
    }

    if (demo) {
      if (consoleStateRef.current === 'idle') {
        const snapshot = buildDemoConsoleSnapshot(
          selectedServer,
          activeTab,
          demoInitial?.logsByServerId,
        );
        setConsoleState(snapshot.state);
        setConsoleStatusMsg(snapshot.status);
        setConsoleOutput(snapshot.output);
      }
      return;
    }

    if (!system) return;
    const terminalPort = system.terminal;
    const sessionId = randomUUID();
    sessionIdRef.current = sessionId;
    const decoder = new TextDecoder();
    setConsoleState('connecting');
    setConsoleStatusMsg('Opening direct E2EE channel…');
    setConsoleOutput('');
    setHostKeyPrompt(undefined);

    const unsubscribe = terminalPort.subscribe((event) => {
      if (event.sessionId !== sessionId) return;
      if (event.type === 'data') {
        terminalPort.ack(sessionId, event.bytes);
        if (!pausedRef.current) {
          const text = decoder.decode(event.data, { stream: true });
          setConsoleOutput((prev) => appendTerminalOutput(prev, text));
        }
      } else if (event.type === 'status') {
        setConsoleState(event.state);
        setConsoleStatusMsg(
          event.message ??
            (event.state === 'connected'
              ? `${event.scope ?? 'hub'} · ${event.hostname ?? selectedServer.name}`
              : event.state),
        );
      } else if (event.type === 'host-key') {
        setHostKeyPrompt({ fingerprint: event.fingerprint, changed: event.changed });
      } else if (event.type === 'exit') {
        setConsoleState('disconnected');
        setConsoleStatusMsg(
          event.code === null ? 'Session closed' : `Exited with code ${event.code}`,
        );
      }
    });

    void terminalPort
      .open({
        sessionId,
        serverId: selectedServer.managedId ?? selectedServer.id,
        target: activeTab === 'logs' ? { kind: 'hub-logs' } : { kind: 'shell' },
        cols: 120,
        rows: 32,
        ...(trustFingerprint ? { trustFingerprint } : {}),
      })
      .catch((err: unknown) => {
        if (sessionIdRef.current !== sessionId) return;
        setConsoleState('disconnected');
        setConsoleStatusMsg(err instanceof Error ? err.message : 'Terminal connection failed.');
      });

    return () => {
      unsubscribe();
      terminalPort.close(sessionId);
      if (sessionIdRef.current === sessionId) sessionIdRef.current = undefined;
    };
  }, [activeTab, demo, demoInitial, isConsoleTab, reconnectSeq, selectedServer, system, trustFingerprint]);

  const sendCommand = (command: string) => {
    if (!selectedServer) return;
    if (demo) {
      const result = runDemoTerminalCommand(selectedServer.name, command);
      if (result.clear) {
        setConsoleOutput('');
      } else {
        setConsoleOutput((prev) => appendTerminalOutput(prev, result.output));
      }
      return;
    }
    const id = sessionIdRef.current;
    if (!id || !system) return;
    void system.terminal.write(id, `${command}\n`).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not send command.');
    });
  };

  const sendInterrupt = () => {
    if (demo) {
      setConsoleOutput((prev) => appendTerminalOutput(prev, '^C\n'));
      return;
    }
    const id = sessionIdRef.current;
    if (!id || !system) return;
    void system.terminal.write(id, '\x03').catch(() => undefined);
  };

  if (selectedServer) {
    const consoleNode = (
      <ServerConsoleView
        title={activeTab === 'logs' ? `${selectedServer.name} · Hub logs` : `${selectedServer.name} · Shell`}
        readOnly={activeTab === 'logs'}
        state={consoleState}
        output={consoleOutput}
        paused={consolePaused}
        statusMessage={consoleStatusMsg}
        pendingHostKey={hostKeyPrompt}
        onTogglePause={() => setConsolePaused((prev) => !prev)}
        onClear={() => setConsoleOutput('')}
        onReconnect={() => {
          if (demo && (activeTab === 'logs' || activeTab === 'terminal')) {
            const next = buildDemoConsoleSnapshot(
              selectedServer,
              activeTab,
              demoInitial?.logsByServerId,
            );
            setConsoleState(next.state);
            setConsoleStatusMsg(next.status);
            setConsoleOutput(next.output);
            return;
          }
          setReconnectSeq((n) => n + 1);
        }}
        onSendCommand={activeTab === 'terminal' ? sendCommand : undefined}
        onSendInterrupt={activeTab === 'terminal' ? sendInterrupt : undefined}
        onTrustHostKey={(fingerprint) => {
          setTrustFingerprint(fingerprint);
          setHostKeyPrompt(undefined);
          setReconnectSeq((n) => n + 1);
        }}
        onDismissHostKey={() => {
          setHostKeyPrompt(undefined);
          if (sessionIdRef.current && system) system.terminal.close(sessionIdRef.current);
        }}
      />
    );

    return (
      <ServerDetailView
        server={selectedServer}
        activeTab={activeTab}
        canManage={Boolean(demo || snapshot.user.is_admin)}
        busy={busy}
        error={error || undefined}
        logsSlot={consoleNode}
        terminalSlot={consoleNode}
        onSelectTab={(nextTab) => {
          setError('');
          if (nextTab === 'logs' || nextTab === 'terminal') {
            if (demo) {
              const next = buildDemoConsoleSnapshot(
                selectedServer,
                nextTab,
                demoInitial?.logsByServerId,
              );
              setConsoleState(next.state);
              setConsoleStatusMsg(next.status);
              setConsoleOutput(next.output);
            }
          } else {
            setConsoleState('idle');
            setConsoleStatusMsg('');
            setHostKeyPrompt(undefined);
          }
          setActiveTab(nextTab);
        }}
        onBack={() => {
          setSelectedId(undefined);
          setActiveTab('overview');
          setConsoleState('idle');
          setConsoleStatusMsg('');
          setHostKeyPrompt(undefined);
          setError('');
        }}
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
