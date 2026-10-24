import { useCallback, useEffect, useRef, useState } from 'react';
import { serverRequest, saveThenRefresh, type ClusterStatus } from './server-api';
import { appendSample, resourceSample, statusIsFresh } from './presentation';
import type { ResourceSample, ServersStatus } from './types';
import { serverErrorMessage } from './server-errors';

export function useServers(demo: boolean, enabled = true) {
  const [status, setStatus] = useState<ServersStatus>();
  const [cluster, setCluster] = useState<ClusterStatus>();
  const [history, setHistory] = useState<Record<string, ResourceSample[]>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now);
  const active = useRef(true);
  const pending = useRef<Promise<ServersStatus | undefined> | null>(null);
  const generation = useRef(0);
  const pendingGeneration = useRef(-1);
  const mutating = useRef(false);
  const load = useCallback(async (): Promise<ServersStatus | undefined> => {
    if (demo || !enabled) return;
    const started = generation.current;
    if (pending.current) {
      if (pendingGeneration.current === started) return pending.current;
      await pending.current.catch(() => {});
      if (!active.current || started !== generation.current) return;
      return load();
    }
    pendingGeneration.current = started;
    const task = (async () => {
      const results = await Promise.allSettled([
        serverRequest<ServersStatus>('GET', '/api/servers'),
        serverRequest<ClusterStatus>('GET', '/api/cluster'),
      ]);
      if (!active.current || started !== generation.current) return;
      const servers = results[0];
      if (servers.status === 'fulfilled') {
        const at = Date.now();
        setStatus(servers.value);
        setReceivedAt(at);
        setNow(at);
        setFailed(false);
        setError('');
        setHistory((previous) =>
          Object.fromEntries(
            servers.value.servers.map((server) => [
              server.id,
              appendSample(previous[server.id] ?? [], resourceSample(server, at)),
            ]),
          ),
        );
      } else {
        setFailed(true);
        setError(serverErrorMessage(servers.reason));
      }
      if (results[1].status === 'fulfilled') setCluster(results[1].value);
      if (servers.status === 'rejected') throw servers.reason;
      return servers.value;
    })();
    pending.current = task;
    try {
      return await task;
    } finally {
      if (pending.current === task) pending.current = null;
    }
  }, [demo, enabled]);
  useEffect(() => {
    if (!enabled || demo) {
      active.current = false;
      return;
    }
    active.current = true;
    void load().catch(() => {});
    const visible = () => {
      setNow(Date.now());
      if (document.visibilityState === 'visible' && !mutating.current) void load().catch(() => {});
    };
    const timer = setInterval(visible, 5000);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active.current = false;
      generation.current += 1;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [load, enabled, demo]);
  const fresh = statusIsFresh(receivedAt, failed, now);
  const act = async (action: () => Promise<unknown>, confirm?: (status: ServersStatus) => void) => {
    if (!statusIsFresh(receivedAt, failed, Date.now()))
      throw new Error('Refresh your servers before making changes.');
    setBusy(true);
    mutating.current = true;
    generation.current += 1;
    setError('');
    try {
      await saveThenRefresh(
        action,
        async () => {
          await pending.current?.catch(() => {});
          const next = await load();
          if (!next) throw new Error('The updated server state could not be confirmed.');
          return next;
        },
        confirm,
      );
    } catch (reason) {
      if (active.current) setError(serverErrorMessage(reason));
      throw reason;
    } finally {
      mutating.current = false;
      if (active.current) setBusy(false);
    }
  };
  return { status, cluster, history, error, busy, fresh, now, receivedAt, refresh: load, act };
}
