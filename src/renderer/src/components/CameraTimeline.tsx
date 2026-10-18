import { useEffect, useRef, useState } from 'react';
import '../recordings.css';
import { Button, ScrollShadow } from '@heroui/react';
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Film,
  LoaderCircle,
  Play,
  Settings2,
} from 'lucide-react';
import { useDelayedPending } from '../hooks/useDelayedPending';
import { SmoothImage } from './SmoothImage';
import { message } from '../hooks/useHaus';
interface CameraEvent {
  id: string;
  cameraId: string;
  startAt: number;
  endAt: number;
  status: string;
  kinds: string[];
  duration: number;
  error?: string;
  bytes: number;
}
interface Availability {
  installed: boolean;
  slug?: string;
  state?: string;
}
interface EventsPage {
  events: CameraEvent[];
  nextCursor: string | null;
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
  onPlay,
}: {
  cameraId: string;
  demo: boolean;
  onPlay?: () => void;
}) {
  const [availability, setAvailability] = useState<Availability>();
  const [events, setEvents] = useState<CameraEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [day, setDay] = useState(() => dayString(new Date()));
  const [kind, setKind] = useState('all');
  const [selected, setSelected] = useState<CameraEvent>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [playError, setPlayError] = useState('');
  const [playing, setPlaying] = useState(false);
  const generation = useRef(0);
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
    let active = true;
    let busy = false;
    setEvents([]);
    setSelected(undefined);
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
          const known = new Map(old.map((event) => [event.id, event]));
          for (const event of page.events) known.set(event.id, event);
          return [...known.values()].sort((a, b) => b.startAt - a.startAt);
        });
        setCursor(page.nextCursor);
        setError('');
        setSelected((old) =>
          old ? (page.events.find((event) => event.id === old.id) ?? old) : undefined,
        );
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
  }, [cameraId, demo, queryString]);
  const loadMore = async () => {
    if (!cursor || !window.hausNative) return;
    setLoading(true);
    try {
      const page = await window.hausNative.helper<EventsPage>({
        method: 'GET',
        path: `/api/events?${queryString}&cursor=${encodeURIComponent(cursor)}`,
      });
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
    setSelected(event);
    setPlayError('');
    setPlaying(false);
    onPlay?.();
  };
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
    <section className="camera-timeline" aria-label="Camera recordings">
      <div className="recording-toolbar">
        <div>
          <h3>Moments at home</h3>
          <p>
            {selected
              ? selected.kinds.map(eventKind).join(' · ')
              : 'Recordings stay on your home server.'}
          </p>
        </div>
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
          <div className="recording-screen">
            {selected ? (
              <>
                <video
                  key={selected.id}
                  src={`haus-media://recordings/${selected.id}/video`}
                  poster={`haus-media://recordings/${selected.id}/thumbnail`}
                  controls
                  autoPlay
                  playsInline
                  data-ready={playing || undefined}
                  onPlaying={() => setPlaying(true)}
                  onError={() =>
                    setPlayError(
                      'This recording could not be played. Try downloading it or select another moment.',
                    )
                  }
                />
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
                        .catch((reason) => setPlayError(message(reason)))
                    }
                    aria-label="Download recording"
                  >
                    <Download size={15} />
                  </button>
                </div>
              </>
            ) : (
              <div className="recording-empty">
                <Play size={29} />
                <h4>
                  {loading
                    ? 'Finding your moments…'
                    : events.length
                      ? 'Choose a moment.'
                      : 'A quiet day.'}
                </h4>
                <p>
                  {events.length
                    ? 'Select an event below to play it.'
                    : 'Motion and object events will appear here automatically.'}
                </p>
              </div>
            )}
            {slowLoading && (
              <span className="recording-loading">
                <LoaderCircle className="spin" size={19} />
              </span>
            )}
          </div>
          {playError && (
            <p className="recording-error" role="status">
              {playError}
            </p>
          )}
          <div className="recording-ruler" aria-label="Day timeline">
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
          <ScrollShadow orientation="horizontal" hideScrollBar size={24}>
            <div className="recording-events">
              {events.map((event) => (
                <button
                  key={event.id}
                  className={`recording-event ${selected?.id === event.id ? 'is-selected' : ''}`}
                  disabled={event.status !== 'ready'}
                  onClick={() => choose(event)}
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
          </ScrollShadow>
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
