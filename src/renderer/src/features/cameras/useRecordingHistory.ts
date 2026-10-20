import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CameraAvailability, CameraEvent } from '../../model/camera-history';
import { message } from '../../hooks/useHaus';

interface Availability {
  installed: boolean;
  slug?: string;
  state?: string;
}
interface EventsPage {
  events: CameraEvent[];
  nextCursor: string | null;
  newestCursor?: string | null;
  availability?: CameraAvailability[];
}
interface History {
  key: string;
  events: CameraEvent[];
  periods: CameraAvailability[];
  older: string | null;
  newer: string | null;
}
const empty = (key: string): History => ({
  key,
  events: [],
  periods: [],
  older: null,
  newer: null,
});
const mergeEvents = (old: CameraEvent[], page: CameraEvent[]) =>
  [...new Map([...old, ...page].map((event) => [event.id, event])).values()].sort(
    (a, b) => b.startAt - a.startAt || b.id.localeCompare(a.id),
  );
const mergePeriods = (old: CameraAvailability[], page: CameraAvailability[] = []) => [
  ...new Map(
    [...old, ...page].map((period) => [`${period.cameraId}:${period.startAt}`, period]),
  ).values(),
];

/** A bounded page in either direction; calendar jumps never download the entire archive. */
export function useRecordingHistory(
  cameraId: string,
  demo: boolean,
  filters: { from?: number; to?: number; kind?: string; allDays?: boolean },
  onReset?: (event: CameraEvent | undefined) => void,
) {
  const query = new URLSearchParams({ camera_id: cameraId, limit: '100' });
  if (filters.from !== undefined) query.set('from', String(filters.from));
  if (filters.to !== undefined) query.set('to', String(filters.to));
  if (filters.kind && filters.kind !== 'all') query.set('kind', filters.kind);
  // Failed capture attempts belong in Events, never bury playable moments in the filmstrip.
  if (filters.allDays) query.set('status', 'ready');
  const key = query.toString();
  const [data, setData] = useState<History>(() => empty(''));
  const [availability, setAvailability] = useState<Availability>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const paging = useRef(false);
  const paged = useRef(false);
  const retryAfter = useRef(0);
  const current = useRef({ data, key, allDays: filters.allDays });
  current.current = { data, key, allDays: filters.allDays };
  useEffect(() => {
    const epoch = ++generation.current;
    paged.current = false;
    retryAfter.current = 0;
    paging.current = false;
    let active = true;
    let busy = false;
    setData(empty(key));
    setAvailability(undefined);
    setLoading(true);
    setError('');
    onReset?.(undefined);
    const api = window.hausNative;
    if (demo || !api) {
      setLoading(false);
      return;
    }
    const refresh = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const service = await api.helper<Availability>({
          method: 'GET',
          path: '/api/availability',
        });
        if (!active) return;
        setAvailability(service);
        if (!service.installed || service.state !== 'started') return;
        const refreshQuery = new URLSearchParams(key);
        if (filters.allDays && paged.current && current.current.data.newer === null)
          refreshQuery.delete('to');
        const page = await api.helper<EventsPage>({
          method: 'GET',
          path: `/api/events?${refreshQuery}`,
        });
        if (!active || generation.current !== epoch) return;
        setData((old) => ({
          key,
          events: mergeEvents(old.key === key ? old.events : [], page.events),
          periods: mergePeriods(old.key === key ? old.periods : [], page.availability),
          older: paged.current ? old.older : page.nextCursor,
          newer: paged.current
            ? old.newer
            : filters.allDays && filters.to !== undefined
              ? (page.newestCursor ?? null)
              : null,
        }));
        setError('');
      } catch (reason) {
        if (active) setError(message(reason));
      } finally {
        busy = false;
        if (active && !paging.current) setLoading(false);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 8000);
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      ++generation.current;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [key, demo, onReset]);
  const load = useCallback(async (direction: 'older' | 'newer') => {
    const { data: snapshot, key: expected } = current.current;
    const cursor = snapshot[direction];
    if (
      !cursor ||
      !window.hausNative ||
      paging.current ||
      snapshot.key !== expected ||
      Date.now() < retryAfter.current
    )
      return;
    const epoch = generation.current;
    paging.current = true;
    setLoading(true);
    try {
      const query = new URLSearchParams(expected);
      // An anchored day locates the viewport; paging still spans the whole retained history.
      if (current.current.allDays) {
        query.delete('to');
        query.delete('from');
      }
      query.set('direction', direction);
      query.set('cursor', cursor);
      const page = await window.hausNative.helper<EventsPage>({
        method: 'GET',
        path: `/api/events?${query}`,
      });
      if (epoch !== generation.current) return;
      paged.current = true;
      setData((old) => ({
        ...old,
        events: mergeEvents(old.events, page.events),
        periods: mergePeriods(old.periods, page.availability),
        [direction]: page.nextCursor,
      }));
      setError('');
    } catch (reason) {
      if (epoch === generation.current) {
        retryAfter.current = Date.now() + 5000;
        setError(message(reason));
      }
    } finally {
      if (epoch === generation.current) {
        paging.current = false;
        setLoading(false);
      }
    }
  }, []);
  const addEvent = useCallback(
    (event: CameraEvent) =>
      setData((old) => ({ ...old, events: mergeEvents(old.events, [event]) })),
    [],
  );
  const earlier = useCallback(() => void load('older'), [load]);
  const later = useCallback(() => void load('newer'), [load]);
  return useMemo(
    () => ({
      ...data,
      availability,
      error,
      setError,
      loading: loading || data.key !== key,
      addEvent,
      earlier,
      later,
    }),
    [data, availability, error, loading, key, earlier, later, addEvent],
  );
}
