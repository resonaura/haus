import { CameraAmbilight } from './CameraAmbilight';

import { CameraTalk } from './CameraTalk';
import { CameraPtzControls } from './CameraPtzControls';
import { SnapshotAge, cameraImage } from './CameraCard';
import { deviceDisplayName } from '../../model/device-name';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import {
  Settings2,
  Video,
  Play,
  Pause,
  Expand,
  Minimize,
  Scan,
  Shrink,
  LoaderCircle,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCameraLiveStream } from './useCameraLiveStream';
import { useCameraHandoff, useRetainedLive } from './useCameraHandoff';
const CameraDeviceSettings = lazy(() =>
  import('./CameraDeviceSettings').then((module) => ({ default: module.CameraDeviceSettings })),
);
import { type HassEntity, type HausAccessory } from '../../model';
import { message, type Action } from '../../hooks/useHaus';

import { SmoothImage } from '../../components/ui/SmoothImage';
import { useDelayedPending } from '../../hooks/useDelayedPending';
import { CameraTimeline, type CameraEvent } from './CameraTimeline';
import { recordingSeek } from '../../model/camera-history';

export function CameraModal({
  entity,
  demo,
  onClose,
  serverUrl,
  room,
  talkProviderHint,
  related,
  onAction,
  onOpenRelated,
  hiddenFromHome,
  hiddenFromApp,
  onToggleHomeVisibility,
  onToggleAppVisibility,
}: {
  entity: HassEntity;
  demo: boolean;
  onClose: () => void;
  serverUrl?: string;
  room?: string;
  talkProviderHint?: 'eufy';
  related: HausAccessory[];
  onAction: (action: Action) => Promise<void>;
  onOpenRelated: (entityId: string) => void;
  hiddenFromHome: boolean;
  hiddenFromApp: boolean;
  onToggleHomeVisibility: () => void;
  onToggleAppVisibility: () => void;
}) {
  const [calendarHost, setCalendarHost] = useState<HTMLDivElement | null>(null);
  const pendingSeek = useRef<{ seconds: number; playing: boolean } | null>(null);
  const desiredPlayback = useRef(true);
  const video = useRef<HTMLVideoElement>(null);
  const rtcVideo = useRef<HTMLVideoElement>(null);
  const relayVideo = useRef<HTMLVideoElement>(null);
  const [liveTransport, setLiveTransport] = useState<'rtc' | 'hls'>('rtc');
  const viewer = useRef<HTMLDivElement>(null);
  const [fill, setFill] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const update = () =>
      setFullscreen(document.fullscreenElement === viewer.current?.closest('.camera-dialog'));
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  const recordedVideo = useRef<HTMLVideoElement>(null);
  const sourceAvailable = demo || !['unavailable', 'unknown', 'off'].includes(entity.state);
  const [streamState, setStreamState] = useState(
    demo ? 'Demo preview' : sourceAvailable ? 'Connecting' : 'Offline',
  );
  const [error, setError] = useState(sourceAvailable ? '' : 'Camera is offline.');
  useEffect(() => {
    if (!sourceAvailable) {
      setStreamState('Offline');
      setError('Camera is offline.');
    }
  }, [sourceAvailable]);
  const [muted, setMuted] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  useEffect(() => {
    if (!controlsOpen) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role="listbox"]')) return;
      event.stopPropagation();
      setControlsOpen(false);
    };
    document.addEventListener('keydown', dismiss, true);
    return () => document.removeEventListener('keydown', dismiss, true);
  }, [controlsOpen]);
  const [videoReady, setVideoReady] = useState(false);
  const [view, setView] = useState<'live' | 'events'>('live');
  const [endedId, setEndedId] = useState<string>();
  const [playback, setPlayback] = useState({ seconds: 0, duration: 0, playing: false });
  const [recording, setRecording] = useState<CameraEvent>();
  const [recordingReady, setRecordingReady] = useState(false);
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  const liveEnabled = useRetainedLive(
    view === 'live' && !demo && sourceAvailable,
    Boolean(recording),
  );
  const liveMuted = useRef(true);
  liveMuted.current = muted || Boolean(recording) || view !== 'live';
  const livePresented = useRef(true);
  livePresented.current = view === 'live' && !recording;
  const handoff = useCameraHandoff(recording ? recordingReady : liveEnabled && videoReady);
  const captureFrame = handoff.capture;
  const chooseRecording = useCallback(
    (next: CameraEvent | undefined, preserveSeek = false) => {
      if (next?.id !== recordingRef.current?.id) {
        if (!preserveSeek) pendingSeek.current = null;
        captureFrame(recordingRef.current ? recordedVideo.current : video.current);
        setRecordingReady(false);
      }
      setRecording(next);
    },
    [captureFrame],
  );
  const recordingHasAudio = recording?.playbackInfo?.audio !== false;
  const [recordingError, setRecordingError] = useState('');
  const [recordingWaiting, setRecordingWaiting] = useState(false);
  const slowRecording = useDelayedPending(
    Boolean(recording) && recordingWaiting && !recordingError,
  );
  useEffect(() => {
    desiredPlayback.current = pendingSeek.current?.playing ?? true;
    setRecordingReady(false);
    setRecordingWaiting(Boolean(recording));
    setRecordingError('');
    setEndedId(undefined);
    setPlayback({
      seconds: pendingSeek.current?.seconds ?? 0,
      duration: recording?.duration ?? 0,
      playing: false,
    });
  }, [recording?.id]);
  const [retry, setRetry] = useState(0);
  const applyPendingSeek = (element: HTMLVideoElement) => {
    const next = pendingSeek.current;
    if (recordedVideo.current !== element || !next || element.readyState < 1 || element.seeking)
      return false;
    pendingSeek.current = null;
    element.pause();
    element.currentTime = recordingSeek(next.seconds, element.duration);
    return true;
  };
  const awaitRecordingFrame = (element: HTMLVideoElement) => {
    element.requestVideoFrameCallback(() => {
      if (recordedVideo.current !== element || element.seeking || !element.videoWidth) return;
      setRecordingReady(true);
      setRecordingWaiting(false);
    });
  };
  const [still, setStill] = useState('');
  const [cachedStill, setCachedStill] = useState(false);
  const freshStill = useRef(false);
  useEffect(() => {
    let active = true;
    if (!demo)
      void window.hausNative
        ?.cameraLastSnapshot?.(entity.entity_id)
        .then((frame) => {
          if (active && frame && !freshStill.current) {
            setStill((old) => old || frame.image);
            setStillUpdatedAt(frame.receivedAt);
            setCachedStill(true);
          }
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [entity.entity_id, demo]);
  const [stillUpdatedAt, setStillUpdatedAt] = useState(0);
  const displayedStill = useRef('');
  useCameraLiveStream({
    entityId: entity.entity_id,
    enabled: liveEnabled,
    serverUrl,
    retry,
    video,
    rtcVideo,
    relayVideo,
    mutedRef: liveMuted,
    presentedRef: livePresented,
    freshStill,
    displayedStill,
    retainFrame: handoff.retain,
    setLiveTransport,
    setVideoReady,
    setStreamState,
    setError,
    setStill,
    setStillUpdatedAt,
    setRetry,
  });
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop
        variant="blur"
        isDismissable={!controlsOpen}
        onPointerDownCapture={(event) => {
          const target = event.target;
          if (
            controlsOpen &&
            target instanceof Element &&
            event.currentTarget.contains(target) &&
            !target.closest('.camera-settings-drawer, .camera-settings-trigger')
          ) {
            event.stopPropagation();
            setControlsOpen(false);
          }
        }}
      >
        <Modal.Container size="cover" className="camera-modal-container">
          <Modal.Dialog
            className="camera-dialog camera-viewer"
            data-camera-view={view}
            data-video-fill={fill}
          >
            <Modal.CloseTrigger />
            <Button
              isIconOnly
              variant="ghost"
              className="camera-settings-trigger"
              aria-label="Camera settings"
              aria-expanded={controlsOpen}
              onPress={() => setControlsOpen((value) => !value)}
            >
              <Settings2 size={19} />
            </Button>
            <Modal.Header className="camera-modal-header">
              <div className="camera-modal-title">
                {room && <small className="camera-modal-room">{room}</small>}
                <Modal.Heading>
                  {deviceDisplayName(
                    String(entity.attributes.friendly_name ?? 'Camera'),
                    room,
                    'Camera',
                  )}
                </Modal.Heading>
              </div>
              <div className="camera-view-picker" aria-label="Camera view">
                <Button
                  variant="ghost"
                  aria-pressed={view === 'live'}
                  onPress={() => {
                    setView('live');
                    chooseRecording(undefined);
                  }}
                >
                  Live
                </Button>
                <Button
                  variant="ghost"
                  aria-pressed={view === 'events'}
                  onPress={() => setView('events')}
                >
                  Events
                </Button>
              </div>
              <div className="camera-calendar-host" ref={setCalendarHost} />
            </Modal.Header>
            <Modal.Body className="camera-modal-body">
              <div
                ref={viewer}
                className={`camera-stage ${view === 'live' ? 'is-live-view' : 'is-events-view'}`}
              >
                {view === 'events' && !recording && (
                  <div className="camera-history-placeholder">
                    <Video size={32} />
                    <p>Choose a recorded moment</p>
                  </div>
                )}
                {(view === 'live' || recording) && (
                  <div className="camera-live-panel">
                    {!fill && (
                      <CameraAmbilight
                        video={recording ? recordedVideo : video}
                        still={
                          recording ? undefined : still || (demo ? cameraImage(entity) : undefined)
                        }
                      />
                    )}
                    <div
                      className={`camera-player ${recording ? 'is-history' : ''}`}
                      data-live-running={liveEnabled || undefined}
                    >
                      {recording && (
                        <video
                          key={recording.id}
                          ref={recordedVideo}
                          className="camera-recorded-video"
                          src={`haus-media://recordings/${recording.id}/video?format=1`}
                          poster={`haus-media://recordings/${recording.id}/thumbnail`}
                          autoPlay={pendingSeek.current?.playing ?? desiredPlayback.current}
                          preload="auto"
                          playsInline
                          controls={false}
                          muted={muted}
                          onTimeUpdate={(event) => {
                            const { currentTime, duration } = event.currentTarget;
                            setPlayback((old) =>
                              Math.floor(old.seconds) === Math.floor(currentTime)
                                ? old
                                : {
                                    ...old,
                                    seconds: currentTime,
                                    duration: Number.isFinite(duration)
                                      ? duration
                                      : recording.duration,
                                  },
                            );
                          }}
                          onPlay={() => setPlayback((old) => ({ ...old, playing: true }))}
                          onPlaying={() => setRecordingWaiting(false)}
                          onWaiting={() => setRecordingWaiting(true)}
                          onPause={() => setPlayback((old) => ({ ...old, playing: false }))}
                          onEnded={() => setEndedId(recording.id)}
                          data-ready={recordingReady || undefined}
                          onLoadedMetadata={(event) => {
                            applyPendingSeek(event.currentTarget);
                          }}
                          onSeeked={(event) => {
                            if (recordedVideo.current !== event.currentTarget) return;
                            if (applyPendingSeek(event.currentTarget)) return;
                            awaitRecordingFrame(event.currentTarget);
                            if (desiredPlayback.current)
                              void event.currentTarget.play().catch(() => {});
                            else event.currentTarget.pause();
                          }}
                          onLoadedData={(event) => {
                            awaitRecordingFrame(event.currentTarget);
                          }}
                          onError={(event) => {
                            setRecordingWaiting(false);
                            setRecordingError(
                              event.currentTarget.error?.code === 2
                                ? 'The recording connection was interrupted. Choose the moment again to retry.'
                                : 'This recording could not be decoded. Choose the moment again to retry.',
                            );
                          }}
                        />
                      )}
                      {demo ? (
                        <SmoothImage src={cameraImage(entity)} alt="Demo camera still" />
                      ) : (
                        <>
                          <video
                            ref={rtcVideo}
                            data-transport="rtc"
                            autoPlay
                            playsInline
                            muted={liveTransport === 'rtc' ? liveMuted.current : true}
                            data-ready={
                              (!recording &&
                                liveEnabled &&
                                liveTransport === 'rtc' &&
                                videoReady) ||
                              undefined
                            }
                          />
                          <video
                            ref={relayVideo}
                            data-transport="hls"
                            autoPlay
                            playsInline
                            muted={liveTransport === 'hls' ? liveMuted.current : true}
                            data-ready={
                              (!recording &&
                                liveEnabled &&
                                liveTransport === 'hls' &&
                                videoReady) ||
                              undefined
                            }
                          />
                          {still && (
                            <SmoothImage
                              className={`camera-still ${cachedStill ? 'is-cached-preview' : ''} ${recording || (liveEnabled && videoReady && streamState !== 'Snapshot') ? 'is-obscured' : ''}`}
                              src={still}
                              alt="Latest camera snapshot"
                              onLoad={() => {
                                displayedStill.current = still;
                                setCachedStill(!freshStill.current);
                                if (freshStill.current) setStillUpdatedAt(Date.now());
                              }}
                            />
                          )}
                        </>
                      )}
                      <canvas
                        ref={handoff.canvas}
                        className="camera-handoff-frame"
                        aria-hidden="true"
                        data-captured={handoff.captured || undefined}
                        data-visible={
                          (handoff.captured &&
                            (recording || streamState !== 'Snapshot') &&
                            (handoff.holding ||
                              !(recording ? recordingReady : liveEnabled && videoReady))) ||
                          undefined
                        }
                      />
                      {!recording && streamState.startsWith('Connecting') && (
                        <div className="camera-loading">
                          <LoaderCircle size={26} className="spin" />
                          <span>Connecting to your camera…</span>
                        </div>
                      )}
                      {slowRecording && (
                        <div className="camera-loading">
                          <LoaderCircle size={24} className="spin" />
                          <span>Preparing your recording…</span>
                        </div>
                      )}
                      {!recording && (demo || streamState === 'Snapshot') && (
                        <span className="player-tag">
                          {demo ? (
                            'DEMO · STILL IMAGE'
                          ) : streamState === 'Snapshot' ? (
                            <SnapshotAge updatedAt={stillUpdatedAt} />
                          ) : (
                            streamState
                          )}
                        </span>
                      )}
                    </div>
                    <div className="camera-toolbar">
                      {recording && (
                        <Button
                          isIconOnly
                          variant="ghost"
                          aria-label={playback.playing ? 'Pause recording' : 'Play recording'}
                          onPress={() => {
                            const element = recordedVideo.current;
                            if (!element) return;
                            desiredPlayback.current = element.paused;
                            if (element.paused) void element.play().catch(() => {});
                            else element.pause();
                          }}
                        >
                          {playback.playing ? <Pause size={19} /> : <Play size={19} />}
                        </Button>
                      )}
                      {!recording && (
                        <CameraPtzControls
                          entities={[
                            ...new Map(
                              related
                                .flatMap((accessory) => [
                                  accessory.state,
                                  ...accessory.secondaryEntities,
                                ])
                                .map((item) => [item.entity_id, item]),
                            ).values(),
                          ]}
                          onAction={onAction}
                          onError={(reason) => setError(message(reason))}
                        />
                      )}
                      {!recording && (
                        <CameraTalk
                          cameraId={entity.entity_id}
                          demo={demo}
                          providerHint={talkProviderHint}
                        />
                      )}
                      <Button
                        isIconOnly
                        variant="ghost"
                        aria-label={
                          !recordingHasAudio
                            ? 'No audio was recorded'
                            : muted
                              ? 'Unmute camera'
                              : 'Mute camera'
                        }
                        onPress={() => setMuted((v) => !v)}
                        isDisabled={
                          demo ||
                          !recordingHasAudio ||
                          (!recording && !streamState.startsWith('Live'))
                        }
                      >
                        {muted || !recordingHasAudio ? (
                          <VolumeX size={20} />
                        ) : (
                          <Volume2 size={20} />
                        )}
                      </Button>
                      <span>
                        {demo
                          ? 'Sample imagery · Connect your home for live video'
                          : error || 'A little peace of mind.'}
                      </span>
                      <Button
                        isIconOnly
                        variant="ghost"
                        aria-label={fill ? 'Fit video inside viewer' : 'Fill viewer with video'}
                        aria-pressed={fill}
                        onPress={() => setFill((value) => !value)}
                      >
                        {fill ? <Shrink size={19} /> : <Scan size={19} />}
                      </Button>
                      <Button
                        isIconOnly
                        variant="ghost"
                        aria-label={fullscreen ? 'Exit full screen' : 'Full screen camera'}
                        onPress={() => {
                          const operation = document.fullscreenElement
                            ? document.exitFullscreen()
                            : (
                                viewer.current?.closest('.camera-dialog') as HTMLElement | null
                              )?.requestFullscreen();
                          void operation?.catch((reason) => setError(message(reason)));
                        }}
                      >
                        {fullscreen ? <Minimize size={19} /> : <Expand size={19} />}
                      </Button>
                    </div>
                  </div>
                )}
                <CameraTimeline
                  calendarHost={calendarHost}
                  onScrub={(event, seconds, playing) => {
                    desiredPlayback.current = playing;
                    pendingSeek.current = { seconds, playing };
                    const element = recordedVideo.current;
                    if (recording?.id === event.id && element && element.readyState >= 1) {
                      applyPendingSeek(element);
                      setPlayback((old) => ({ ...old, seconds, playing }));
                    } else {
                      chooseRecording(event, true);
                      setPlayback((old) => ({ ...old, seconds, playing }));
                    }
                  }}
                  cameraId={entity.entity_id}
                  demo={demo}
                  expanded={view === 'events'}
                  selected={recording}
                  endedId={endedId}
                  playback={playback}
                  playbackElement={recordedVideo}
                  playbackIntent={desiredPlayback.current}
                  onTogglePlayback={() => {
                    const element = recordedVideo.current;
                    if (element) {
                      desiredPlayback.current = element.paused;
                      if (element.paused)
                        void element.play().catch((reason) => setRecordingError(message(reason)));
                      else element.pause();
                    }
                  }}
                  onSelectionChange={chooseRecording}
                />
              </div>
              {(recording ? recordingError : error) && (
                <div className="recording-error camera-playback-error" role="alert">
                  <span>{recording ? recordingError : error}</span>
                  <Button
                    variant="danger"
                    onPress={() => {
                      if (!recording) {
                        setError('');
                        setRetry((value) => value + 1);
                        return;
                      }
                      setRecordingError('');
                      setRecordingReady(false);
                      setRecordingWaiting(true);
                      recordedVideo.current?.load();
                      if (desiredPlayback.current)
                        void recordedVideo.current?.play().catch(() => {});
                    }}
                  >
                    Retry
                  </Button>
                </div>
              )}
              {controlsOpen && (
                <Suspense
                  fallback={
                    <aside className="camera-settings-drawer" role="status">
                      Loading camera controls…
                    </aside>
                  }
                >
                  <CameraDeviceSettings
                    entity={entity}
                    related={related}
                    hiddenFromHome={hiddenFromHome}
                    hiddenFromApp={hiddenFromApp}
                    onToggleHomeVisibility={onToggleHomeVisibility}
                    onToggleAppVisibility={onToggleAppVisibility}
                    onAction={onAction}
                    onOpenRelated={onOpenRelated}
                    onError={(reason) => setError(message(reason))}
                  />
                </Suspense>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
