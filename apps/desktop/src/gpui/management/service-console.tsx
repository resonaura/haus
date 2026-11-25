/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { randomUUID } from 'node:crypto';
import { useEffect, useRef, useState } from 'react';
import {
  appendTerminalOutput,
  buildDemoServiceConsoleOutput,
  runDemoTerminalCommand,
  switchServiceConsoleMode,
  type ActiveServiceConsole,
} from '@haus/core/transport';
import {
  ServerConsoleView,
  ServiceConsoleModal,
  type ConsoleConnectionState,
  type PendingHostKeyPrompt,
} from '@haus/ui/components';
import type { GpuiTerminalPort } from './servers-port.js';

export function GpuiServiceConsoleModal({
  serverId,
  serverName,
  consoleState,
  demo,
  terminal,
  onCopyText,
  onChangeMode,
  onClose,
}: {
  readonly serverId: string;
  readonly serverName: string;
  readonly consoleState: ActiveServiceConsole;
  readonly demo?: boolean;
  readonly terminal?: GpuiTerminalPort;
  readonly onCopyText?: (text: string) => void;
  readonly onChangeMode: (next: ActiveServiceConsole) => void;
  readonly onClose: () => void;
}) {
  const readOnly = consoleState.target.kind !== 'docker-exec';
  const targetKey = JSON.stringify(consoleState.target);

  const [state, setState] = useState<ConsoleConnectionState>('idle');
  const [paused, setPaused] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [output, setOutput] = useState('');
  const [pendingHostKey, setPendingHostKey] = useState<PendingHostKeyPrompt | undefined>(undefined);
  const [reconnectSeq, setReconnectSeq] = useState(0);
  const [trustFingerprint, setTrustFingerprint] = useState<string | undefined>(undefined);

  const sessionIdRef = useRef<string | undefined>(undefined);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    if (demo) {
      setState('connected');
      setStatusMessage(readOnly ? 'Demo service logs' : 'Demo container shell');
      setOutput(buildDemoServiceConsoleOutput(serverName, consoleState));
      setPendingHostKey(undefined);
      return;
    }
    if (!terminal) {
      setState('disconnected');
      setStatusMessage('Terminal transport unavailable');
      return;
    }

    const sessionId = randomUUID();
    sessionIdRef.current = sessionId;
    const decoder = new TextDecoder();
    setState('connecting');
    setStatusMessage('Opening direct E2EE channel…');
    setOutput('');
    setPendingHostKey(undefined);

    const unsubscribe = terminal.subscribe((event) => {
      if (event.sessionId !== sessionId) return;
      if (event.type === 'data') {
        terminal.ack(sessionId, event.bytes);
        if (!pausedRef.current) {
          const text = decoder.decode(event.data, { stream: true });
          setOutput((prev) => appendTerminalOutput(prev, text));
        }
      } else if (event.type === 'status') {
        setState(event.state);
        setStatusMessage(
          event.message ??
            (event.state === 'connected'
              ? `${event.scope ?? 'hub'} · ${event.hostname ?? serverName}`
              : event.state),
        );
      } else if (event.type === 'host-key') {
        setPendingHostKey({ fingerprint: event.fingerprint, changed: event.changed });
      } else if (event.type === 'exit') {
        setState('disconnected');
        setStatusMessage(event.code === null ? 'Session closed' : `Exited with code ${event.code}`);
      }
    });

    void terminal
      .open({
        sessionId,
        serverId,
        target: consoleState.target,
        cols: 120,
        rows: 32,
        ...(trustFingerprint ? { trustFingerprint } : {}),
      })
      .catch((err: unknown) => {
        if (sessionIdRef.current !== sessionId) return;
        setState('disconnected');
        setStatusMessage(err instanceof Error ? err.message : 'Service console connection failed.');
      });

    return () => {
      unsubscribe();
      terminal.close(sessionId);
      if (sessionIdRef.current === sessionId) sessionIdRef.current = undefined;
    };
  }, [demo, readOnly, reconnectSeq, serverId, serverName, targetKey, terminal, trustFingerprint]);

  const sendCommand = (command: string) => {
    if (demo) {
      const result = runDemoTerminalCommand(serverName, command);
      if (result.clear) {
        setOutput('');
      } else {
        setOutput((prev) => appendTerminalOutput(prev, result.output));
      }
      return;
    }
    const id = sessionIdRef.current;
    if (!id || !terminal) return;
    void terminal.write(id, `${command}\n`).catch((err: unknown) => {
      setStatusMessage(err instanceof Error ? err.message : 'Could not send command.');
    });
  };

  const sendInterrupt = () => {
    if (demo) {
      setOutput((prev) => appendTerminalOutput(prev, '^C\n'));
      return;
    }
    const id = sessionIdRef.current;
    if (!id || !terminal) return;
    void terminal.write(id, '\x03').catch(() => undefined);
  };

  return (
    <ServiceConsoleModal consoleState={consoleState} onChangeMode={onChangeMode} onClose={onClose}>
      <ServerConsoleView
        title={consoleState.title}
        readOnly={readOnly}
        state={state}
        output={output}
        paused={paused}
        statusMessage={statusMessage}
        pendingHostKey={pendingHostKey}
        onTogglePause={() => setPaused((prev) => !prev)}
        onClear={() => setOutput('')}
        onReconnect={() => {
          if (demo) {
            setState('connected');
            setStatusMessage(readOnly ? 'Demo service logs' : 'Demo container shell');
            setOutput(buildDemoServiceConsoleOutput(serverName, consoleState));
            return;
          }
          setReconnectSeq((n) => n + 1);
        }}
        onCopyOutput={onCopyText}
        onSwitchToLogs={
          consoleState.containerId && !readOnly
            ? () => onChangeMode(switchServiceConsoleMode(consoleState, 'logs'))
            : undefined
        }
        onSendCommand={readOnly ? undefined : sendCommand}
        onSendInterrupt={readOnly ? undefined : sendInterrupt}
        onTrustHostKey={(fingerprint) => {
          setTrustFingerprint(fingerprint);
          setPendingHostKey(undefined);
          setReconnectSeq((n) => n + 1);
        }}
        onDismissHostKey={() => {
          setPendingHostKey(undefined);
          if (sessionIdRef.current && terminal) terminal.close(sessionIdRef.current);
        }}
      />
    </ServiceConsoleModal>
  );
}
