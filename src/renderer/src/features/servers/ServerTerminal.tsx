import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { ArrowDown, ArrowUp, Search, ShieldCheck, X } from 'lucide-react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import type { ServerSshInput } from '../../../../shared/terminal';
import type { HomeServer } from './types';

type Connection = 'idle' | 'connecting' | 'connected' | 'disconnected';
const defaultHost = (server: HomeServer) => {
  try {
    return new URL(server.url || '').hostname.replace(/^\[|\]$/g, '');
  } catch {
    return server.host?.hostname || '';
  }
};
function terminalTheme(): ITheme {
  const dark =
    document.documentElement.classList.contains('dark') ||
    document.documentElement.dataset.theme === 'dark';
  return {
    background: dark ? '#000000' : '#ffffff',
    foreground: dark ? '#ffffff' : '#161616',
    cursor: dark ? '#ffffff' : '#111111',
    cursorAccent: dark ? '#000000' : '#ffffff',
    selectionBackground: dark ? '#ffffff35' : '#00000025',
    black: dark ? '#242424' : '#171717',
    brightBlack: '#808080',
    red: dark ? '#ff4245' : '#ff383c',
    brightRed: '#ff696b',
    green: '#34c759',
    brightGreen: '#6cdb89',
    yellow: dark ? '#ffd600' : '#b88600',
    brightYellow: '#ffe572',
    blue: '#369aff',
    brightBlue: '#69b6ff',
    magenta: '#ca71f0',
    brightMagenta: '#e49dff',
    cyan: '#5ac8fa',
    brightCyan: '#92dcff',
    white: dark ? '#e5e5e5' : '#555555',
    brightWhite: dark ? '#ffffff' : '#111111',
  };
}
export function ServerTerminal({ server, active }: { server: HomeServer; active: boolean }) {
  const native = typeof window === 'undefined' ? undefined : window.hausNative;
  const [profile, setProfile] = useState<ServerSshInput>({
    serverId: server.id,
    host: defaultHost(server),
    port: 22,
    username: '',
    environment: 'native',
    auth: 'password',
    rememberPassword: true,
  });
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const [state, setState] = useState<Connection>('idle');
  const stateRef = useRef(state);
  stateRef.current = state;
  const [configured, setConfigured] = useState(false);
  const [editing, setEditing] = useState(true);
  const [loaded, setLoaded] = useState(false);
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
  const [searchOptions, setSearchOptions] = useState({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  const [searchResult, setSearchResult] = useState({ resultIndex: -1, resultCount: 0 });
  const searchInput = useRef<HTMLInputElement>(null);
  const inputQueue = useRef(Promise.resolve());
  useEffect(() => {
    if (!active) {
      attempted.current = false;
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
  }, [server.id, native, active]);

  const connect = async (fingerprint?: string) => {
    const term = terminal.current;
    if (!term || !native?.serverTerminalOpen) return;
    clearTimeout(reconnectTimer.current);
    reconnectTimer.current = undefined;
    setState('connecting');
    stateRef.current = 'connecting';
    if (!(await settledFit.current()) || terminal.current !== term) {
      setState('idle');
      return;
    }
    if (term.cols < 2 || term.rows < 1 || !container.current?.clientWidth) return;
    const old = sessionId.current;
    if (old) await native.serverTerminalClose(old).catch(() => {});
    if (terminal.current !== term || !activeRef.current) return;
    const id = crypto.randomUUID();
    sessionId.current = id;
    exited.current = false;
    notified.current = undefined;
    setError('');
    setHostKey(undefined);
    setState('connecting');
    try {
      await native.serverTerminalOpen({
        sessionId: id,
        profile: profileRef.current,
        cols: term.cols,
        rows: term.rows,
        ...(fingerprint ? { trustFingerprint: fingerprint } : {}),
      });
    } catch (failure) {
      setState('disconnected');
      setError(
        failure instanceof Error
          ? failure.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
          : 'Could not open the SSH terminal.',
      );
    }
  };
  const connectRef = useRef(connect);
  connectRef.current = connect;
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
    const term = new Terminal({
      allowProposedApi: true,
      allowTransparency: false,
      convertEol: false,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 3000,
      theme: terminalTheme(),
      drawBoldTextInBrightColors: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(node);
    terminal.current = term;
    const search = new SearchAddon({ highlightLimit: 1000 });
    term.loadAddon(search);
    searchAddon.current = search;
    const searchResults = search.onDidChangeResults(setSearchResult);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault();
        if (/^https?:\/\//i.test(uri)) void native?.openExternal(uri).catch(() => {});
      }),
    );
    term.attachCustomKeyEventHandler((event) => {
      const command = /Mac/.test(navigator.platform) ? event.metaKey : event.ctrlKey;
      if (event.type === 'keydown' && command && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInput.current?.focus());
        return false;
      }
      if (
        event.type === 'keydown' &&
        command &&
        event.key.toLowerCase() === 'c' &&
        term.hasSelection()
      ) {
        event.preventDefault();
        void navigator.clipboard.writeText(term.getSelection());
        return false;
      }
      if (event.type === 'keydown' && event.metaKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        term.clear();
        return false;
      }
      return true;
    });
    let disposed = false,
      frame = 0,
      fontReady = false;
    let lastWidth = -1,
      lastHeight = -1;
    const applyFit = () => {
      if (
        disposed ||
        !activeRef.current ||
        !fontReady ||
        node.clientWidth < 32 ||
        node.clientHeight < 32
      )
        return;
      const proposed = fit.proposeDimensions();
      if (!proposed || proposed.cols < 2 || proposed.rows < 1) return;
      const cols = Math.min(500, proposed.cols),
        rows = Math.min(300, Math.max(1, proposed.rows - 1));
      if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows);
      setGeometry((current) =>
        current.cols === cols && current.rows === rows ? current : { cols, rows },
      );
    };
    const settle = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed || !activeRef.current) return;
        const width = node.clientWidth,
          height = node.clientHeight;
        if (width < 32 || height < 32) return;
        if (width !== lastWidth || height !== lastHeight) {
          lastWidth = width;
          lastHeight = height;
          settle();
          return;
        }
        applyFit();
      });
    };
    fitting.current = applyFit;
    settledFit.current = async () => {
      await document.fonts.ready;
      let width = -1,
        height = -1;
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (disposed || !activeRef.current) return false;
        if (
          node.clientWidth >= 32 &&
          node.clientHeight >= 32 &&
          node.clientWidth === width &&
          node.clientHeight === height
        ) {
          fontReady = true;
          applyFit();
          return true;
        }
        width = node.clientWidth;
        height = node.clientHeight;
      }
      return false;
    };
    const observer = new ResizeObserver(settle);
    observer.observe(node);
    void document.fonts.ready.then(() => {
      if (!disposed) {
        fontReady = true;
        settle();
      }
    });
    const theme = new MutationObserver(() => {
      term.options.theme = terminalTheme();
      settle();
    });
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
    document.fonts.addEventListener('loadingdone', settle);
    window.addEventListener('resize', settle);
    const input = term.onData((data) => {
      const id = sessionId.current;
      if (stateRef.current !== 'connected') {
        if (data === '\r' && stateRef.current !== 'connecting' && profileRef.current.username) {
          reconnectAttempts.current = 0;
          void connectRef.current();
        }
        return;
      }
      if (!id || !native) return;
      inputQueue.current = inputQueue.current
        .then(() => native.serverTerminalWrite(id, data))
        .catch(() => {
          if (sessionId.current !== id) return;
          setState('disconnected');
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
      if (event.type === 'data')
        term.write(event.data, () => native.serverTerminalAck(event.sessionId, event.bytes));
      else if (event.type === 'host-key') {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = undefined;
        setHostKey(event);
        setState('disconnected');
      } else if (event.type === 'status') {
        setState(event.state);
        stateRef.current = event.state;
        if (event.message) setError(event.message);
        if (event.state === 'connected') {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = undefined;
          reconnectAttempts.current = 0;
          setEditing(false);
          setConfigured(true);
          setProfile((p) => (p.rememberPassword ? { ...p, password: undefined } : p));
          applyFit();
          void native.serverTerminalResize(event.sessionId, term.cols, term.rows).catch(() => {});
          if (activeRef.current) term.focus();
        } else if (
          event.state === 'disconnected' &&
          !exited.current &&
          notified.current !== event.sessionId
        ) {
          notified.current = event.sessionId;
          if (/authentication/i.test(event.message ?? '')) {
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
        term.writeln('\r\n\x1b[33mSession ended. Press Enter to reconnect.\x1b[0m');
      }
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      theme.disconnect();
      window.removeEventListener('resize', settle);
      document.fonts.removeEventListener('loadingdone', settle);
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = undefined;
      input.dispose();
      resize.dispose();
      searchResults.dispose();
      searchAddon.current = null;
      stopEvents?.();
      const id = sessionId.current;
      sessionId.current = undefined;
      if (id) void native?.serverTerminalClose(id).catch(() => {});
      fitting.current = () => {};
      settledFit.current = async () => false;
      terminal.current = null;
      term.dispose();
    };
  }, [native, server.id]);
  useLayoutEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => fitting.current()));
    return () => cancelAnimationFrame(frame);
  }, [active, editing]);
  useEffect(() => {
    if (
      active &&
      loaded &&
      configured &&
      !editing &&
      state !== 'connected' &&
      state !== 'connecting' &&
      geometry.cols > 0 &&
      geometry.rows > 0 &&
      !attempted.current
    ) {
      attempted.current = true;
      void connectRef.current();
    }
  }, [active, loaded, configured, editing, state, geometry.cols, geometry.rows]);
  const find = (backward = false, incremental = false) => {
    const options = {
      ...searchOptions,
      incremental,
      decorations: {
        matchBackground: '#ff923055',
        matchBorder: '#ff9230',
        matchOverviewRuler: '#ff9230',
        activeMatchBackground: '#ff9230',
        activeMatchBorder: '#ff9230',
        activeMatchColorOverviewRuler: '#ff9230',
      },
    };
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
      <div
        className="server-terminal-search"
        data-open={searchOpen}
        inert={!searchOpen}
        aria-hidden={!searchOpen}
        role="search"
        aria-label="Search terminal output"
      >
        <div className="server-terminal-search-main">
          <Search size={15} />
          <input
            ref={searchInput}
            aria-label="Search terminal output"
            value={query}
            placeholder="Find in terminal"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                find(event.shiftKey);
              }
              if (event.key === 'Escape') {
                setSearchOpen(false);
                terminal.current?.focus();
              }
            }}
          />
          <span>
            {searchResult.resultCount
              ? `${searchResult.resultIndex + 1} / ${searchResult.resultCount}`
              : query
                ? 'No matches'
                : ''}
          </span>
          <button aria-label="Previous match" onClick={() => find(true)}>
            <ArrowUp size={15} />
          </button>
          <button aria-label="Next match" onClick={() => find()}>
            <ArrowDown size={15} />
          </button>
          <button
            aria-label="Close search"
            onClick={() => {
              setSearchOpen(false);
              terminal.current?.focus();
            }}
          >
            <X size={15} />
          </button>
        </div>
        <div className="server-terminal-search-options">
          {(
            [
              ['caseSensitive', 'Aa', 'Match case'],
              ['wholeWord', 'ab', 'Whole word'],
              ['regex', '.*', 'Regular expression'],
            ] as const
          ).map(([key, label, title]) => (
            <button
              key={key}
              title={title}
              aria-label={title}
              aria-pressed={searchOptions[key]}
              onClick={() => setSearchOptions((value) => ({ ...value, [key]: !value[key] }))}
            >
              {label}
            </button>
          ))}
          <span>↵ Next · ⇧↵ Previous · esc Close</span>
        </div>
      </div>
      {editing && (
        <form
          className="server-terminal-settings"
          onSubmit={(event) => {
            event.preventDefault();
            attempted.current = true;
            void connect();
          }}
        >
          <label>
            Host
            <input
              value={profile.host}
              onChange={(event) => change({ host: event.target.value })}
              placeholder="192.168.1.10"
              autoComplete="off"
              required
            />
          </label>
          <label className="server-terminal-port">
            Port
            <input
              type="number"
              min="1"
              max="65535"
              value={profile.port}
              onChange={(event) => change({ port: Number(event.target.value) })}
              required
            />
          </label>
          <label>
            Username
            <input
              value={profile.username}
              onChange={(event) => change({ username: event.target.value })}
              autoComplete="username"
              required
            />
          </label>
          <label>
            Authentication
            <select
              value={profile.auth}
              onChange={(event) => change({ auth: event.target.value as 'password' | 'agent' })}
            >
              <option value="password">Password</option>
              <option value="agent">System SSH agent</option>
            </select>
          </label>
          {profile.auth === 'password' && (
            <label>
              Password
              <input
                type="password"
                value={profile.password ?? ''}
                placeholder={configured ? 'Saved in keychain' : 'SSH password'}
                onChange={(event) => change({ password: event.target.value || undefined })}
                autoComplete="current-password"
              />
            </label>
          )}
          {server.host?.serviceScope === 'wsl' && (
            <label>
              Environment
              <select
                value={profile.environment}
                onChange={(event) =>
                  change({ environment: event.target.value as 'native' | 'wsl' })
                }
              >
                <option value="native">Windows</option>
                <option value="wsl">WSL</option>
              </select>
            </label>
          )}
          <label className="server-terminal-remember">
            <input
              type="checkbox"
              checked={profile.rememberPassword}
              onChange={(event) => change({ rememberPassword: event.target.checked })}
            />
            Save credentials in secure storage
          </label>
          <Button type="submit" variant="secondary" isDisabled={!loaded || state === 'connecting'}>
            Connect
          </Button>
        </form>
      )}
      {hostKey && (
        <div className="server-terminal-host-key">
          <ShieldCheck size={22} />
          <div>
            <strong>
              {hostKey.changed ? 'The server’s SSH key changed' : 'Verify this server'}
            </strong>
            <p>{hostKey.fingerprint}</p>
          </div>
          <Button variant="secondary" onPress={() => void connect(hostKey.fingerprint)}>
            Trust and connect
          </Button>
        </div>
      )}
      {error && editing && (
        <p className="server-terminal-error" role="status">
          {error}
        </p>
      )}
      <div className="server-terminal-canvas" ref={container} />
      <footer className="server-terminal-footer">
        <span>{configured ? `${profile.username}@${profile.host}` : 'Connect over SSH'}</span>
        <div>
          <span>{geometry.cols > 0 ? `${geometry.cols} × ${geometry.rows}` : ''}</span>
          <button
            aria-label="Find in terminal"
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
