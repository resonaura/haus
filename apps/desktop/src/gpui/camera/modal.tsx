/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  cameraPtzButtons,
  canPlayOriginalImmediately,
  demoCameraEvents,
  formatEventKindLabel,
  recordingDay,
  recordingDayRange,
  recordingStart,
  type CameraDeviceConfig,
  type CameraEvent,
} from '@haus/core/transport';
import type { Snapshot } from '@haus/ha/types';
import { deviceDisplayName } from '@haus/ha/view/device-name';
import type { Preferences } from '@haus/ha/view/preferences';
import type { HausAccessory } from '@haus/ha/view/types';
import {
  CameraEventsSheet,
  CameraModalView,
  CameraOverlayTimeline,
  CameraPtzPanel,
  type CameraPtzControlAvailability,
  type CameraViewMode,
  type PortableCameraEventItem,
} from '@haus/ui/components';
import type { DeviceControl } from '../home/cards.js';
import { availableAction } from '../home/model.js';
import { CameraSettingsTabContent } from './modal-settings.js';
import {
  CameraModalViewport,
  cameraStatusTag,
  formatEventDuration,
  shiftCameraDay,
  type CameraLiveState,
} from './modal-stage.js';
import { demoCameraPreviewSrc } from './preview-image.js';
import type { GpuiCameraStreams } from './stream.js';
import type { CameraServiceAvailability, GpuiCameraApi } from './transport.js';

