import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Button, ScrollShadow } from '@heroui/react';
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Film,
  Play,
  Pause,
  LoaderCircle,
  Settings2,
} from 'lucide-react';
import { useDelayedPending } from '../../hooks/useDelayedPending';
import { RecordingRuler } from './RecordingRuler';
import { RecordingRail } from './RecordingRail';
import { HistoryFilmstrip } from './HistoryFilmstrip';
import { message } from '../../hooks/useHaus';
import {
  chronologicalRecordings,
  nextRecording,
  type CameraAvailability,
  type CameraEvent,
} from '../../model/camera-history';
export type { CameraEvent } from '../../model/camera-history';
interface Availability {
  installed: boolean;
  slug?: string;
  state?: string;
}
interface EventsPage {
  events: CameraEvent[];
  nextCursor: string | null;
  availability?: CameraAvailability[];
}
const eventKind = (kind: string) =>
  ({
    motion: 'Motion',
    person: 'Person',
    pet: 'Pet',
    vehicle: 'Vehicle',
    doorbell: 'Doorbell',
    manual: 'Manual recording',
  })[kind] ?? kind;
const dayString = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dateLabel = (at: number) =>
  new Date(at).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
export function CameraTimeline({
  cameraId,
  demo,
  onSelectionChange,
  expanded = false,
  selected,
  endedId,
  playback,
  playbackElement,
  onTogglePlayback,
  onScrub,
  calendarHost,
}: {
  cameraId: string;
  demo: boolean;
  expanded?: boolean;
  selected?: CameraEvent;
  endedId?: string;
  playback: { seconds: number; duration: number; playing: boolean };
  playbackElement?: RefObject<HTMLVideoElement | null>;
  onTogglePlayback: () => void;
  onScrub: (event: CameraEvent, seconds: number) => void;
  calendarHost?: HTMLElement | null;
  onSelectionChange?: (event: CameraEvent | undefined) => void;
}) {
  const [availability, setAvailability] = useState<Availability>();
  const [events, setEvents] = useState<CameraEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [day, setDay] = useState(() => dayString(new Date()));
  const [kind, setKind] = useState('all');
  const [liveRevision, setLiveRevision] = useState(0);
  useEffect(() => {
    if (!expanded) setKind('all');
  }, [expanded]);
  const [periods, setPeriods] = useState<CameraAvailability[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const clockTime = useRef<HTMLElement>(null);
  const clockDay = useRef<HTMLSpanElement>(null);
  const generation = useRef(0);
  const paged = useRef(false);
  const paging = useRef(false);
  const slowLoading = useDelayedPending(loading);
  const from = new Date(`${day}T00:00:00`).getTime();
  const nextDay = new Date(from);
  nextDay.setDate(nextDay.getDate() + 1);
  const to = nextDay.getTime();
  const query = new URLSearchParams({
    camera_id: cameraId,
    from: String(from),
    to: String(to - 1),
    limit: '100',
    ...(kind === 'all' ? {} : { kind }),
  });
  const queryString = query.toString();
  useEffect(() => {
    const current = ++generation.current;
    paged.current = false;
    let active = true;
    let busy = false;
    setEvents([]);
    setPeriods([]);
    onSelectionChange?.(undefined);
    setError('');
    setLoading(true);
    setAvailability(undefined);
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
        const page = await api.helper<EventsPage>({
          method: 'GET',
          path: `/api/events?${queryString}`,
        });
        if (!active || generation.current !== current) return;
        setEvents((old) => {
          // Preserve earlier loaded pages while refreshing the recent edge of the timeline.
          if (!page.nextCursor) return page.events;
          const known = new Map(old.map((event) => [event.id, event]));
          for (const event of page.events) known.set(event.id, event);
          return [...known.values()].sort((a, b) => b.startAt - a.startAt);
        });
        if (!paged.current) setCursor(page.nextCursor);
        setPeriods(page.availability ?? []);
        setError('');
      } catch (reason) {
        if (active) setError(message(reason));
      } finally {
        busy = false;
        if (active) setLoading(false);
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
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [cameraId, demo, queryString, onSelectionChange]);
  const loadMore = async () => {
    if (!cursor || !window.hausNative || paging.current) return;
    paging.current = true;
    const current = generation.current;
    setLoading(true);
    try {
      const page = await window.hausNative.helper<EventsPage>({
        method: 'GET',
        path: `/api/events?${queryString}&cursor=${encodeURIComponent(cursor)}`,
      });
      if (current !== generation.current) return;
      paged.current = true;
      setEvents((old) => [
        ...new Map([...old, ...page.events].map((event) => [event.id, event])).values(),
      ]);
      setCursor(page.nextCursor);
    } catch (reason) {
      setError(message(reason));
    } finally {
      paging.current = false;
      if (current === generation.current) setLoading(false);
    }
  };
  const choose = (event: CameraEvent) => {
    if (event.status !== 'ready') return;
    onSelectionChange?.(event);
  };
  useEffect(() => {
    if (!endedId || selected?.id !== endedId) return;
    const next = nextRecording(events, endedId);
    onSelectionChange?.(next);
  }, [endedId, events, selected?.id, onSelectionChange]);
  useEffect(() => {
    if (!selected || demo || !window.hausNative) return;
    let active = true;
    void window.hausNative
      .helper<CameraEvent>({ method: 'GET', path: `/api/events/${selected.id}/prepare` })
      .then((event) => {
        if (active) onSelectionChange?.(event);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [selected?.id, demo, onSelectionChange]);
  const upcomingId = useMemo(
    () => (selected ? nextRecording(events, selected.id)?.id : undefined),
    [events, selected?.id],
  );
  useEffect(() => {
    if (!selected || !playback.playing || demo || document.visibilityState !== 'visible') return;
    if (!upcomingId) return;
    const timer = setTimeout(
      () =>
        void window.hausNative
          ?.helper({ method: 'GET', path: `/api/events/${upcomingId}/prepare-next` })
          .catch(() => {}),
      500,
    );
    return () => clearTimeout(timer);
  }, [selected?.id, playback.playing, demo, upcomingId]);
  const ordered = useMemo(() => chronologicalRecordings(events), [events]);
  const offline = useMemo(
    () => periods.filter((period) => period.state === 'offline' && period.endAt > period.startAt),
    [periods],
  );
  const record = async () => {
    if (!window.hausNative) return;
    setRecording(true);
    try {
      const event = await window.hausNative.helper<CameraEvent>({
        method: 'POST',
        path: `/api/cameras/${cameraId}/record`,
        data: {},
      });
      setEvents((old) => [event, ...old.filter((item) => item.id !== event.id)]);
      setDay(dayString(new Date()));
      setError('');
    } catch (reason) {
      setError(message(reason));
    } finally {
      setRecording(false);
    }
  };
  const shiftDay = (amount: number) => {
    const date = new Date(from);
    date.setDate(date.getDate() + amount);
    setDay(dayString(date));
  };
  const calendar = (
    <div className="recording-day">
      <Button isIconOnly variant="ghost" aria-label="Previous day" onPress={() => shiftDay(-1)}>
        <ChevronLeft size={16} />
      </Button>
      <input
        type="date"
        value={day}
        max={dayString(new Date())}
        aria-label="Recording date"
        onChange={(event) => {
          if (event.target.value) setDay(event.target.value);
        }}
      />
      <Button
        isIconOnly
        variant="ghost"
        aria-label="Next day"
        isDisabled={day >= dayString(new Date())}
        onPress={() => shiftDay(1)}
      >
        <ChevronRight size={16} />
      </Button>
    </div>
  );
  return (
    <section
      className={`camera-timeline camera-timeline-inline ${expanded ? 'is-expanded' : 'is-overlay'}`}
      aria-label="Camera recordings"
      data-empty={!events.length || undefined}
    >
      {!expanded && selected && (
        <div className="history-clock">
          <strong ref={clockTime}>
            {new Date(selected.startAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </strong>
          <span ref={clockDay}>{dateLabel(selected.startAt)}</span>
        </div>
      )}
      {expanded && selected?.playbackInfo && selected.playbackInfo.largestGap > 0.5 && (
        <p className="recording-source-gap">
          This source recording has missing frames (up to{' '}
          {selected.playbackInfo.largestGap.toFixed(1)}s). Playback preserves their timing.
        </p>
      )}
      <div className="recording-toolbar">
        <div>
          <h3>
            {!expanded && selected && (
              <button
                className="history-play"
                aria-label={playback.playing ? 'Pause recording' : 'Play recording'}
                onClick={onTogglePlayback}
              >
                {playback.playing ? (
                  <Pause size={15} fill="currentColor" />
                ) : (
                  <Play size={15} fill="currentColor" />
                )}
              </button>
            )}
            {expanded ? 'History' : ''}{' '}
            {slowLoading && (
              <LoaderCircle size={13} className="spin" aria-label="Loading recordings" />
            )}
          </h3>
          <p>
            {selected
              ? `${dateLabel(selected.startAt + playback.seconds * 1000)} · ${selected.kinds.map(eventKind).join(' · ')}`
              : 'Recordings stay on your home server.'}
          </p>
        </div>
        {!expanded && (
          <Button
            variant="secondary"
            className="recording-live-button"
            aria-pressed={!selected}
            onPress={() => {
              setDay(dayString(new Date()));
              setLiveRevision((value) => value + 1);
              onSelectionChange?.(undefined);
            }}
          >
            Live
          </Button>
        )}
        {expanded ? calendar : calendarHost ? createPortal(calendar, calendarHost) : calendar}
      </div>
      {error && (
        <p className="recording-error" role="alert">
          {error}
        </p>
      )}
      {!demo && availability?.installed && availability.state !== 'started' && (
        <div className="recording-empty">
          <Film size={27} />
          <h4>Start saving moments</h4>
          <p>Your recording service is installed and currently stopped.</p>
          <Button
            variant="secondary"
            onPress={() =>
              void window.hausNative
                ?.request({
                  type: 'supervisor/api',
                  endpoint: `/addons/${availability.slug}/start`,
                  method: 'post',
                })
                .catch((reason) => setError(message(reason)))
            }
          >
            Start Haus
          </Button>
        </div>
      )}
      {(demo || availability?.installed === false) && (
        <div className="recording-empty">
          <Film size={29} />
          <h4>Your home has a memory.</h4>
          <p>
            {demo
              ? 'Connect your home and install Haus to keep camera events in a private timeline.'
              : 'Install Haus from Add-ons to save motion and object events locally.'}
          </p>
        </div>
      )}
      {availability?.state === 'started' && (
        <>
          {expanded && selected && (
            <div className="recording-caption">
              <Clock3 size={13} />
              <span>
                {time(selected.startAt)} · {Math.round(selected.duration)}s
              </span>
              {selected.error && <span>{selected.error}</span>}
              <button
                onClick={() =>
                  void window.hausNative
                    ?.saveRecording(selected.id)
                    .catch((reason) => setError(message(reason)))
                }
                aria-label="Download recording"
              >
                <Download size={15} />
              </button>
            </div>
          )}
          {!loading && !events.length && <p className="recording-quiet">No events on this day.</p>}
          {expanded && (events.length > 0 || offline.length > 0) && (
            <RecordingRuler
              events={events}
              offline={offline}
              from={from}
              to={to}
              selected={selected}
              onSelect={choose}
            />
          )}
          {expanded && (events.length > 0 || kind !== 'all') && (
            <ScrollShadow
              orientation="horizontal"
              hideScrollBar
              size={24}
              className="recording-filter-scroll"
            >
              <div className="recording-filters">
                {['all', 'motion', 'person', 'pet', 'vehicle', 'doorbell', 'manual'].map(
                  (value) => (
                    <button
                      key={value}
                      aria-pressed={kind === value}
                      onClick={() => setKind(value)}
                    >
                      {value === 'all' ? 'All events' : eventKind(value)}
                    </button>
                  ),
                )}
              </div>
            </ScrollShadow>
          )}
          {(!expanded || events.length > 0) && (
            <div className={`history-filmstrip-viewport ${!expanded ? 'is-overlay' : ''}`}>
              {expanded ? (
                <RecordingRail
                  events={events}
                  selectedId={selected?.id}
                  onSelect={choose}
                  loading={loading}
                  hasEarlier={Boolean(cursor)}
                  onEarlier={() => void loadMore()}
                />
              ) : ordered.length || offline.length ? (
                <HistoryFilmstrip
                  key={liveRevision}
                  events={ordered}
                  offline={offline}
                  selected={selected}
                  playback={playback}
                  playbackElement={playbackElement}
                  clock={{ time: clockTime, day: clockDay }}
                  hasEarlier={Boolean(cursor)}
                  loading={loading}
                  onEarlier={() => void loadMore()}
                  onSelect={choose}
                  onScrub={onScrub}
                />
              ) : null}
            </div>
          )}
          {expanded && offline.length > 0 && (
            <p className="history-availability-key">Striped periods: camera offline</p>
          )}
          <div className="recording-actions">
            <Button variant="secondary" isDisabled={recording} onPress={() => void record()}>
              <Film size={15} />
              Record a moment
            </Button>
            <Button
              variant="ghost"
              onPress={() =>
                void window.hausNative
                  ?.openAddon(availability.slug!)
                  .catch((reason) => setError(message(reason)))
              }
            >
              <Settings2 size={15} />
              Detectors & recording
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
