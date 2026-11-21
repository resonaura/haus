/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { ArrowDown, Check, Copy, Pause, Play, RotateCw, Trash2 } from 'lucide-react';
import { appRequest, record } from './api';

const MAX_RENDER_LINES = 2000;

interface LogStreamEvent {
  readonly kind?: string;
  readonly line?: string;
  readonly status?: string;
  readonly error?: string;
}

export function AppLiveLogs({
  appId,
  appState,
}: {
  readonly appId: string;
  readonly appState: string;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<'connecting' | 'live' | 'ended' | 'error'>('connecting');
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [filter, setFilter] = useState('');
  const [pinned, setPinned] = useState(true);
  const [copied, setCopied] = useState(false);
  const [streamEpoch, setStreamEpoch] = useState(0);

  const pausedRef = useRef(false);
  const queuedRef = useRef<string[]>([]);
  const preRef = useRef<HTMLPreElement | null>(null);
  const pinnedRef = useRef(true);

  pausedRef.current = paused;
  pinnedRef.current = pinned;

  const appendLines = useCallback((incoming: readonly string[]) => {
    if (incoming.length === 0) return;
    setLines((prev) => {
      const next =
        prev.length + incoming.length > MAX_RENDER_LINES
          ? [...prev, ...incoming].slice(-MAX_RENDER_LINES)
          : [...prev, ...incoming];
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    setStatus('connecting');
    setError('');
    setLines([]);
    queuedRef.current = [];
    setQueuedCount(0);

    const loadFallbackSnapshot = async () => {
      try {
        const res = await appRequest('POST', `apps/${encodeURIComponent(appId)}/operate`, {
          operation: 'logs',
          options: { tail: 200 },
        });
        if (
          !cancelled &&
          record(res) &&
          res.status === 'ok' &&
          record(res.data) &&
          Array.isArray(res.data.lines)
        ) {
          const snapshotLines = res.data.lines.filter(
            (item): item is string => typeof item === 'string',
          );
          setLines(snapshotLines.slice(-MAX_RENDER_LINES));
          setStatus('ended');
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setError(err instanceof Error ? err.message : 'Logs are unavailable for this App.');
        }
      }
    };

    if (typeof window.hausNative?.subscribe === 'function') {
      void window.hausNative
        .subscribe<LogStreamEvent>({ type: 'apps/logs', appId, tail: 200 }, (event) => {
          if (cancelled || !event || typeof event !== 'object') return;
          if (event.kind === 'log' && typeof event.line === 'string') {
            setStatus('live');
            if (pausedRef.current) {
              queuedRef.current.push(event.line);
              if (queuedRef.current.length > MAX_RENDER_LINES) {
                queuedRef.current.splice(0, queuedRef.current.length - MAX_RENDER_LINES);
              }
              setQueuedCount(queuedRef.current.length);
            } else {
              appendLines([event.line]);
            }
          } else if (event.kind === 'status') {
            if (event.status === 'connected') setStatus('live');
            else if (event.status === 'ended') setStatus('ended');
          } else if (event.kind === 'error') {
            setError(event.error ?? 'Log stream interrupted.');
            setStatus('error');
          }
        })
        .then((unsub) => {
          if (cancelled) unsub();
          else unsubscribe = unsub;
        })
        .catch(() => {
          if (!cancelled) void loadFallbackSnapshot();
        });
    } else {
      void loadFallbackSnapshot();
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [appId, appState, streamEpoch, appendLines]);

  const visibleLines = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return lines;
    return lines.filter((line) => line.toLowerCase().includes(query));
  }, [lines, filter]);

  useEffect(() => {
    if (!pinnedRef.current || paused) return;
    const node = preRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [visibleLines, paused]);

  const togglePause = () => {
    if (paused) {
      const pending = queuedRef.current;
      queuedRef.current = [];
      setQueuedCount(0);
      setPaused(false);
      if (pending.length > 0) appendLines(pending);
    } else {
      setPaused(true);
    }
  };

  const handleScroll = () => {
    const node = preRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 28;
    if (nearBottom !== pinnedRef.current) setPinned(nearBottom);
  };

  const jumpToBottom = () => {
    setPinned(true);
    const node = preRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  };

  const copyLogs = () => {
    void navigator.clipboard
      ?.writeText(visibleLines.join('\n'))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  const statusLabel = paused
    ? queuedCount > 0
      ? `Paused (+${queuedCount})`
      : 'Paused'
    : status === 'live'
      ? 'Live'
      : status === 'connecting'
        ? 'Connecting…'
        : status === 'error'
          ? 'Disconnected'
          : 'Stream ended';

  return (
    <div className="native-app-live-logs">
      <div className="native-app-logs-toolbar">
        <span className={`native-app-logs-status is-${paused ? 'paused' : status}`}>
          <i aria-hidden="true" />
          {statusLabel}
        </span>
        <input
          type="search"
          className="native-app-logs-filter"
          placeholder="Filter logs…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter logs"
        />
        <div className="native-app-logs-controls">
          <Button size="sm" variant="ghost" onPress={togglePause}>
            {paused ? <Play size={14} /> : <Pause size={14} />}
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button size="sm" variant="ghost" onPress={() => setStreamEpoch((n) => n + 1)}>
            <RotateCw size={14} />
            Reconnect
          </Button>
          <Button
            size="sm"
            variant="ghost"
            isDisabled={visibleLines.length === 0}
            onPress={copyLogs}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            isDisabled={lines.length === 0}
            onPress={() => {
              setLines([]);
              queuedRef.current = [];
              setQueuedCount(0);
            }}
          >
            <Trash2 size={14} />
            Clear
          </Button>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <pre ref={preRef} className="native-app-logs is-live" onScroll={handleScroll}>
        {visibleLines.length > 0
          ? visibleLines.join('\n')
          : status === 'connecting'
            ? 'Connecting to live logs…'
            : filter.trim()
              ? 'No log lines match the current filter.'
              : 'Waiting for log output…'}
      </pre>
      {!pinned && !paused && visibleLines.length > 0 && (
        <div className="native-app-row-actions">
          <Button size="sm" variant="secondary" onPress={jumpToBottom}>
            <ArrowDown size={14} />
            Jump to latest
          </Button>
        </div>
      )}
    </div>
  );
}
