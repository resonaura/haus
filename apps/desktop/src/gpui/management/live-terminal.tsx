/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import { useEffect, useRef, useState } from 'react';
import { isReadOnlyTerminalTarget, type TerminalTarget } from '@haus/core/protocol';
import type { TerminalSearchOptions } from '@haus/core/transport';
import {
  TerminalSearchBar,
  UiIcon,
  type ConsoleConnectionState,
  type PendingHostKeyPrompt,
} from '@haus/ui/components';
import { GpuiXtermTerminal, type GpuiXtermHandle } from '@haus/ui/gpui';
import { colorToken, corners, insets, pct, px, rgba, SolidMaterial } from '@haus/ui/ir';
import { Box, HausButton, Heading, Stack, Text, useHausUi } from '@haus/ui/primitives';
import { DemoInteractivePty, formatDemoAnsiLogs } from './demo-pty.js';
import type { GpuiTerminalPort } from './servers-port.js';
import { GpuiTerminalFooter, GpuiTerminalHostKeyBanner } from './terminal-chrome.js';

const NON_RETRYABLE_ERROR =
  /administrator|disabled|not trusted|could not be verified|not available|integrity|invalid encrypted|handshake|not found|Start this Docker|host with journalctl|container-backed|does not include an interactive shell|distroless/i;
const SHELL_UNAVAILABLE_RE = /does not include an interactive shell|distroless/i;

export interface GpuiLiveTerminalProps {
  readonly serverId: string;
  readonly serverName: string;
  readonly target: TerminalTarget;
  readonly demo?: boolean;
  readonly demoLogs?: string;
  readonly terminal?: GpuiTerminalPort;
  readonly heightPx?: number;
  readonly onCopyText?: (text: string) => void;
  readonly onSwitchToLogs?: () => void;
}

/**
 * Native GPUIX ANSI-color xterm.js terminal and live-log viewer matching Electron's `LiveTerminal`
 * 1:1 — backed by `@xterm/headless` + Retina Skia `<GpuiCanvas />` and Haus Direct Binary E2EE IPC.
 */