export function GpuiCameraModal({
  cameraId,
  snapshot,
  preferences,
  allAccessories,
  demo,
  disabled,
  streaming,
  cameraApi,
  fetchSnapshot,
  onControl,
  onPreferencesPatch,
  onClose,
}: {
  readonly cameraId: string;
  readonly snapshot: Snapshot;
  readonly preferences: Preferences;
  readonly allAccessories: readonly HausAccessory[];
  readonly demo?: boolean;
  readonly disabled: boolean;
  readonly streaming?: { readonly hub: string; readonly streams: GpuiCameraStreams };
  readonly cameraApi?: GpuiCameraApi;
  readonly fetchSnapshot?: (id: string) => Promise<string | null>;
  readonly onControl: DeviceControl;
  readonly onPreferencesPatch?: (patch: Partial<Preferences>) => void;
  readonly onClose: () => void;
}) {
  const cameraEntity = snapshot.states.find((item) => item.entity_id === cameraId);
  const cameraAccessory = allAccessories.find(
    (item) => item.primaryEntityId === cameraId || item.entityIds.includes(cameraId),
  );
  const area = snapshot.areas.find((item) => item.area_id === cameraAccessory?.areaId);
  const rawTitle =
    cameraAccessory?.name ??
    (typeof cameraEntity?.attributes.friendly_name === 'string'
      ? cameraEntity.attributes.friendly_name
      : cameraId);
  const title = deviceDisplayName(rawTitle, area?.name, 'Camera');
  const demoScene =
    typeof cameraEntity?.attributes.demo_scene === 'string'
      ? cameraEntity.attributes.demo_scene
      : undefined;
  const available = cameraEntity
    ? !['unavailable', 'unknown', 'off'].includes(cameraEntity.state)
    : false;

  const [view, setView] = useState<CameraViewMode>('live');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ptzOpen, setPtzOpen] = useState(false);
  const [fill, setFill] = useState(true);
  const [muted, setMuted] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [day, setDay] = useState(() => recordingDay(Date.now()));
  const [kind, setKind] = useState('all');
  const [selectedRecording, setSelectedRecording] = useState<CameraEvent>();
  const [liveState, setLiveState] = useState<CameraLiveState>('connecting');
  const [events, setEvents] = useState<CameraEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState('');
  const [availability, setAvailability] = useState<CameraServiceAvailability>();
  const [settings, setSettings] = useState<CameraDeviceConfig | undefined>(() =>
    demo
      ? { id: cameraId, enabled: true, motionDetection: { enabled: true, mode: 'objects' } }
      : undefined,
  );
  const [recordBusy, setRecordBusy] = useState(false);
  const [snapshotSrc, setSnapshotSrc] = useState<string | null>(null);

  const today = recordingDay(Date.now());
  const canGoNext = day < today;

  const relatedAccessories = useMemo(() => {
    if (!cameraAccessory) return [];
    if (!cameraAccessory.deviceId) return [cameraAccessory];
    return allAccessories.filter((item) => item.deviceId === cameraAccessory.deviceId);
  }, [allAccessories, cameraAccessory]);

  const relatedEntities = useMemo(
    () => [
      ...new Map(
        relatedAccessories
          .flatMap((acc) => [acc.state, ...acc.secondaryEntities])
          .map((entity) => [entity.entity_id, entity]),
      ).values(),
    ],
    [relatedAccessories],
  );

  const ptzButtons = useMemo(() => cameraPtzButtons(relatedEntities), [relatedEntities]);
  const ptzAvailability: CameraPtzControlAvailability = {
    up: Boolean(ptzButtons?.up),
    down: Boolean(ptzButtons?.down),
    left: Boolean(ptzButtons?.left),
    right: Boolean(ptzButtons?.right),
    zoomIn: Boolean(ptzButtons?.zoomIn),
    zoomOut: Boolean(ptzButtons?.zoomOut),
    stop: Boolean(ptzButtons?.stop),
    home: Boolean(ptzButtons?.home),
  };
  const hasPtz = Boolean(ptzButtons);

  useEffect(() => {
    if (demo || streaming || !fetchSnapshot || selectedRecording) return;
    let alive = true;
    const poll = () => {
      void fetchSnapshot(cameraId)
        .then((next) => {
          if (alive && next) setSnapshotSrc(next);
        })
        .catch(() => undefined);
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [cameraId, demo, fetchSnapshot, selectedRecording, streaming]);

  useEffect(() => {
    if (demo) {
      if (day === today) {
        const list = demoCameraEvents(cameraId);
        setEvents(kind === 'all' ? list : list.filter((item) => item.kinds.includes(kind)));
      } else {
        setEvents([]);
      }
      setEventsLoading(false);
      setEventsError('');
      return;
    }
    if (!cameraApi) {
      setEventsLoading(false);
      return;
    }
    let active = true;
    setEventsLoading(true);
    setEventsError('');
    const { from, to } = recordingDayRange(day);
    void cameraApi
      .availability()
      .then(async (avail) => {
        if (!active) return;
        setAvailability(avail);
        if (!avail.installed || avail.state !== 'started') {
          setEvents([]);
          return;
        }
        const list = await cameraApi.listEvents(cameraId, { from, to: to - 1, kind });
        if (active) setEvents(list);
      })
      .catch((err: unknown) => {
        if (active) setEventsError(err instanceof Error ? err.message : 'Failed to load events.');
      })
      .finally(() => {
        if (active) setEventsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [demo, cameraApi, cameraId, day, today, kind]);

  useEffect(() => {
    if (demo || !cameraApi) return;
    let active = true;
    void cameraApi
      .loadSettings(cameraId)
      .then((loaded) => {
        if (active && loaded) setSettings(loaded);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [demo, cameraApi, cameraId]);

  const liveFrames = useCallback(
    (signal: AbortSignal) => {
      if (!streaming) throw new Error('Streaming unavailable.');
      return streaming.streams.open(streaming.hub, cameraId, signal, setLiveState);
    },
    [streaming, cameraId],
  );

  const recordingFrames = useCallback(
    (signal: AbortSignal) => {
      if (!streaming || !selectedRecording) throw new Error('Recording unavailable.');
      return streaming.streams.openRecording(streaming.hub, selectedRecording.id, signal, {
        original: canPlayOriginalImmediately(selectedRecording),
        onStatus: setLiveState,
      });
    },
    [streaming, selectedRecording],
  );

  if (!cameraEntity) return null;

  const statusTag = cameraStatusTag({
    selectedRecording,
    demo,
    available,
    entityState: cameraEntity.state,
    streaming: Boolean(streaming),
    liveState,
  });

  const viewport = (
    <CameraModalViewport
      cameraId={cameraId}
      title={title}
      demoScene={demoScene}
      demo={demo}
      available={available}
      playing={playing}
      fill={fill}
      selectedRecording={selectedRecording}
      streaming={streaming}
      activeSnapshot={snapshotSrc}
      liveFrames={liveFrames}
      recordingFrames={recordingFrames}
      onStateChange={setLiveState}
      onRecordingEnded={() => {
        setPlaying(false);
        setLiveState('stopped');
      }}
    />
  );

  const dayRange = recordingDayRange(day);
  const dayLabel = new Date(`${day}T12:00:00`).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const portableEvents: PortableCameraEventItem[] = events.map((event, index) => ({
    id: event.id,
    startAt: event.startAt,
    endAt: event.endAt,
    timeLabel: new Date(event.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    durationLabel: formatEventDuration(event.duration),
    kinds: event.kinds.map(formatEventKindLabel),
    status: event.status,
    selected: selectedRecording?.id === event.id,
    thumbnailSrc: demo ? demoCameraPreviewSrc(demoScene, index) : undefined,
  }));
  const activePortableEvent = portableEvents.find((item) => item.selected);

  const unavailableMessage = !demo
    ? !cameraApi
      ? 'Connect your Haus Hub to keep camera events in a private timeline.'
      : availability && !availability.installed
        ? 'Enable camera recording on your Haus Hub to save motion and object events locally.'
        : availability && availability.state && availability.state !== 'started'
          ? 'Recording will resume once your Haus Hub recording service is ready.'
          : undefined
    : undefined;

  const chooseEvent = (eventId: string) => {
    const chosen = events.find((item) => item.id === eventId);
    if (!chosen) return;
    setSelectedRecording(chosen);
    setPlaying(true);
    if (!demo && cameraApi && !canPlayOriginalImmediately(chosen)) {
      void cameraApi.prepareRecording(chosen.id).catch(() => undefined);
    }
  };

  const resetToLive = () => {
    setSelectedRecording(undefined);
    setPlaying(false);
    setDay(recordingDay(Date.now()));
  };

  const selectedTimeClock = selectedRecording
    ? new Date(recordingStart(selectedRecording)).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : undefined;
  const selectedDayClock = selectedRecording
    ? new Date(recordingStart(selectedRecording)).toLocaleDateString([], {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      })
    : undefined;

  const overlayTimeline = (
    <CameraOverlayTimeline
      events={portableEvents}
      hasSelection={Boolean(selectedRecording)}
      playing={playing}
      selectedTimeClock={selectedTimeClock}
      selectedDayClock={selectedDayClock}
      unavailableMessage={unavailableMessage}
      onTogglePlay={() => setPlaying((prev) => !prev)}
      onBackToLive={resetToLive}
      onSelectEvent={chooseEvent}
    />
  );

  const eventsSheet = (
    <CameraEventsSheet
      dayLabel={dayLabel}
      dayRange={dayRange}
      selectedKind={kind}
      events={portableEvents}
      loading={eventsLoading}
      error={eventsError}
      unavailableMessage={unavailableMessage}
      recordingBusy={recordBusy}
      canRecord={Boolean(!demo && cameraApi && availability?.installed && availability.state === 'started')}
      selectedEvent={activePortableEvent}
      onSelectKind={setKind}
      onRecordNow={() => {
        if (!cameraApi || recordBusy) return;
        setRecordBusy(true);
        void cameraApi
          .startManualRecording(cameraId)
          .then((event) => {
            if (event) setEvents((prev) => [event, ...prev]);
          })
          .catch((err: unknown) =>
            setEventsError(err instanceof Error ? err.message : 'Recording failed.'),
          )
          .finally(() => setRecordBusy(false));
      }}
      onOpenSettings={() => {
        setPtzOpen(false);
        setSettingsOpen(true);
      }}
      onSelectEvent={chooseEvent}
    />
  );

  const ptzPanel = hasPtz ? (
    <CameraPtzPanel
      controls={ptzAvailability}
      disabled={disabled || Boolean(selectedRecording)}
      onPress={(key) => {
        const target = ptzButtons?.[key];
        if (target && availableAction(snapshot, target.entity_id, 'press')) {
          onControl(target.entity_id, 'press');
        }
      }}
    />
  ) : undefined;

  return (
    <CameraModalView
      title={title}
      roomName={area?.name}
      statusTag={statusTag}
      view={view}
      hasSelection={Boolean(selectedRecording)}
      dayLabel={dayLabel}
      canGoNext={canGoNext}
      playing={playing}
      muted={muted}
      muteDisabled={demo || (!selectedRecording && liveState !== 'playing')}
      fill={fill}
      hasPtz={hasPtz}
      ptzOpen={ptzOpen}
      settingsOpen={settingsOpen}
      viewport={viewport}
      overlayTimeline={overlayTimeline}
      eventsSheet={eventsSheet}
      ptzPanel={ptzPanel}
      settingsPanel={
        <CameraSettingsTabContent
          cameraId={cameraId}
          title={title}
          cameraEntity={cameraEntity}
          cameraAccessory={cameraAccessory}
          roomName={area?.name}
          snapshot={snapshot}
          preferences={preferences}
          allAccessories={allAccessories}
          relatedEntities={relatedEntities}
          demo={demo}
          settings={settings}
          onSettingsChange={setSettings}
          cameraApi={cameraApi}
          onControl={onControl}
          onPreferencesPatch={onPreferencesPatch}
        />
      }
      onSelectView={(nextView) => {
        setView(nextView);
        if (nextView === 'live') {
          setSelectedRecording(undefined);
        }
      }}
      onPrevDay={() => setDay((prev) => shiftCameraDay(prev, -1))}
      onNextDay={() => {
        if (canGoNext) setDay((prev) => shiftCameraDay(prev, 1));
      }}
      onTogglePlay={() => setPlaying((prev) => !prev)}
      onTogglePtz={() => {
        setSettingsOpen(false);
        setPtzOpen((prev) => !prev);
      }}
      onToggleMute={() => setMuted((prev) => !prev)}
      onToggleFill={() => setFill((prev) => !prev)}
      onToggleSettings={() => {
        setPtzOpen(false);
        setSettingsOpen((prev) => !prev);
      }}
      onDismissDrawers={() => {
        setPtzOpen(false);
        setSettingsOpen(false);
      }}
      onClose={onClose}
    />
  );
}
