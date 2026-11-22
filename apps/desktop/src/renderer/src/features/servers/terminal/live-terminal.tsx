/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import type { Terminal } from '@xterm/xterm';
import type { SearchAddon } from '@xterm/addon-search';
import { isReadOnlyTerminalTarget, type TerminalTarget } from '@haus/core/protocol';
import { mountXterm } from './xterm';
import {
  TERMINAL_SEARCH_DECORATIONS,
  TerminalSearchBar,
  type TerminalSearchOptions,
} from './search';
import { TerminalHostKeyBanner, type HubTerminalMeta } from './chrome';

type Connection = 'idle' | 'connecting' | 'connected' | 'disconnected';

const NON_RETRYABLE_ERROR =
  /administrator|disabled|not trusted|could not be verified|not available|integrity|invalid encrypted|handshake|not found|Start this Docker|host with journalctl|container-backed/i;

export interface LiveTerminalProps {
  readonly serverId: string;
  readonly target: TerminalTarget;
  readonly active: boolean;
  readonly className?: string;
}

/**
 * Reusable ANSI-color xterm.js terminal and live-log viewer backed by Haus Direct Binary E2EE IPC.
 * Used for Hub live logs, Docker container logs/exec, host service logs, and App logs/exec.
 */
export function LiveTerminal({ serverId, target, active, className = '' }: LiveTerminalProps) {
  const native = typeof window === 'undefined' ? undefined : window.hausNative;
  const readOnly = isReadOnlyTerminalTarget(target);
  const targetKey = JSON.stringify(target);
  const targetRef = useRef(target);
  targetRef.current = target;

  const [state, setState] = useState<Connection>('idle');
  const stateRef = useRef(state);
  stateRef.current = state;
  const [hubMeta, setHubMeta] = useState<HubTerminalMeta>();
  const [error, setError] = useState('');
  const [hostKey, setHostKey] = useState<{ fingerprint: string; changed: boolean }>();
  const [geometry, setGeometry] = useState({ cols: 0, rows: 0 });
  const [paused, setPaused] = useState(false);
  const [queuedChunks, setQueuedChunks] = useState(0);

  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal>(null);
  const fitting = useRef<() => void>(() => {});
  const settledFit = useRef<() => Promise<boolean>>(async () => false);
  const sessionId = useRef<string | undefined>(undefined);
  const activeRef = useRef(active);
  activeRef.current = active;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const pendingOutput = useRef<Array<{ data: string | Uint8Array; bytes: number }>>([]);
  const attempted = useRef(false);
  const exited = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectAttempts = useRef(0);
  const searchAddon = useRef<SearchAddon | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOptions, setSearchOptions] = useState<TerminalSearchOptions>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  const [searchResult, setSearchResult] = useState({ resultIndex: -1, resultCount: 0 });
  const searchInput = useRef<HTMLInputElement>(null);

  const connect = async (fingerprint?: string) => {
    const term = terminal.current;
    if (!term || !native?.serverTerminalOpen) {
      setError('Restart Haus to enable direct Hub terminal & log streaming.');
      return;
    }
    clearTimeout(reconnectTimer.current);
    reconnectTimer.current = undefined;
    setState('connecting');
    stateRef.current = 'connecting';
    await settledFit.current();
    if (terminal.current !== term || !activeRef.current) {
      setState('idle');
      stateRef.current = 'idle';
      return;
    }
    const cols = term.cols >= 2 ? term.cols : 100;
    const rows = term.rows >= 1 ? term.rows : 28;
    const old = sessionId.current;
    if (old) await native.serverTerminalClose(old).catch(() => {});
    if (terminal.current !== term || !activeRef.current) return;
    const id = crypto.randomUUID();
    sessionId.current = id;
    exited.current = false;
    pendingOutput.current = [];
    setQueuedChunks(0);
    setError('');
    setHostKey(undefined);
    setHubMeta(undefined);
    setState('connecting');
    try {
      await native.serverTerminalOpen({
        mode: 'hub',
        sessionId: id,
        serverId,
        target: targetRef.current,
        cols,
        rows,
        ...(fingerprint ? { trustFingerprint: fingerprint } : {}),
      });
    } catch (failure) {
      setState('disconnected');
      stateRef.current = 'disconnected';
      setError(
        failure instanceof Error
          ? failure.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
          : 'Could not open the direct Hub stream.',
      );
    }
  };
  const connectRef = useRef(connect);
  connectRef.current = connect;

  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    setState('idle');
    stateRef.current = 'idle';
    attempted.current = false;
    setPaused(false);
    pausedRef.current = false;
    pendingOutput.current = [];
    setQueuedChunks(0);

    let disposed = false;
    const mounted = mountXterm({
      node,
      isActive: () => activeRef.current,
      readOnly,
      onGeometry: (next) =>
        setGeometry((current) =>
          current.cols === next.cols && current.rows === next.rows ? current : next,
        ),
      onSearchResult: setSearchResult,
      onOpenSearch: () => {
        setSearchOpen(true);
        requestAnimationFrame(() => searchInput.current?.focus());
      },
      onOpenLink: (uri) => {
        void native?.openExternal(uri).catch(() => {});
      },
    });
    const { term, applyFit } = mounted;
    terminal.current = term;
    searchAddon.current = mounted.search;
    fitting.current = applyFit;
    settledFit.current = mounted.settledFit;

    const input = term.onData((data) => {
      if (readOnly) return;
      const id = sessionId.current;
      if (stateRef.current !== 'connected') {
        if (data === '\r' && stateRef.current !== 'connecting') {
          reconnectAttempts.current = 0;
          void connectRef.current();
        }
        return;
      }
      if (!id || !native) return;
      if (native.serverTerminalInput) native.serverTerminalInput(id, data);
      else void native.serverTerminalWrite(id, data).catch(() => {});
    });

    const resize = term.onResize(({ cols, rows }) => {
      const id = sessionId.current;
      if (!readOnly && id && stateRef.current === 'connected') {
        void native?.serverTerminalResize(id, cols, rows).catch(() => {});
      }
    });

    const stopEvents = native?.onServerTerminal?.((event) => {
      if (event.sessionId !== sessionId.current || disposed) return;
      if (event.type === 'data') {
        if (pausedRef.current) {
          pendingOutput.current.push({ data: event.data, bytes: event.bytes });
          if (pendingOutput.current.length > 400) {
            const dropped = pendingOutput.current.shift();
            if (dropped) native.serverTerminalAck(event.sessionId, dropped.bytes);
          }
          setQueuedChunks(pendingOutput.current.length);
          return;
        }
        term.write(event.data, () => native.serverTerminalAck(event.sessionId, event.bytes));
      } else if (event.type === 'host-key') {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = undefined;
        setHostKey(event);
        setState('disconnected');
        stateRef.current = 'disconnected';
      } else if (event.type === 'status') {
        setState(event.state);
        stateRef.current = event.state;
        if (event.message) setError(event.message);
        if (event.state === 'connected') {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = undefined;
          reconnectAttempts.current = 0;
          setHubMeta({
            scope: event.scope,
            hostname: event.hostname,
            shell: event.shell,
            relayed: event.relayed,
          });
          applyFit();
          if (!readOnly) {
            void native.serverTerminalResize(event.sessionId, term.cols, term.rows).catch(() => {});
            if (activeRef.current) term.focus();
          }
        } else if (event.state === 'disconnected' && !exited.current) {
          if (NON_RETRYABLE_ERROR.test(event.message ?? '')) {
            return;
          }
          if (reconnectAttempts.current < 5 && activeRef.current) {
            const delay = Math.min(15_000, 1000 * 2 ** reconnectAttempts.current++);
            reconnectTimer.current = setTimeout(() => {
              reconnectTimer.current = undefined;
              void connectRef.current();
            }, delay);
          }
        }
      } else if (event.type === 'exit') {
        exited.current = true;
        setState('disconnected');
        stateRef.current = 'disconnected';
        term.writeln(
          readOnly
            ? '\r\n\x1b[2mStream ended.\x1b[0m'
            : '\r\n\x1b[33mSession ended. Press Enter to reconnect.\x1b[0m',
        );
      }
    });

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = undefined;
      input.dispose();
      resize.dispose();
      searchAddon.current = null;
      stopEvents?.();
      const id = sessionId.current;
      sessionId.current = undefined;
      if (id) void native?.serverTerminalClose(id).catch(() => {});
      fitting.current = () => {};
      settledFit.current = async () => false;
      terminal.current = null;
      mounted.dispose();
    };
  }, [native, serverId, targetKey, readOnly]);

  useLayoutEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => fitting.current()));
    return () => cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    if (!active || state === 'connected' || state === 'connecting' || attempted.current) return;
    attempted.current = true;
    void connectRef.current();
  }, [active, state, serverId, targetKey]);

  const togglePause = () => {
    if (pausedRef.current) {
      pausedRef.current = false;
      setPaused(false);
      const id = sessionId.current;
      const queued = pendingOutput.current.splice(0);
      setQueuedChunks(0);
      for (const item of queued) {
        terminal.current?.write(item.data, () => {
          if (id) native?.serverTerminalAck(id, item.bytes);
        });
      }
    } else {
      pausedRef.current = true;
      setPaused(true);
    }
  };

  const reconnect = () => {
    reconnectAttempts.current = 0;
    terminal.current?.reset();
    void connect();
  };

  const find = (backward = false, incremental = false) => {
    const options = { ...searchOptions, incremental, decorations: TERMINAL_SEARCH_DECORATIONS };
    try {
      if (backward) searchAddon.current?.findPrevious(query, options);
      else searchAddon.current?.findNext(query, options);
    } catch {
      setSearchResult({ resultIndex: -1, resultCount: 0 });
    }
  };

  useEffect(() => {
    if (query && searchOpen) find(false, true);
    else {
      searchAddon.current?.clearDecorations();
      setSearchResult({ resultIndex: -1, resultCount: 0 });
    }
  }, [query, searchOptions, searchOpen]);

  const statusLabel =
    state === 'connecting'
      ? 'Connecting via Haus Direct IPC · E2EE…'
      : [
          'Haus Direct IPC · E2EE',
          hubMeta?.relayed ? 'Relayed' : null,
          hubMeta?.hostname ?? null,
          paused ? `Paused${queuedChunks > 0 ? ` (+${queuedChunks})` : ''}` : null,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <section
      className={`server-terminal-page ${readOnly ? 'is-live-logs' : ''} ${className}`.trim()}
      aria-label={readOnly ? 'Live color logs' : 'Interactive terminal'}
    >
      <TerminalSearchBar
        open={searchOpen}
        query={query}
        onQueryChange={setQuery}
        options={searchOptions}
        onOptionsChange={setSearchOptions}
        result={searchResult}
        inputRef={searchInput}
        onFind={(backward) => find(backward)}
        onClose={() => {
          setSearchOpen(false);
          if (!readOnly) terminal.current?.focus();
        }}
      />
      {hostKey && (
        <TerminalHostKeyBanner
          transportMode="hub"
          hostKey={hostKey}
          onTrust={() => void connect(hostKey.fingerprint)}
        />
      )}
      {error && (
        <p className="server-terminal-error" role="status">
          {error}
        </p>
      )}
      <div className="server-terminal-canvas" ref={container} />
      <footer className="server-terminal-footer">
        <span className="server-terminal-transport-badge">
          <ShieldCheck size={13} />
          {statusLabel}
        </span>
        <div>
          <span>{geometry.cols > 0 ? `${geometry.cols} × ${geometry.rows}` : ''}</span>
          {readOnly && (
            <button
              type="button"
              aria-label={paused ? 'Resume live output' : 'Pause live output'}
              title={paused ? 'Resume live output' : 'Pause live output'}
              onClick={togglePause}
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
            </button>
          )}
          <button
            type="button"
            aria-label="Clear output"
            title="Clear output"
            onClick={() => terminal.current?.clear()}
          >
            <Trash2 size={14} />
          </button>
          <button type="button" aria-label="Reconnect" title="Reconnect" onClick={reconnect}>
            <RotateCw size={14} />
          </button>
          <button
            type="button"
            aria-label="Find in output"
            title="Find (⌘F)"
            onClick={() => {
              setSearchOpen(true);
              requestAnimationFrame(() => searchInput.current?.focus());
            }}
          >
            <Search size={14} />
          </button>
        </div>
      </footer>
    </section>
  );
}
