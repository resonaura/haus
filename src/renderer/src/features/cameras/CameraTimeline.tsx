import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Button, ScrollShadow } from '@heroui/react';
import { Clock3, Download, Film, Play, Pause, LoaderCircle, Settings2 } from 'lucide-react';
import { RecordingCalendar } from './RecordingCalendar';
import { useRecordingHistory } from './useRecordingHistory';
import { recordingDay, recordingDayRange } from '../../model/recording-calendar';
import { useDelayedPending } from '../../hooks/useDelayedPending';
import { RecordingRuler } from './RecordingRuler';
import { RecordingRail } from './RecordingRail';
import { HistoryFilmstrip } from './HistoryFilmstrip';
import { message } from '../../hooks/useHaus';
import {
  chronologicalRecordings,
  nextRecording,
  type CameraEvent,
} from '../../model/camera-history';
export type { CameraEvent } from '../../model/camera-history';
const eventKind = (kind: string) =>
  ({
    motion: 'Motion',
    person: 'Person',
    pet: 'Pet',
    vehicle: 'Vehicle',
    doorbell: 'Doorbell',
    manual: 'Manual recording',
  })[kind] ?? kind;
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
  playbackIntent,
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
  playbackIntent?: boolean;
  onTogglePlayback: () => void;
  onScrub: (event: CameraEvent, seconds: number, playing: boolean) => void;
  calendarHost?: HTMLElement | null;
  onSelectionChange?: (event: CameraEvent | undefined) => void;
}) {
  const [day, setDay] = useState(() => recordingDay(Date.now()));
  const [anchor, setAnchor] = useState<number>();
  const pendingDay = useRef<string | undefined>(undefined);
  const [kind, setKind] = useState('all');
  const [liveRevision, setLiveRevision] = useState(0);
  const [recording, setRecording] = useState(false);
  const clockTime = useRef<HTMLElement>(null);
  const clockDay = useRef<HTMLSpanElement>(null);
  const { from, to } = recordingDayRange(day);
  const history = useRecordingHistory(
    cameraId,
    demo,
    expanded ? { from, to: to - 1, kind } : { to: anchor, allDays: true },
    onSelectionChange,
  );
  const { availability, events, periods, error, setError, loading } = history;
  const slowLoading = useDelayedPending(loading);
  useEffect(() => {
    if (!expanded) setKind('all');
  }, [expanded]);
  useEffect(() => {
    if (!pendingDay.current || loading) return;
    pendingDay.current = undefined;
    onSelectionChange?.(events.find((event) => event.status === 'ready'));
  }, [loading, events, onSelectionChange]);
  const selectDay = (value: string) => {
    setDay(value);
    if (!expanded) {
      const nextAnchor = recordingDayRange(value).to - 1;
      if (anchor === nextAnchor)
        onSelectionChange?.(events.find((event) => event.status === 'ready'));
      else {
        pendingDay.current = value;
        setAnchor(nextAnchor);
      }
    }
  };
  const choose = (event: CameraEvent) => {
    if (event.status !== 'ready') return;
    onSelectionChange?.(event);
  };
  useEffect(() => {
    if (!endedId || selected?.id !== endedId) return;
    const next = nextRecording(events, endedId);
    if (!next && history.newer) {
      if (!loading) history.later();
      return;
    }
    onSelectionChange?.(next);
  }, [endedId, events, selected?.id, onSelectionChange, history.newer, history.later, loading]);
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
      history.addEvent(event);
      setDay(recordingDay(Date.now()));
      setError('');
    } catch (reason) {
      setError(message(reason));
    } finally {
      setRecording(false);
    }
  };
  const calendar = (
    <RecordingCalendar
      cameraId={cameraId}
      day={day}
      events={events}
      demo={demo}
      onChange={selectDay}
    />
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
      {expanded && selected?.playbackInfo && (selected.playbackInfo.largestGap ?? 0) > 0.5 && (
        <p className="recording-source-gap">
          This source recording has missing frames (up to{' '}
          {selected.playbackInfo.largestGap?.toFixed(1)}s). Playback preserves their timing.
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
              setDay(recordingDay(Date.now()));
              setAnchor(undefined);
              pendingDay.current = undefined;
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
          {expanded && !loading && !events.length && (
            <p className="recording-quiet">No events on this day.</p>
          )}
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
                  hasEarlier={Boolean(history.older)}
                  onEarlier={history.earlier}
                />
              ) : (
                <HistoryFilmstrip
                  key={liveRevision}
                  events={ordered}
                  offline={offline}
                  selected={selected}
                  playback={playback}
                  playbackElement={playbackElement}
                  playbackIntent={playbackIntent}
                  clock={{ time: clockTime, day: clockDay }}
                  hasEarlier={Boolean(history.older)}
                  loading={loading}
                  onEarlier={history.earlier}
                  onSelect={choose}
                  hasLater={Boolean(history.newer)}
                  onLater={history.later}
                  onDayChange={(at) => setDay(recordingDay(at))}
                  onScrub={onScrub}
                />
              )}
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
