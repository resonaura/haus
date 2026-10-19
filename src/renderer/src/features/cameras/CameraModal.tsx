import { CameraDeviceSettings } from './CameraDeviceSettings';
import { CameraTalk } from './CameraTalk';
import { SnapshotAge, cameraImage } from './CameraCard';
import { deviceDisplayName } from '../../model/device-name';
import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import {
  Download,
  Settings2,
  Video,
  Play,
  Pause,
  Expand,
  LoaderCircle,
  RefreshCw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import Hls from 'hls.js';
import { type HassEntity, type HausAccessory } from '../../model';
import { message, type Action } from '../../hooks/useHaus';

import { SmoothImage } from '../../components/ui/SmoothImage';
import { useDelayedPending } from '../../hooks/useDelayedPending';
import { CameraTimeline, type CameraEvent } from './CameraTimeline';

interface Signal {
  type: 'session' | 'answer' | 'candidate' | 'error';
  session_id?: string;
  answer?: string;
  candidate?: RTCIceCandidateInit;
  message?: string;
}

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
  const pendingSeek = useRef<number | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const player = useRef<HTMLDivElement>(null);
  const recordedVideo = useRef<HTMLVideoElement>(null);
  const [streamState, setStreamState] = useState(demo ? 'Demo preview' : 'Connecting');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [view, setView] = useState<'live' | 'events'>('live');
  const [endedId, setEndedId] = useState<string>();
  const [playback, setPlayback] = useState({ seconds: 0, duration: 0, playing: false });
  const [recording, setRecording] = useState<CameraEvent>();
  const [recordingReady, setRecordingReady] = useState(false);
  const [recordingError, setRecordingError] = useState('');
  const [recordingWaiting, setRecordingWaiting] = useState(false);
  const slowRecording = useDelayedPending(
    Boolean(recording) && recordingWaiting && !recordingError,
  );
  useEffect(() => {
    setRecordingReady(false);
    setRecordingWaiting(Boolean(recording));
    setRecordingError('');
    setEndedId(undefined);
    setPlayback({
      seconds: pendingSeek.current ?? 0,
      duration: recording?.duration ?? 0,
      playing: false,
    });
  }, [recording?.id]);
  const [retry, setRetry] = useState(0);
  const [still, setStill] = useState('');
  const [stillUpdatedAt, setStillUpdatedAt] = useState(0);
  const displayedStill = useRef('');
  useEffect(() => {
    if (view !== 'live' || recording || demo || !window.hausNative || !serverUrl) return;
    const api = window.hausNative;
    let closed = false;
    const warming = api
      .helper<{ streamPath?: string }>({
        method: 'POST',
        path: `/api/cameras/${entity.entity_id}/warm`,
        data: { active: true },
      })
      .catch(() => undefined);
    const warmHeartbeat = setInterval(() => {
      if (document.visibilityState === 'visible')
        void api
          .helper({
            method: 'POST',
            path: `/api/cameras/${entity.entity_id}/warm`,
            data: { active: true },
          })
          .catch(() => {});
    }, 20000);
    let peer: RTCPeerConnection | undefined;
    let off: (() => void) | undefined;
    let hls: Hls | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let fallbackStarted = false;
    let sessionId: string | undefined;
    const candidates: RTCIceCandidateInit[] = [];
    const remoteCandidates: RTCIceCandidateInit[] = [];
    const snapshot = () =>
      void api
        .cameraSnapshot(entity.entity_id)
        .then((url) => {
          if (!closed) {
            setStill(url);
            if (displayedStill.current === url) setStillUpdatedAt(Date.now());
          }
        })
        .catch((e) => {
          if (!closed) setError(message(e));
        });
    const stopRtc = () => {
      peer?.close();
      peer = undefined;
      off?.();
      off = undefined;
      clearTimeout(timeout);
    };
    const fallback = async () => {
      if (closed || fallbackStarted) return;
      fallbackStarted = true;
      stopRtc();
      setStreamState('Loading stream');
      try {
        let warmTimeout: ReturnType<typeof setTimeout> | undefined;
        const relay = await Promise.race([
          warming,
          new Promise<undefined>((resolve) => {
            warmTimeout = setTimeout(() => resolve(undefined), 2500);
          }),
        ]);
        clearTimeout(warmTimeout);
        const stream =
          relay?.streamPath === `/api/cameras/${entity.entity_id}/live/index.m3u8`
            ? { url: `haus-media://streams/${entity.entity_id}/index.m3u8` }
            : await api.request<{ url: string }>({
                type: 'camera/stream',
                entity_id: entity.entity_id,
                format: 'hls',
              });
        if (closed) return;
        const url = new URL(stream.url, serverUrl);
        if (
          !(
            url.protocol === 'haus-media:' &&
            url.hostname === 'streams' &&
            url.pathname === `/${entity.entity_id}/index.m3u8`
          ) &&
          (url.origin !== new URL(serverUrl).origin || !url.pathname.startsWith('/api/'))
        )
          throw new Error('The camera returned an unexpected stream address.');
        if (!video.current) return;
        if (Hls.isSupported()) {
          hls = new Hls({ enableWorker: true, lowLatencyMode: true });
          hls.loadSource(url.href);
          hls.attachMedia(video.current);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (!closed) {
              setStreamState('Live · HLS');
              void video.current?.play().catch(() => {});
            }
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal && !closed) {
              hls?.destroy();
              setStreamState('Snapshot');
              setError('Live video is unavailable. Showing the latest snapshot.');
              snapshot();
              poll ??= setInterval(snapshot, 15000);
            }
          });
        } else if (video.current.canPlayType('application/vnd.apple.mpegurl')) {
          video.current.src = url.href;
          await video.current.play();
          setStreamState('Live · HLS');
        } else throw new Error('This stream format is unavailable.');
      } catch {
        if (!closed) {
          setStreamState('Snapshot');
          setError('Live video is unavailable. Showing the latest snapshot.');
          snapshot();
          poll ??= setInterval(snapshot, 15000);
        }
      }
    };
    const start = async () => {
      setVideoReady(false);
      snapshot();
      setError('');
      setStreamState('Connecting');
      try {
        const capabilities = await api.request<{ frontend_stream_types?: string[] }>({
          type: 'camera/capabilities',
          entity_id: entity.entity_id,
        });
        if (closed) return;
        if (!capabilities.frontend_stream_types?.includes('web_rtc')) {
          await fallback();
          return;
        }
        const config = await api
          .request<{ configuration?: RTCConfiguration; dataChannel?: string }>({
            type: 'camera/webrtc/get_client_config',
            entity_id: entity.entity_id,
          })
          .catch(() => ({ configuration: {} }));
        if (closed) return;
        const pc = new RTCPeerConnection(config.configuration ?? {});
        peer = pc;
        if ('dataChannel' in config && typeof config.dataChannel === 'string')
          pc.createDataChannel(config.dataChannel);
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });
        const incoming = new MediaStream();
        pc.ontrack = (e) => {
          if (!closed && video.current) {
            // Some cameras deliver streamless audio/video tracks separately.
            // Keep one stream so the audio event cannot replace the video track.
            if (!incoming.getTracks().some((track) => track.id === e.track.id))
              incoming.addTrack(e.track);
            video.current.srcObject = incoming;
            void video.current.play().catch(() => {});
          }
        };
        const sendCandidate = (candidate: RTCIceCandidateInit) =>
          void api
            .request({
              type: 'camera/webrtc/candidate',
              entity_id: entity.entity_id,
              session_id: sessionId,
              candidate,
            })
            .catch(() => {});
        pc.onicecandidate = (e) => {
          if (e.candidate) {
            const value = e.candidate.toJSON();
            if (sessionId) sendCandidate(value);
            else candidates.push(value);
          }
        };
        pc.onconnectionstatechange = () => {
          if (closed) return;
          if (pc.connectionState === 'connected') {
            clearTimeout(timeout);
            setStreamState('Live · WebRTC');
            setError('');
          } else if (['failed', 'disconnected'].includes(pc.connectionState)) void fallback();
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const cleanup = await api.subscribe<Signal>(
          { type: 'camera/webrtc/offer', entity_id: entity.entity_id, offer: offer.sdp },
          (event) => {
            if (closed || peer !== pc) return;
            if (event.type === 'session') {
              sessionId = event.session_id;
              for (const candidate of candidates.splice(0)) sendCandidate(candidate);
            } else if (event.type === 'answer' && event.answer) {
              void pc
                .setRemoteDescription({ type: 'answer', sdp: event.answer })
                .then(async () => {
                  for (const c of remoteCandidates.splice(0)) await pc.addIceCandidate(c);
                })
                .catch(() => void fallback());
            } else if (event.type === 'candidate' && event.candidate) {
              if (pc.remoteDescription) void pc.addIceCandidate(event.candidate).catch(() => {});
              else remoteCandidates.push(event.candidate);
            } else if (event.type === 'error') void fallback();
          },
        );
        if (closed || peer !== pc) cleanup();
        else off = cleanup;
        if (!closed && peer === pc) timeout = setTimeout(() => void fallback(), 12000);
      } catch {
        await fallback();
      }
    };
    void start();
    return () => {
      closed = true;
      clearInterval(warmHeartbeat);
      void api
        .helper({
          method: 'POST',
          path: `/api/cameras/${entity.entity_id}/warm`,
          data: { active: false },
        })
        .catch(() => {});
      stopRtc();
      hls?.destroy();
      clearInterval(poll);
      const element = video.current;
      if (element) {
        element.pause();
        element.srcObject = null;
        element.removeAttribute('src');
        element.load();
      }
    };
  }, [entity.entity_id, demo, serverUrl, retry, recording?.id, view]);
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container size="cover" className="camera-modal-container">
          <Modal.Dialog className="camera-dialog camera-viewer" data-camera-view={view}>
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
                    setRecording(undefined);
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
                className={`camera-stage ${view === 'live' ? 'is-live-view' : 'is-events-view'}`}
                ref={player}
              >
                {view === 'events' && !recording && (
                  <div className="camera-history-placeholder">
                    <Video size={32} />
                    <p>Choose a recorded moment</p>
                  </div>
                )}
                {(view === 'live' || recording) && (
                  <div className="camera-live-panel">
                    <div className={`camera-player ${recording ? 'is-history' : ''}`}>
                      {recording && (
                        <video
                          key={recording.id}
                          ref={recordedVideo}
                          className="camera-recorded-video"
                          src={`haus-media://recordings/${recording.id}/video?format=1`}
                          poster={`haus-media://recordings/${recording.id}/thumbnail`}
                          autoPlay
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
                          onLoadedMetadata={() => {
                            if (pendingSeek.current !== null && recordedVideo.current) {
                              recordedVideo.current.currentTime = pendingSeek.current;
                              recordedVideo.current.pause();
                              pendingSeek.current = null;
                            }
                          }}
                          onLoadedData={() => {
                            setRecordingReady(true);
                            setRecordingWaiting(false);
                          }}
                          onError={(event) => {
                            setRecordingWaiting(false);
                            setRecordingError(
                              event.currentTarget.error?.code === 2
                                ? 'The recording connection was interrupted. Choose the moment again to retry.'
                                : 'This recording could not be decoded. Try another moment or download the clip.',
                            );
                          }}
                        />
                      )}
                      {!recording &&
                        (demo ? (
                          <SmoothImage src={cameraImage(entity)} alt="Demo camera still" />
                        ) : (
                          <>
                            <video
                              ref={video}
                              autoPlay
                              playsInline
                              muted={muted}
                              data-ready={videoReady || undefined}
                              onPlaying={() => setVideoReady(true)}
                            />
                            {still && (
                              <SmoothImage
                                className={`camera-still ${videoReady && streamState !== 'Snapshot' ? 'is-obscured' : ''}`}
                                src={still}
                                alt="Latest camera snapshot"
                                onLoad={() => {
                                  displayedStill.current = still;
                                  setStillUpdatedAt(Date.now());
                                }}
                              />
                            )}
                          </>
                        ))}
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
                            if (element.paused) void element.play().catch(() => {});
                            else element.pause();
                          }}
                        >
                          {playback.playing ? <Pause size={19} /> : <Play size={19} />}
                        </Button>
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
                        aria-label={muted ? 'Unmute camera' : 'Mute camera'}
                        onPress={() => setMuted((v) => !v)}
                        isDisabled={demo || (!recording && !streamState.startsWith('Live'))}
                      >
                        {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                      </Button>
                      <span>
                        {demo
                          ? 'Sample imagery · Connect your home for live video'
                          : error || 'A little peace of mind.'}
                      </span>
                      {!recording && (
                        <Button
                          isIconOnly
                          variant="ghost"
                          aria-label="Reconnect camera"
                          onPress={() => setRetry((v) => v + 1)}
                          isDisabled={demo}
                        >
                          <RefreshCw size={18} />
                        </Button>
                      )}
                      <Button
                        isIconOnly
                        variant="ghost"
                        aria-label={recording ? 'Download recording' : 'Save camera snapshot'}
                        onPress={() => {
                          if (recording) {
                            void window.hausNative
                              ?.saveRecording(recording.id)
                              .catch((reason) => setRecordingError(message(reason)));
                            return;
                          }
                          const url = demo ? cameraImage(entity) : still;
                          if (url) {
                            const link = document.createElement('a');
                            link.href = url;
                            link.download = `${entity.entity_id}.jpg`;
                            link.click();
                          }
                        }}
                      >
                        <Download size={18} />
                      </Button>
                      <Button
                        isIconOnly
                        variant="ghost"
                        aria-label="Full screen camera"
                        onPress={() => void player.current?.requestFullscreen()}
                      >
                        <Expand size={19} />
                      </Button>
                    </div>
                  </div>
                )}
                <CameraTimeline
                  calendarHost={calendarHost}
                  onScrub={(event, seconds) => {
                    if (recording?.id === event.id && recordedVideo.current) {
                      recordedVideo.current.pause();
                      recordedVideo.current.currentTime = seconds;
                      setPlayback((old) => ({ ...old, seconds, playing: false }));
                    } else {
                      pendingSeek.current = seconds;
                      setRecording(event);
                    }
                  }}
                  cameraId={entity.entity_id}
                  demo={demo}
                  expanded={view === 'events'}
                  selected={recording}
                  endedId={endedId}
                  playback={playback}
                  playbackElement={recordedVideo}
                  onTogglePlayback={() => {
                    const element = recordedVideo.current;
                    if (element) {
                      if (element.paused)
                        void element.play().catch((reason) => setRecordingError(message(reason)));
                      else element.pause();
                    }
                  }}
                  onSelectionChange={setRecording}
                />
              </div>
              {recordingError && (
                <div className="recording-error" role="alert">
                  <span>{recordingError}</span>
                  <Button
                    variant="ghost"
                    onPress={() => {
                      setRecordingError('');
                      setRecordingReady(false);
                      setRecordingWaiting(true);
                      recordedVideo.current?.load();
                      void recordedVideo.current?.play().catch(() => {});
                    }}
                  >
                    Retry
                  </Button>
                </div>
              )}
              {controlsOpen && (
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
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