export function GpuiLiveTerminal({
  serverId,
  serverName,
  target,
  demo = false,
  demoLogs,
  terminal,
  heightPx = 460,
  onCopyText,
  onSwitchToLogs,
}: GpuiLiveTerminalProps) {
  const { theme } = useHausUi();
  const readOnly = isReadOnlyTerminalTarget(target);
  const targetKey = JSON.stringify(target);
  const targetRef = useRef(target);
  targetRef.current = target;

  const [state, setState] = useState<ConsoleConnectionState>('idle');
  const [hostname, setHostname] = useState<string | undefined>(undefined);
  const [relayed, setRelayed] = useState(false);
  const [error, setError] = useState('');
  const [hostKey, setHostKey] = useState<PendingHostKeyPrompt | undefined>(undefined);
  const [geometry, setGeometry] = useState({ cols: 80, rows: 22 });
  const [paused, setPaused] = useState(false);
  const [queuedChunks, setQueuedChunks] = useState(0);
  const [copied, setCopied] = useState(false);
  const [reconnectSeq, setReconnectSeq] = useState(0);
  const [trustFingerprint, setTrustFingerprint] = useState<string | undefined>(undefined);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOptions, setSearchOptions] = useState<TerminalSearchOptions>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  const [searchResult, setSearchResult] = useState<{
    readonly resultIndex: number;
    readonly resultCount: number;
    readonly error?: string;
  }>({ resultIndex: -1, resultCount: 0 });

  const xtermRef = useRef<GpuiXtermHandle | null>(null);
  const demoPtyRef = useRef<DemoInteractivePty | null>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const stateRef = useRef(state);
  stateRef.current = state;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const pendingOutputRef = useRef<Array<{ readonly data: Uint8Array; readonly bytes: number }>>([]);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectAttemptsRef = useRef(0);
  const exitedRef = useRef(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    if (searchOpen && query) {
      setSearchResult(term.search(query, searchOptions));
    } else {
      term.clearSearch();
      setSearchResult({ resultIndex: -1, resultCount: 0 });
    }
  }, [query, searchOpen, searchOptions]);

  useEffect(() => {
    let disposed = false;
    clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = undefined;
    pendingOutputRef.current = [];
    setQueuedChunks(0);
    setPaused(false);
    pausedRef.current = false;
    setError('');
    setHostKey(undefined);
    setHostname(undefined);
    setRelayed(false);
    exitedRef.current = false;
    demoPtyRef.current = null;
    xtermRef.current?.reset();

    if (demo) {
      setState('connected');
      setHostname(serverName);
      if (readOnly) {
        xtermRef.current?.write(formatDemoAnsiLogs(demoLogs ?? '', serverName));
      } else {
        const pty = new DemoInteractivePty(
          serverName,
          targetRef.current,
          (chunk) => xtermRef.current?.write(chunk),
          () => xtermRef.current?.clear(),
        );
        demoPtyRef.current = pty;
        pty.banner();
      }
      return () => {
        disposed = true;
        demoPtyRef.current = null;
      };
    }

    if (!terminal) {
      setState('disconnected');
      setError('Direct Hub terminal transport is unavailable.');
      return;
    }

    const sessionId = randomUUID();
    sessionIdRef.current = sessionId;
    setState('connecting');

    const unsubscribe = terminal.subscribe((event) => {
      if (event.sessionId !== sessionId || disposed) return;
      if (event.type === 'data') {
        if (pausedRef.current) {
          pendingOutputRef.current.push({ data: event.data, bytes: event.bytes });
          if (pendingOutputRef.current.length > 400) {
            const dropped = pendingOutputRef.current.shift();
            if (dropped) terminal.ack(sessionId, dropped.bytes);
          }
          setQueuedChunks(pendingOutputRef.current.length);
          return;
        }
        xtermRef.current?.write(event.data, () => terminal.ack(sessionId, event.bytes));
      } else if (event.type === 'host-key') {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = undefined;
        setHostKey({ fingerprint: event.fingerprint, changed: event.changed });
        setState('disconnected');
      } else if (event.type === 'status') {
        setState(event.state);
        if (event.message) setError(event.message);
        if (event.state === 'connected') {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = undefined;
          reconnectAttemptsRef.current = 0;
          setHostname(event.hostname ?? serverName);
          setRelayed(Boolean(event.relayed));
          if (!readOnly) {
            const g = xtermRef.current?.getGeometry() ?? geometryRef.current;
            terminal.resize(sessionId, g.cols, g.rows);
          }
        } else if (event.state === 'disconnected' && !exitedRef.current) {
          if (NON_RETRYABLE_ERROR.test(event.message ?? '')) return;
          if (reconnectAttemptsRef.current < 5) {
            const delay = Math.min(15_000, 1000 * 2 ** reconnectAttemptsRef.current++);
            reconnectTimerRef.current = setTimeout(() => {
              if (!disposed) setReconnectSeq((n) => n + 1);
            }, delay);
          }
        }
      } else if (event.type === 'exit') {
        exitedRef.current = true;
        setState('disconnected');
        xtermRef.current?.writeln(
          readOnly
            ? '\r\n\x1b[2mStream ended.\x1b[0m'
            : '\r\n\x1b[33mSession ended. Press Enter to reconnect.\x1b[0m',
        );
      }
    });

    const initialGeo = xtermRef.current?.getGeometry() ?? geometryRef.current;
    void terminal
      .open({
        sessionId,
        serverId,
        target: targetRef.current,
        cols: Math.max(20, initialGeo.cols),
        rows: Math.max(4, initialGeo.rows),
        ...(trustFingerprint ? { trustFingerprint } : {}),
      })
      .catch((failure: unknown) => {
        if (sessionIdRef.current !== sessionId || disposed) return;
        setState('disconnected');
        setError(failure instanceof Error ? failure.message : 'Could not open direct Hub stream.');
      });

    return () => {
      disposed = true;
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
      unsubscribe();
      terminal.close(sessionId);
      if (sessionIdRef.current === sessionId) sessionIdRef.current = undefined;
    };
  }, [
    demo,
    demoLogs,
    readOnly,
    reconnectSeq,
    serverId,
    serverName,
    targetKey,
    terminal,
    trustFingerprint,
  ]);

  const handleTerminalData = (data: string) => {
    if (readOnly) return;
    if (demo) {
      demoPtyRef.current?.feed(data);
      return;
    }
    if (stateRef.current !== 'connected') {
      if (data === '\r' && stateRef.current !== 'connecting') {
        reconnectAttemptsRef.current = 0;
        setReconnectSeq((n) => n + 1);
      }
      return;
    }
    const id = sessionIdRef.current;
    if (!id || !terminal) return;
    void terminal.write(id, data).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not send terminal input.');
    });
  };

  const handleResize = (next: { readonly cols: number; readonly rows: number }) => {
    setGeometry((prev) => (prev.cols === next.cols && prev.rows === next.rows ? prev : next));
    const id = sessionIdRef.current;
    if (!demo && !readOnly && id && stateRef.current === 'connected') {
      terminal?.resize(id, next.cols, next.rows);
    }
  };

  const togglePause = () => {
    if (pausedRef.current) {
      pausedRef.current = false;
      setPaused(false);
      const id = sessionIdRef.current;
      const queued = pendingOutputRef.current.splice(0);
      setQueuedChunks(0);
      for (const item of queued) {
        xtermRef.current?.write(item.data, () => {
          if (id) terminal?.ack(id, item.bytes);
        });
      }
    } else {
      pausedRef.current = true;
      setPaused(true);
    }
  };

  const handleCopy = () => {
    const term = xtermRef.current;
    if (!term) return;
    const text = term.getSelection() || term.getPlainText();
    if (!text) return;
    onCopyText?.(text);
    setCopied(true);
  };

  const handleFind = (backward = false) => {
    const term = xtermRef.current;
    if (!term || !query) return;
    setSearchResult(backward ? term.findPrevious() : term.findNext());
  };

  const shellUnavailable =
    !readOnly && state === 'disconnected' && SHELL_UNAVAILABLE_RE.test(error);
  const statusLabel =
    state === 'connecting'
      ? 'Connecting via Haus Direct IPC · E2EE…'
      : [
          demo ? (readOnly ? 'Demo live logs' : 'Demo xterm PTY') : 'Haus Direct IPC · E2EE',
          relayed ? 'Relayed' : null,
          hostname ?? null,
          paused ? `Paused${queuedChunks > 0 ? ` (+${queuedChunks})` : ''}` : null,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <Stack gapPx={8} style={{ layout: { width: pct(100) } }}>
      {searchOpen && !shellUnavailable && (
        <TerminalSearchBar
          open={searchOpen}
          query={query}
          onQueryChange={setQuery}
          options={searchOptions}
          onOptionsChange={setSearchOptions}
          result={searchResult}
          error={searchResult.error}
          onFind={handleFind}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {hostKey && (
        <GpuiTerminalHostKeyBanner
          hostKey={hostKey}
          onTrust={(fingerprint) => {
            setTrustFingerprint(fingerprint);
            setHostKey(undefined);
            setReconnectSeq((n) => n + 1);
          }}
          onDismiss={() => {
            setHostKey(undefined);
            if (sessionIdRef.current && terminal) terminal.close(sessionIdRef.current);
          }}
        />
      )}

      {error && !shellUnavailable && (
        <Box
          role="status"
          style={{
            layout: { width: pct(100), padding: insets(8, 12) },
            material: new SolidMaterial(rgba(239, 68, 68, 0.12)),
            border: { width: 1, color: rgba(239, 68, 68, 0.3) },
            corners: corners(10),
          }}
        >
          <Text size={12} tone="critical">
            {error}
          </Text>
        </Box>
      )}

      {shellUnavailable ? (
        <Stack
          align="center"
          justify="center"
          gapPx={10}
          style={{
            layout: { width: pct(100), minHeight: px(260), padding: insets(24) },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(14),
          }}
        >
          <UiIcon name="terminal" size={28} />
          <Heading level={3} size={16} weight={600}>
            No shell in this container
          </Heading>
          <Text size={12.5} tone="muted">
            {error}
          </Text>
          {onSwitchToLogs && (
            <HausButton
              id="console-switch-to-logs"
              variant="secondary"
              size="sm"
              onPress={onSwitchToLogs}
            >
              <UiIcon name="file-text" size={14} />
              <Text size={12.5}>Open Live logs</Text>
            </HausButton>
          )}
        </Stack>
      ) : (
        <Box
          style={{
            layout: { width: pct(100), overflow: 'hidden' },
            material: new SolidMaterial(
              theme.mode === 'dark' ? rgba(0, 0, 0, 1) : rgba(255, 255, 255, 1),
            ),
            border: { width: 1, color: colorToken('border') },
            corners: corners(14),
          }}
        >
          <GpuiXtermTerminal
            key={`${serverId}:${targetKey}`}
            id="server-terminal-xterm"
            terminalRef={xtermRef}
            readOnly={readOnly}
            convertEol={readOnly}
            autoFocus={!readOnly}
            onData={handleTerminalData}
            onResize={handleResize}
            onOpenSearch={() => setSearchOpen(true)}
            onCopyText={onCopyText}
            style={{ height: heightPx, borderRadius: 13 }}
          />
        </Box>
      )}

      {!shellUnavailable && (
        <GpuiTerminalFooter
          state={state}
          statusLabel={statusLabel}
          geometry={geometry}
          readOnly={readOnly}
          paused={paused}
          copied={copied}
          onTogglePause={togglePause}
          onSwitchToLogs={onSwitchToLogs}
          onCopy={handleCopy}
          onClear={() => xtermRef.current?.clear()}
          onReconnect={() => {
            reconnectAttemptsRef.current = 0;
            setReconnectSeq((n) => n + 1);
          }}
          onToggleSearch={() => setSearchOpen((prev) => !prev)}
        />
      )}
    </Stack>
  );
}
