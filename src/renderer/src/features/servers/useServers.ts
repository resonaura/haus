import { useCallback, useEffect, useRef, useState } from 'react';
import { serverRequest, type ClusterStatus } from './server-api';
import { appendSample, resourceSample } from './presentation';
import type { ResourceSample, ServersStatus } from './types';

export function useServers(demo: boolean) {
  const [status, setStatus] = useState<ServersStatus>();
  const [cluster, setCluster] = useState<ClusterStatus>();
  const [history, setHistory] = useState<Record<string, ResourceSample[]>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const pending = useRef<Promise<void> | null>(null);
  const generation = useRef(0);
  const mutating = useRef(false);
  const load = useCallback(async () => {
    if (demo) return;
    if (pending.current) return pending.current;
    const started = generation.current;
    const task = (async () => {
      const results = await Promise.allSettled([
        serverRequest<ServersStatus>('GET', '/api/servers'),
        serverRequest<ClusterStatus>('GET', '/api/cluster'),
      ]);
      if (!active.current || started !== generation.current) return;
      const servers = results[0];
      if (servers.status === 'fulfilled') {
        setStatus(servers.value);
        setError('');
        setHistory((previous) =>
          Object.fromEntries(
            servers.value.servers.map((server) => [
              server.id,
              appendSample(previous[server.id] ?? [], resourceSample(server, Date.now())),
            ]),
          ),
        );
      } else {
        setError(
          servers.reason instanceof Error
            ? servers.reason.message
            : 'The helper could not be reached.',
        );
      }
      if (results[1].status === 'fulfilled') setCluster(results[1].value);
    })();
    pending.current = task;
    try {
      await task;
    } finally {
      if (pending.current === task) pending.current = null;
    }
  }, [demo]);
  useEffect(() => {
    active.current = true;
    void load();
    const visible = () => {
      if (document.visibilityState === 'visible' && !mutating.current) void load();
    };
    const timer = setInterval(visible, 5000);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [load]);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    mutating.current = true;
    generation.current += 1;
    setError('');
    try {
      await action();
      await pending.current;
      await load();
    } catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : 'Please try again.');
      throw reason;
    } finally {
      mutating.current = false;
      if (active.current) setBusy(false);
    }
  };
  return { status, cluster, history, error, busy, refresh: load, act };
}
