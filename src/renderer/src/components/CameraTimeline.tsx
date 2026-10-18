import { useEffect, useRef, useState } from 'react';
import '../recordings.css';
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
import { useDelayedPending } from '../hooks/useDelayedPending';
import { SmoothImage } from './SmoothImage';
import { message } from '../hooks/useHaus';
import {
  chronologicalRecordings,
  nextRecording,
  type CameraAvailability,
  type CameraEvent,
} from '../model/camera-history';
export type { CameraEvent } from '../model/camera-history';
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
export function CameraTimeline({
  cameraId,
  demo,
  onSelectionChange,
  expanded = false,
  selected,
  endedId,
  playback,
  onSeek,
  onTogglePlayback,
}: {
  cameraId: string;
  demo: boolean;
  expanded?: boolean;
  selected?: CameraEvent;
  endedId?: string;
  playback: { seconds: number; duration: number; playing: boolean };
  onSeek: (seconds: number) => void;
  onTogglePlayback: () => void;
  onSelectionChange?: (event: CameraEvent | undefined) => void;
}) {
  const [availability, setAvailability] = useState<Availability>();
  const [events, setEvents] = useState<CameraEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [day, setDay] = useState(() => dayString(new Date()));
  const [kind, setKind] = useState('all');
  useEffect(() => {
    if (!expanded) setKind('all');
  }, [expanded]);
  const [periods, setPeriods] = useState<CameraAvailability[]>([]);
  const strip = useRef<HTMLDivElement>(null);
  const followAfter = useRef(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const generation = useRef(0);
  const paged = useRef(false);
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
    if (!cursor || !window.hausNative) return;
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
      setLoading(false);
    }
  };
  const choose = (event: CameraEvent) => {
    if (event.status !== 'ready') return;
    onSelectionChange?.(event);
  };
  useEffect(() => {
    if (!endedId || selected?.id !== endedId) return;
    const next = nextRecording(events, endedId);
    if (next) onSelectionChange?.(next);
  }, [endedId, events, selected?.id, onSelectionChange]);
  useEffect(() => {
    if (expanded || !strip.current || !selected) return;
    const viewport = strip.current;
    const item = viewport.querySelector<HTMLElement>('[aria-current="true"]');
    if (!item || Date.now() < followAfter.current) return;
    const progress = playback.duration > 0 ? playback.seconds / playback.duration : 0;
    const target = item.offsetLeft + item.offsetWidth * progress - viewport.clientWidth / 2;
    viewport.scrollTo({
      left: Math.max(0, target),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  }, [selected?.id, playback.seconds, playback.duration, events.length, expanded]);
  const ordered = chronologicalRecordings(events);
  const offline = periods.filter(
    (period) => period.state === 'offline' && period.endAt > period.startAt,
  );
  const position = (startAt: number, endAt: number) => ({
    left: `${Math.max(0, ((startAt - from) / (to - from)) * 100)}%`,
    width: `${Math.max(0.4, ((Math.min(to, endAt) - Math.max(from, startAt)) / (to - from)) * 100)}%`,
  });
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
  return (
    <section
      className={`camera-timeline camera-timeline-inline ${expanded ? 'is-expanded' : 'is-overlay'}`}
      aria-label="Camera recordings"
    >
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
            {expanded
              ? 'History'
              : selected
                ? time(selected.startAt + playback.seconds * 1000)
                : 'Live'}{' '}
            {slowLoading && (
              <LoaderCircle size={13} className="spin" aria-label="Loading recordings" />
            )}
          </h3>
          <p>
            {selected
              ? selected.kinds.map(eventKind).join(' · ')
              : 'Recordings stay on your home server.'}
          </p>
        </div>
        <div className="recording-day">
          {!expanded && (
            <Button
              variant="secondary"
              className="recording-live-button"
              aria-pressed={!selected}
              onPress={() => onSelectionChange?.(undefined)}
            >
              Live
            </Button>
          )}
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
          {!expanded && selected && (
            <input
              className="history-seek"
              type="range"
              min={0}
              max={playback.duration || selected.duration || 1}
              step={0.1}
              value={playback.seconds}
              aria-label="Recording position"
              onChange={(event) => onSeek(Number(event.target.value))}
            />
          )}
          <div className="recording-ruler" aria-label="Day timeline">
            {offline.map((period) => (
              <span
                key={period.startAt}
                className="recording-offline-band"
                style={position(period.startAt, period.endAt)}
                title={`Camera offline · ${time(period.startAt)}–${time(period.endAt)}`}
                aria-label={`Camera offline from ${time(period.startAt)} to ${time(period.endAt)}`}
              />
            ))}
            {events.map((event) => (
              <button
                key={event.id}
                className={selected?.id === event.id ? 'is-selected' : ''}
                style={{
                  left: `${Math.max(0, ((event.startAt - from) / (to - from)) * 100)}%`,
                  width: `${Math.max(0.4, ((event.endAt - event.startAt) / (to - from)) * 100)}%`,
                }}
                onClick={() => choose(event)}
                disabled={event.status !== 'ready'}
                aria-label={`${event.kinds.map(eventKind).join(', ')} at ${time(event.startAt)}`}
                title={`${time(event.startAt)} · ${event.kinds.map(eventKind).join(', ')}`}
              />
            ))}
            <div className="recording-hours">
              {['00:00', '06:00', '12:00', '18:00', '24:00'].map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
          </div>
          <ScrollShadow
            orientation="horizontal"
            hideScrollBar
            size={24}
            className="recording-filter-scroll"
          >
            <div className="recording-filters">
              {['all', 'motion', 'person', 'pet', 'vehicle', 'doorbell', 'manual'].map((value) => (
                <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>
                  {value === 'all' ? 'All events' : eventKind(value)}
                </button>
              ))}
            </div>
          </ScrollShadow>
          <div className={`history-filmstrip-viewport ${!expanded ? 'is-overlay' : ''}`}>
            <div
              className="history-filmstrip"
              ref={strip}
              onPointerDown={() => {
                followAfter.current = Date.now() + 8000;
              }}
              onWheel={() => {
                followAfter.current = Date.now() + 8000;
              }}
            >
              <div className="recording-events">
                {(expanded ? events : ordered).map((event) => (
                  <button
                    key={event.id}
                    className={`recording-event ${selected?.id === event.id ? 'is-selected' : ''}`}
                    aria-current={selected?.id === event.id ? true : undefined}
                    disabled={event.status !== 'ready'}
                    onClick={() => {
                      followAfter.current = 0;
                      choose(event);
                    }}
                  >
                    <div>
                      {event.status === 'ready' ? (
                        <SmoothImage src={`haus-media://recordings/${event.id}/thumbnail`} alt="" />
                      ) : (
                        <Film size={20} />
                      )}
                      <span>
                        {event.status === 'ready'
                          ? `${Math.round(event.duration)}s`
                          : event.status === 'recording'
                            ? 'Recording…'
                            : event.status === 'interrupted'
                              ? 'Interrupted'
                              : 'Unavailable'}
                      </span>
                    </div>
                    <strong>{time(event.startAt)}</strong>
                    <small>{event.kinds.map(eventKind).join(' · ')}</small>
                  </button>
                ))}
                {cursor && (
                  <Button variant="ghost" isDisabled={loading} onPress={() => void loadMore()}>
                    Earlier moments <ChevronRight size={15} />
                  </Button>
                )}
              </div>
            </div>
            {!expanded && selected && (
              <span className="history-centered-playhead" aria-hidden="true" />
            )}
          </div>
          {offline.length > 0 && (
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
