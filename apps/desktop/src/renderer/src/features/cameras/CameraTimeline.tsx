/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Box, HausButton, HausScrollArea, Heading, Pressable, Text } from '@haus/ui';
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
  recordingStart,
  nextRecording,
  canPlayOriginalImmediately,
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
  onOpenSettings,
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
  onOpenSettings?: () => void;
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
  const clockHost = useRef<HTMLDivElement>(null);
  const timeline = useRef<HTMLElement>(null);
  const { from, to } = recordingDayRange(day);
  const history = useRecordingHistory(
    cameraId,
    demo,
    expanded ? { from, to: to - 1, kind } : { to: anchor, allDays: true },
    onSelectionChange,
  );
  const { availability, events, periods, error, setError, loading, addEvent } = history;
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
    const api = window.hausNative;
    if (!selected || demo || !api || canPlayOriginalImmediately(selected)) return;
    let active = true;
    const timer = setTimeout(
      () =>
        void api
          .helper<CameraEvent>({ method: 'GET', path: `/api/events/${selected.id}/prepare` })
          .then((event) => {
            if (active) {
              addEvent(event);
              onSelectionChange?.(event);
            }
          })
          .catch(() => {}),
      180,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [selected?.id, demo, onSelectionChange, addEvent]);
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
    <Box
      semantic="section"
      boxRef={timeline}
      className={`camera-timeline camera-timeline-inline ${expanded ? 'is-expanded' : 'is-overlay'}`}
      ariaLabel="Camera recordings"
      dataAttrs={{
        'data-empty': !events.length || undefined,
        'data-playback': (!expanded && Boolean(selected)) || undefined,
      }}
    >
      {!expanded && availability?.state === 'started' && (
        <Text className="history-centered-playhead" ariaHidden />
      )}
      {!expanded && (
        <Box className="history-clock" boxRef={clockHost} hidden={!selected}>
          <Text semantic="strong" textRef={clockTime}>
            {selected &&
              new Date(recordingStart(selected)).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
          </Text>
          <Text textRef={clockDay}>{selected && dateLabel(recordingStart(selected))}</Text>
        </Box>
      )}
      {expanded && selected?.playbackInfo && (selected.playbackInfo.largestGap ?? 0) > 0.5 && (
        <Text semantic="p" className="recording-source-gap">
          This source recording has missing frames (up to{' '}
          {selected.playbackInfo.largestGap?.toFixed(1)}s). Playback preserves their timing.
        </Text>
      )}
      <Box className="recording-toolbar">
        <Box className="recording-heading">
          <Heading level={3}>
            {!expanded && selected && (
              <Pressable
                className="history-play"
                ariaLabel={playback.playing ? 'Pause recording' : 'Play recording'}
                onPress={onTogglePlayback}
              >
                {playback.playing ? (
                  <Pause size={15} fill="currentColor" />
                ) : (
                  <Play size={15} fill="currentColor" />
                )}
              </Pressable>
            )}
            {expanded ? 'History' : ''}{' '}
            {slowLoading && (
              <LoaderCircle size={13} className="spin" aria-label="Loading recordings" />
            )}
          </Heading>
          <Text semantic="p">
            {selected
              ? `${dateLabel(selected.startAt + playback.seconds * 1000)} · ${selected.kinds.map(eventKind).join(' · ')}`
              : 'Recordings stay on your home server.'}
          </Text>
        </Box>
        {!expanded && (
          <HausButton
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
          </HausButton>
        )}
        {expanded ? calendar : calendarHost ? createPortal(calendar, calendarHost) : calendar}
      </Box>
      {error && (
        <Text semantic="p" className="recording-error" role="alert">
          {error}
        </Text>
      )}
      {!demo && availability?.installed && availability.state !== 'started' && (
        <Box className="recording-empty">
          <Film size={27} />
          <Heading level={4}>Start saving moments</Heading>
          <Text semantic="p">
            Recording will resume once your Haus Hub recording service is ready.
          </Text>
        </Box>
      )}
      {(demo || availability?.installed === false) && (
        <Box className="recording-empty">
          <Film size={29} />
          <Heading level={4}>Your home has a memory.</Heading>
          <Text semantic="p">
            {demo
              ? 'Connect your Haus Hub to keep camera events in a private timeline.'
              : 'Enable camera recording on your Haus Hub to save motion and object events locally.'}
          </Text>
        </Box>
      )}
      {availability?.state === 'started' && (
        <>
          {expanded && selected && (
            <Box className="recording-caption">
              <Clock3 size={13} />
              <Text>
                {time(selected.startAt)} · {Math.round(selected.duration)}s
              </Text>
              {selected.error && <Text>{selected.error}</Text>}
              <Pressable
                onPress={() =>
                  void window.hausNative
                    ?.saveRecording(selected.id)
                    .catch((reason) => setError(message(reason)))
                }
                ariaLabel="Download recording"
              >
                <Download size={15} />
              </Pressable>
            </Box>
          )}
          {expanded && !loading && !events.length && (
            <Text semantic="p" className="recording-quiet">
              No events on this day.
            </Text>
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
            <HausScrollArea
              orientation="horizontal"
              hideScrollBar
              size={24}
              className="recording-filter-scroll"
            >
              <Box className="recording-filters">
                {['all', 'motion', 'person', 'pet', 'vehicle', 'doorbell', 'manual'].map(
                  (value) => (
                    <Pressable
                      key={value}
                      ariaPressed={kind === value}
                      onPress={() => setKind(value)}
                    >
                      {value === 'all' ? 'All events' : eventKind(value)}
                    </Pressable>
                  ),
                )}
              </Box>
            </HausScrollArea>
          )}
          {(!expanded || events.length > 0) && (
            <Box className={`history-filmstrip-viewport ${!expanded ? 'is-overlay' : ''}`}>
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
                  followRevision={liveRevision}
                  centerRef={timeline}
                  events={ordered}
                  offline={offline}
                  selected={selected}
                  playback={playback}
                  playbackElement={playbackElement}
                  playbackIntent={playbackIntent}
                  clock={{ host: clockHost, time: clockTime, day: clockDay }}
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
            </Box>
          )}
          {expanded && offline.length > 0 && (
            <Text semantic="p" className="history-availability-key">
              Striped periods: camera offline
            </Text>
          )}
          <Box className="recording-actions">
            <HausButton variant="secondary" isDisabled={recording} onPress={() => void record()}>
              <Film size={15} />
              Record a moment
            </HausButton>
            {onOpenSettings && (
              <HausButton variant="ghost" onPress={onOpenSettings}>
                <Settings2 size={15} />
                Detectors &amp; recording
              </HausButton>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
