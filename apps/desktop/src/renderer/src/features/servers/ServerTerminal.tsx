/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { SearchAddon } from '@xterm/addon-search';
import type { ServerSshInput, ServerTerminalTransport } from '../../../../shared/terminal';
import type { HomeServer } from './types';
import { defaultTerminalHost, hostFromServerUrl } from './server-connections';
import {
  TERMINAL_SEARCH_DECORATIONS,
  TerminalSearchBar,
  type TerminalSearchOptions,
} from './terminal/search';
import { SshSettingsForm } from './terminal/ssh-settings';
import { mountXterm } from './terminal/xterm';
import { TerminalFooter, TerminalHostKeyBanner, type HubTerminalMeta } from './terminal/chrome';

type Connection = 'idle' | 'connecting' | 'connected' | 'disconnected';

const NON_RETRYABLE_HUB_ERROR =
  /administrator|disabled|not trusted|could not be verified|not available|integrity|unencrypted|handshake/i;

const defaultSshProfile = (server: HomeServer): ServerSshInput => ({
  serverId: server.id,
  host: defaultTerminalHost(server),
  port: 22,
  username: '',
  environment: 'native',
  auth: 'password',
  rememberPassword: true,
});

export function ServerTerminal({ server, active }: { server: HomeServer; active: boolean }) {
  const native = typeof window === 'undefined' ? undefined : window.hausNative;
  const supportsHubIpc =
    server.kind === 'hub' || server.kind === 'nvr' || Boolean(server.managedId);
  const defaultTransport: ServerTerminalTransport = supportsHubIpc ? 'hub' : 'ssh';
  const hubTargetId = server.managedId ?? server.id;
  const hubTargetIdRef = useRef(hubTargetId);
  hubTargetIdRef.current = hubTargetId;

  const [transportMode, setTransportMode] = useState<ServerTerminalTransport>(defaultTransport);
  const transportRef = useRef(transportMode);
  transportRef.current = transportMode;
  const [hubMeta, setHubMeta] = useState<HubTerminalMeta>();

  const [profile, setProfile] = useState<ServerSshInput>(() => defaultSshProfile(server));
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const [state, setState] = useState<Connection>('idle');
  const stateRef = useRef(state);
  stateRef.current = state;
  const [configured, setConfigured] = useState(false);
  const [editing, setEditing] = useState(!supportsHubIpc);
  const [loaded, setLoaded] = useState(supportsHubIpc);
  const [error, setError] = useState('');
  const [hostKey, setHostKey] = useState<{ fingerprint: string; changed: boolean }>();
  const [geometry, setGeometry] = useState({ cols: 0, rows: 0 });
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal>(null);
  const fitting = useRef<() => void>(() => {});
  const settledFit = useRef<() => Promise<boolean>>(async () => false);
  const sessionId = useRef<string | undefined>(undefined);
  const activeRef = useRef(active);
  activeRef.current = active;
  const attempted = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectAttempts = useRef(0);
  const exited = useRef(false);
  const notified = useRef<string | undefined>(undefined);
  const retry = useRef<() => void>(() => {});
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
  const inputQueue = useRef(Promise.resolve());

  useEffect(() => {
    setTransportMode(defaultTransport);
    transportRef.current = defaultTransport;
    setHubMeta(undefined);
    setConfigured(false);
    setEditing(defaultTransport === 'ssh');
    setLoaded(defaultTransport === 'hub');
    setError('');
    setHostKey(undefined);
    setProfile(defaultSshProfile(server));
  }, [server.id, defaultTransport]);

  useEffect(() => {
    if (!active) {
      attempted.current = false;
      return;
    }
    if (transportMode === 'hub') {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    if (!native?.serverSshProfile) {
      setLoaded(true);
      setError('Restart Haus to enable the terminal connection.');
      return;
    }
    void native
      .serverSshProfile(server.id)
      .then((value) => {
        if (cancelled) return;
        if (value) {
          setProfile({ ...value, rememberPassword: value.hasPassword });
          setConfigured(true);
          setEditing(value.auth === 'password' && !value.hasPassword);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded(true);
          setError('SSH settings could not be loaded.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [server.id, native, active, transportMode]);

  useEffect(() => {
    if (configured) return;
    const urlHost = hostFromServerUrl(server.url);
    const fallbackHost = urlHost || server.host?.hostname || '';
    if (!fallbackHost) return;
    setProfile((current) =>
      !current.host || (urlHost && current.host === server.host?.hostname)
        ? { ...current, host: fallbackHost }
        : current,
    );
  }, [configured, server.url, server.host?.hostname]);

  const connect = async (fingerprint?: string) => {
    const term = terminal.current;
    if (!term || !native?.serverTerminalOpen) return;
    const mode = transportRef.current;
    clearTimeout(reconnectTimer.current);
    reconnectTimer.current = undefined;
    setState('connecting');
    stateRef.current = 'connecting';
    await settledFit.current();
    if (terminal.current !== term || !activeRef.current || transportRef.current !== mode) {
      setState('idle');
      stateRef.current = 'idle';
      return;
    }
    const cols = term.cols >= 2 ? term.cols : 80;
    const rows = term.rows >= 1 ? term.rows : 24;
    const old = sessionId.current;
    if (old) await native.serverTerminalClose(old).catch(() => {});
    if (terminal.current !== term || !activeRef.current || transportRef.current !== mode) return;
    const id = crypto.randomUUID();
    sessionId.current = id;
    exited.current = false;
    notified.current = undefined;
    setError('');
    setHostKey(undefined);
    setHubMeta(undefined);
    setState('connecting');
    try {
      if (mode === 'hub') {
        await native.serverTerminalOpen({
          mode: 'hub',
          sessionId: id,
          serverId: hubTargetIdRef.current,
          cols,
          rows,
          ...(fingerprint ? { trustFingerprint: fingerprint } : {}),
        });
      } else {
        await native.serverTerminalOpen({
          mode: 'ssh',
          sessionId: id,
          profile: profileRef.current,
          cols,
          rows,
          ...(fingerprint ? { trustFingerprint: fingerprint } : {}),
        });
      }
    } catch (failure) {
      setState('disconnected');
      stateRef.current = 'disconnected';
      setError(
        failure instanceof Error
          ? failure.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
          : mode === 'hub'
            ? 'Could not open the secure Hub terminal.'
            : 'Could not open the SSH terminal.',
      );
    }
  };
  const connectRef = useRef(connect);
  connectRef.current = connect;

  const switchTransport = (next: ServerTerminalTransport) => {
    if (next === transportRef.current) return;
    clearTimeout(reconnectTimer.current);
    reconnectTimer.current = undefined;
    const old = sessionId.current;
    sessionId.current = undefined;
    if (old) void native?.serverTerminalClose(old).catch(() => {});
    attempted.current = false;
    exited.current = false;
    reconnectAttempts.current = 0;
    notified.current = undefined;
    setError('');
    setHostKey(undefined);
    setHubMeta(undefined);
    setState('idle');
    stateRef.current = 'idle';
    transportRef.current = next;
    setTransportMode(next);
    setEditing(next === 'ssh' && !configured);
    terminal.current?.reset();
  };

  retry.current = () => {
    if (!activeRef.current || exited.current || reconnectTimer.current) return;
    if (reconnectAttempts.current >= 5) {
      terminal.current?.writeln(
        '\r\n\x1b[33mCould not reconnect. Press Enter to try again.\x1b[0m',
      );
      return;
    }
    const delay = Math.min(15000, 1000 * 2 ** reconnectAttempts.current++);
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = undefined;
      void connectRef.current();
    }, delay);
  };

  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    setState('idle');
    stateRef.current = 'idle';
    attempted.current = false;
    let disposed = false;
    const mounted = mountXterm({
      node,
      isActive: () => activeRef.current,
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
      const id = sessionId.current;
      if (stateRef.current !== 'connected') {
        const canReconnect = transportRef.current === 'hub' || Boolean(profileRef.current.username);
        if (data === '\r' && stateRef.current !== 'connecting' && canReconnect) {
          reconnectAttempts.current = 0;
          void connectRef.current();
        }
        return;
      }
      if (!id || !native) return;
      if (native.serverTerminalInput) {
        native.serverTerminalInput(id, data);
        return;
      }
      inputQueue.current = inputQueue.current
        .then(() => native.serverTerminalWrite(id, data))
        .catch(() => {
          if (sessionId.current !== id) return;
          setState('disconnected');
          stateRef.current = 'disconnected';
          retry.current();
        });
    });
    const resize = term.onResize(({ cols, rows }) => {
      const id = sessionId.current;
      if (id && stateRef.current === 'connected')
        void native?.serverTerminalResize(id, cols, rows).catch(() => {});
    });
    const stopEvents = native?.onServerTerminal?.((event) => {
      if (event.sessionId !== sessionId.current || disposed) return;
      if (event.type === 'data') {
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
          if (event.transport === 'hub' || transportRef.current === 'hub') {
            setHubMeta({
              scope: event.scope,
              hostname: event.hostname,
              shell: event.shell,
              relayed: event.relayed,
            });
          } else {
            setEditing(false);
            setConfigured(true);
            setProfile((p) => (p.rememberPassword ? { ...p, password: undefined } : p));
          }
          applyFit();
          void native.serverTerminalResize(event.sessionId, term.cols, term.rows).catch(() => {});
          if (activeRef.current) term.focus();
        } else if (
          event.state === 'disconnected' &&
          !exited.current &&
          notified.current !== event.sessionId
        ) {
          notified.current = event.sessionId;
          if (transportRef.current === 'hub') {
            if (NON_RETRYABLE_HUB_ERROR.test(event.message ?? '')) {
              term.writeln(
                `\r\n\x1b[33m${event.message ?? 'Terminal rejected.'} Press Enter to retry.\x1b[0m`,
              );
            } else {
              term.writeln('\r\n\x1b[33mSecure Hub channel closed. Reconnecting…\x1b[0m');
              retry.current();
            }
          } else if (/authentication/i.test(event.message ?? '')) {
            term.writeln(
              '\r\n\x1b[33mAuthentication failed. Update SSH credentials to reconnect.\x1b[0m',
            );
            setEditing(true);
          } else {
            term.writeln('\r\n\x1b[33mConnection lost. Reconnecting…\x1b[0m');
            retry.current();
          }
        }
      } else if (event.type === 'exit') {
        exited.current = true;
        setState('disconnected');
        stateRef.current = 'disconnected';
        term.writeln('\r\n\x1b[33mSession ended. Press Enter to reconnect.\x1b[0m');
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
  }, [native, server.id]);

  useLayoutEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => fitting.current()));
    return () => cancelAnimationFrame(frame);
  }, [active, editing, transportMode]);

  useEffect(() => {
    if (!active || state === 'connected' || state === 'connecting' || attempted.current) return;
    if (transportMode === 'hub') {
      attempted.current = true;
      void connectRef.current();
    } else if (loaded && configured && !editing && profileRef.current.serverId === server.id) {
      attempted.current = true;
      void connectRef.current();
    }
  }, [active, loaded, configured, editing, state, transportMode, server.id]);

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

  const change = (patch: Partial<ServerSshInput>) =>
    setProfile((current) => ({ ...current, ...patch }));

  return (
    <section className="server-terminal-page" aria-label="Server terminal">
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
          terminal.current?.focus();
        }}
      />
      {transportMode === 'ssh' && editing && (
        <SshSettingsForm
          profile={profile}
          configured={configured}
          showWslEnvironment={server.host?.serviceScope === 'wsl'}
          loaded={loaded}
          connecting={state === 'connecting'}
          onChange={change}
          onSubmit={() => {
            attempted.current = true;
            void connect();
          }}
        />
      )}
      {hostKey && (
        <TerminalHostKeyBanner
          transportMode={transportMode}
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
      <TerminalFooter
        transportMode={transportMode}
        supportsHubIpc={supportsHubIpc}
        connecting={state === 'connecting'}
        hubMeta={hubMeta}
        sshConfigured={configured}
        sshUsername={profile.username}
        sshHost={profile.host}
        geometry={geometry}
        editingSsh={editing}
        onSwitchTransport={switchTransport}
        onToggleSshSettings={() => setEditing((open) => !open)}
        onOpenSearch={() => {
          setSearchOpen(true);
          requestAnimationFrame(() => searchInput.current?.focus());
        }}
      />
    </section>
  );
}
