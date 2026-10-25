import { useCallback, useEffect, useRef, useState } from 'react';
import { serverRequest, saveThenRefresh, type ClusterStatus } from './server-api';
import { appendSample, resourceSample, statusIsFresh } from './presentation';
import type { ResourceSample, ServersStatus } from './types';
import { serverErrorMessage } from './server-errors';
import { useServerVisibility } from './useServerVisibility';
import type { ServerSshServer } from '../../../../shared/terminal';
import { mergeServerConnections } from './server-connections';

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
  const clusterReadAt = useRef(0);
  const latestStatus = useRef<ServersStatus | undefined>(undefined);
  const latestSshServers = useRef<ServerSshServer[]>([]);
  const latestManagedServers = useRef<ServersStatus['servers']>([]);
  const resumeClock = useRef<() => void>(() => {});
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
      const readCluster = !clusterReadAt.current || Date.now() - clusterReadAt.current >= 5000;
      if (readCluster) clusterReadAt.current = Date.now();
      const sshRequest =
        typeof window !== 'undefined' && window.hausNative?.serverSshServers
          ? window.hausNative.serverSshServers()
          : Promise.resolve([]);
      const results = await Promise.allSettled([
        serverRequest<ServersStatus>('GET', '/api/servers'),
        readCluster
          ? serverRequest<ClusterStatus>('GET', '/api/cluster')
          : Promise.resolve(undefined),
        sshRequest,
      ]);
      if (!active.current || started !== generation.current) return;
      const servers = results[0];
      if (results[2].status === 'fulfilled') {
        latestSshServers.current = results[2].value;
      }
      if (servers.status === 'fulfilled') {
        latestManagedServers.current = servers.value.servers;
        const combined = {
          ...servers.value,
          servers: mergeServerConnections(servers.value.servers, latestSshServers.current),
        };
        const at = Date.now();
        const publishImmediately = !latestStatus.current || mutating.current;
        latestStatus.current = combined;
        if (publishImmediately) setStatus(combined);
        setReceivedAt(at);
        setFailed(false);
        setError('');
        setHistory((previous) => {
          if (combined.servers.every((server) => previous[server.id]?.length)) return previous;
          return Object.fromEntries(
            combined.servers.map((server) => [
              server.id,
              previous[server.id]?.length ? previous[server.id] : [resourceSample(server, at)],
            ]),
          );
        });
      } else {
        setFailed(true);
        setError(serverErrorMessage(servers.reason));
        // SSH profiles live in native secure storage. Keep them available for
        // terminal access and settings even when Haus telemetry is down.
        if (latestSshServers.current.length) {
          const previous = latestStatus.current;
          const combined: ServersStatus = {
            ...previous,
            sampledAt: previous?.sampledAt ?? Date.now(),
            servers: mergeServerConnections(
              latestManagedServers.current.map((server) => ({ ...server, online: false })),
              latestSshServers.current,
            ),
          };
          latestStatus.current = combined;
          setStatus(combined);
          setHistory((samples) =>
            Object.fromEntries(
              combined.servers.map((server) => [
                server.id,
                samples[server.id]?.length
                  ? samples[server.id]
                  : [resourceSample(server, Date.now())],
              ]),
            ),
          );
        }
      }
      if (results[1].status === 'fulfilled' && results[1].value) setCluster(results[1].value);
      if (servers.status === 'rejected') throw servers.reason;
      return latestStatus.current;
    })();
    pending.current = task;
    try {
      return await task;
    } finally {
      if (pending.current === task) pending.current = null;
    }
  }, [demo, enabled]);
  const visibleServers = useServerVisibility(enabled && !demo, () => {
    resumeClock.current();
    if (!mutating.current) void load().catch(() => {});
  });
  useEffect(() => {
    if (!enabled || demo) {
      active.current = false;
      return;
    }
    active.current = true;
    void load().catch(() => {});
    let frame = 0;
    const epoch = Date.now() - performance.now();
    let nextTick = 0;
    const tick = (time: number) => {
      frame = 0;
      if (document.visibilityState !== 'visible' || !visibleServers.current) return;
      if (time >= nextTick) {
        const scheduled = nextTick + Math.floor((time - nextTick) / 1000) * 1000;
        nextTick = scheduled + 1000;
        const at = epoch + scheduled;
        const latest = latestStatus.current;
        setNow(Date.now());
        if (latest) {
          setStatus(latest);
          setHistory((previous) =>
            Object.fromEntries(
              latest.servers.map((server) => [
                server.id,
                appendSample(previous[server.id] ?? [], resourceSample(server, at)),
              ]),
            ),
          );
        }
      }
      frame = requestAnimationFrame(tick);
    };
    const startClock = () => {
      if (frame || document.visibilityState !== 'visible' || !visibleServers.current) return;
      nextTick = (Math.floor(performance.now() / 1000) + 1) * 1000;
      frame = requestAnimationFrame(tick);
    };
    resumeClock.current = startClock;
    startClock();
    const visible = () => {
      if (document.visibilityState !== 'visible' || !visibleServers.current) return;
      startClock();
      if (!mutating.current) void load().catch(() => {});
    };
    const visibilityChanged = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      visible();
    };
    // Read between the independent one-second source clocks, so a boundary
    // race cannot hide a real sample until the following second.
    const timer = setInterval(visible, 500);
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      active.current = false;
      generation.current += 1;
      cancelAnimationFrame(frame);
      resumeClock.current = () => {};
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [load, enabled, demo, visibleServers]);
  const fresh = statusIsFresh(receivedAt, failed, now);
  const act = async (action: () => Promise<unknown>, confirm?: (status: ServersStatus) => void) => {
    if (!statusIsFresh(receivedAt, failed, Date.now()))
      throw new Error('Refresh your servers before making changes.');
    setBusy(true);
    mutating.current = true;
    generation.current += 1;
    clusterReadAt.current = 0;
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
