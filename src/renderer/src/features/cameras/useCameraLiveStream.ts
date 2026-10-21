import { useEffect, type RefObject, type Dispatch, type SetStateAction } from 'react';
import type Hls from 'hls.js';
import { message } from '../../hooks/useHaus';
import { LiveProgress } from './live-progress';
import { LiveHlsRecovery } from './live-hls-recovery';

interface Signal {
  type: 'session' | 'answer' | 'candidate' | 'error';
  session_id?: string;
  answer?: string;
  candidate?: RTCIceCandidateInit;
  message?: string;
}
interface LiveStreamOptions {
  entityId: string;
  enabled: boolean;
  serverUrl?: string;
  retry: number;
  video: RefObject<HTMLVideoElement | null>;
  rtcVideo: RefObject<HTMLVideoElement | null>;
  relayVideo: RefObject<HTMLVideoElement | null>;
  mutedRef: RefObject<boolean>;
  presentedRef: RefObject<boolean>;
  freshStill: RefObject<boolean>;
  displayedStill: RefObject<string>;
  setLiveTransport: (value: 'rtc' | 'hls') => void;
  setVideoReady: (value: boolean) => void;
  setStreamState: (value: string) => void;
  setError: (value: string) => void;
  setStill: (value: string) => void;
  setStillUpdatedAt: (value: number) => void;
  setRetry: Dispatch<SetStateAction<number>>;
}

/** Race independent decoders, retain the last picture and release every session on dismissal. */
export function useCameraLiveStream({
  entityId,
  enabled,
  serverUrl,
  retry,
  video,
  rtcVideo,
  relayVideo,
  mutedRef,
  presentedRef,
  freshStill,
  displayedStill,
  setLiveTransport,
  setVideoReady,
  setStreamState,
  setError,
  setStill,
  setStillUpdatedAt,
  setRetry,
}: LiveStreamOptions) {
  useEffect(() => {
    if (!enabled || !window.hausNative || !serverUrl) {
      setVideoReady(false);
      return;
    }
    const api = window.hausNative;
    const rtcElement = rtcVideo.current;
    const relayElement = relayVideo.current;
    if (!rtcElement || !relayElement) return;
    video.current = rtcElement;
    rtcElement.muted = mutedRef.current;
    relayElement.muted = true;
    setLiveTransport('rtc');
    let winner: 'rtc' | 'hls' | undefined;
    let closed = false;
    const negotiationDeadline = performance.now() + 25000;
    const progress = new LiveProgress();
    progress.reset(performance.now());
    let activeFrame = 0;
    let activeElement: HTMLVideoElement | undefined;
    let lastRelayTime = 0;
    const observeFrames = (element: HTMLVideoElement) => {
      if (activeFrame && activeElement) activeElement.cancelVideoFrameCallback(activeFrame);
      activeElement = element;
      progress.reset(performance.now());
      const onFrame: VideoFrameRequestCallback = (now, metadata) => {
        activeFrame = 0;
        if (closed || activeElement !== element) return;
        progress.frame(metadata.mediaTime, now);
        if (element === relayElement) lastRelayTime = metadata.mediaTime;
        activeFrame = element.requestVideoFrameCallback(onFrame);
      };
      activeFrame = element.requestVideoFrameCallback(onFrame);
    };
    const warming = api
      .helper<{ warm?: boolean; streamPath?: string }>({
        method: 'POST',
        path: `/api/cameras/${entityId}/warm`,
        data: { active: true },
      })
      .catch(() => undefined);
    const warmHeartbeat = setInterval(() => {
      if (document.visibilityState === 'visible')
        void api
          .helper({
            method: 'POST',
            path: `/api/cameras/${entityId}/warm`,
            data: { active: true },
          })
          .catch(() => {});
    }, 20000);
    let peer: RTCPeerConnection | undefined;
    let off: (() => void) | undefined;
    let hls: Hls | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let startupTimeout: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let recover: ReturnType<typeof setTimeout> | undefined;
    let rtcRetirement: ReturnType<typeof setTimeout> | undefined;
    const scheduleReconnect = () => {
      clearTimeout(recover);
      recover = setTimeout(() => {
        if (!closed && document.visibilityState === 'visible') setRetry((value) => value + 1);
      }, 30000);
    };
    let fallbackStarted = false;
    let fallbackGeneration = 0;
    let reportFallbackFailure = false;
    let sessionId: string | undefined;
    const candidates: RTCIceCandidateInit[] = [];
    const remoteCandidates: RTCIceCandidateInit[] = [];
    const snapshot = () => {
      if (document.visibilityState !== 'visible') return;
      return void api
        .cameraSnapshot(entityId)
        .then((url) => {
          if (!closed) {
            freshStill.current = true;
            setStill(url);
            if (displayedStill.current === url) setStillUpdatedAt(Date.now());
          }
        })
        .catch((e) => {
          if (!closed && !winner) setError(message(e));
        });
    };
    const stopRtc = () => {
      if (rtcFrame) rtcElement.cancelVideoFrameCallback(rtcFrame);
      rtcFrame = 0;
      peer?.close();
      peer = undefined;
      off?.();
      off = undefined;
      clearTimeout(timeout);
      if (relayFrame) relayElement.cancelVideoFrameCallback(relayFrame);
      relayFrame = 0;
    };
    const selectRtc = () => {
      if (closed) return;
      if (winner === 'rtc') return;
      clearTimeout(rtcRetirement);
      winner = 'rtc';
      fallbackStarted = false;
      ++fallbackGeneration;
      video.current = rtcElement;
      rtcElement.muted = mutedRef.current;
      relayElement.muted = true;
      setLiveTransport('rtc');
      setVideoReady(true);
      setStreamState('Live · WebRTC');
      setError('');
      observeFrames(rtcElement);
      clearTimeout(timeout);
      clearTimeout(startupTimeout);
      clearTimeout(recover);
      clearInterval(poll);
      poll = undefined;
      if (relayFrame) relayElement.cancelVideoFrameCallback(relayFrame);
      relayFrame = 0;
      hls?.destroy();
      hls = undefined;
      relayElement.pause();
      relayElement.removeAttribute('src');
      relayElement.load();
    };
    let rtcFrame = 0;
    const awaitRtcFrame = () => {
      if (rtcFrame || closed || winner === 'rtc') return;
      // Audio may start first on a streamless track. "playing" alone can mean
      // an audio-only element with videoWidth=0; it must never replace video.
      rtcFrame = rtcElement.requestVideoFrameCallback(() => {
        rtcFrame = 0;
        if (!closed && rtcElement.videoWidth > 0) selectRtc();
      });
    };
    let relayFrame = 0;
    const promoteRelay = () => {
      if (closed || winner === 'rtc') return;
      winner = 'hls';
      reportFallbackFailure = true;
      // Show warm HLS immediately but let a decoded RTC frame take over during
      // the original negotiation deadline. A fast HLS result must not cancel
      // RTC before ICE and its first video keyframe have had time to arrive.
      rtcRetirement = setTimeout(
        () => {
          rtcRetirement = undefined;
          if (!closed && winner === 'hls') stopRtc();
        },
        Math.max(0, negotiationDeadline - performance.now()),
      );
      clearTimeout(timeout);
      clearTimeout(startupTimeout);
      clearTimeout(recover);
      clearInterval(poll);
      poll = undefined;
      rtcElement.muted = true;
      video.current = relayElement;
      relayElement.muted = mutedRef.current;
      setLiveTransport('hls');
      setVideoReady(true);
      setStreamState('Live · HLS');
      setError('');
      observeFrames(relayElement);
    };
    const selectRelay = () => {
      if (relayFrame || closed || winner) return;
      const startedAt = relayElement.currentTime;
      const advancing: VideoFrameRequestCallback = (_now, metadata) => {
        relayFrame = 0;
        if (closed || winner === 'rtc') return;
        // A stale single-frame HLS segment can fire playing. Keep RTC alive
        // until the fallback has actually advanced through decoded frames.
        if (metadata.mediaTime >= startedAt + 0.2) promoteRelay();
        else relayFrame = relayElement.requestVideoFrameCallback(advancing);
      };
      relayFrame = relayElement.requestVideoFrameCallback(advancing);
    };
    rtcElement.addEventListener('playing', awaitRtcFrame);
    relayElement.addEventListener('playing', selectRelay);
    const resumeRelay = () => {
      // HLS media recovery detaches/re-attaches its MediaSource and can leave
      // the element paused. Live mode has no intentional pause state.
      if (!closed && winner !== 'rtc' && fallbackStarted && relayElement.paused)
        void relayElement.play().catch(() => {});
    };
    relayElement.addEventListener('canplay', resumeRelay);
    const showFallbackFailure = () => {
      fallbackStarted = false;
      if (relayFrame) relayElement.cancelVideoFrameCallback(relayFrame);
      relayFrame = 0;
      if (!reportFallbackFailure) return;
      setStreamState('Snapshot');
      setError('Live video is unavailable. Showing the latest snapshot.');
      snapshot();
      poll ??= setInterval(snapshot, 15000);
      scheduleReconnect();
    };
    const fallback = async (reportFailure = true) => {
      reportFallbackFailure ||= reportFailure;
      if (closed || fallbackStarted) return;
      fallbackStarted = true;
      const generation = ++fallbackGeneration;
      winner = undefined;
      // Keep negotiating RTC while a separate, muted fallback decoder loads.
      // Promote only a source with a decoded frame; never erase a usable picture.
      try {
        hls?.destroy();
        hls = undefined;
        relayElement.pause();
        relayElement.removeAttribute('src');
        relayElement.load();
        let warmTimeout: ReturnType<typeof setTimeout> | undefined;
        const relay = await Promise.race([
          warming,
          new Promise<undefined>((resolve) => {
            warmTimeout = setTimeout(() => resolve(undefined), 2500);
          }),
        ]);
        clearTimeout(warmTimeout);
        const stream =
          relay?.streamPath === `/api/cameras/${entityId}/live/index.m3u8`
            ? { url: `haus-media://streams/${entityId}/index.m3u8` }
            : await api.request<{ url: string }>({
                type: 'camera/stream',
                entity_id: entityId,
                format: 'hls',
              });
        if (closed || winner === 'rtc' || generation !== fallbackGeneration) return;
        const url = new URL(stream.url, serverUrl);
        if (
          !(
            url.protocol === 'haus-media:' &&
            url.hostname === 'streams' &&
            url.pathname === `/${entityId}/index.m3u8`
          ) &&
          (url.origin !== new URL(serverUrl).origin || !url.pathname.startsWith('/api/'))
        )
          throw new Error('The camera returned an unexpected stream address.');
        if (closed || winner === 'rtc' || generation !== fallbackGeneration) return;
        const { default: Hls } = await import('hls.js');
        if (closed || winner === 'rtc' || generation !== fallbackGeneration) return;
        if (Hls.isSupported()) {
          let networkRetries = 0,
            mediaRetries = 0;
          const decodeRecovery = new LiveHlsRecovery();
          hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 20,
            maxBufferLength: 12,
            maxMaxBufferLength: 30,
            maxBufferSize: 24 * 1024 ** 2,
          });
          hls.loadSource(url.href);
          hls.attachMedia(relayElement);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (!closed && winner !== 'rtc' && generation === fallbackGeneration)
              void relayElement.play().catch(() => {});
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (
              data.details === Hls.ErrorDetails.MEDIA_SOURCE_REQUIRES_RESET &&
              !closed &&
              winner !== 'rtc' &&
              generation === fallbackGeneration
            ) {
              // Hls.js has reset the MediaSource before this listener. Its
              // default restart position replays the same damaged live fragment.
              const position = decodeRecovery.next(
                performance.now(),
                lastRelayTime,
                hls?.latestLevelDetails?.fragments ?? [],
              );
              if (position !== undefined) {
                hls?.startLoad(position);
                return;
              }
              hls?.destroy();
              hls = undefined;
              showFallbackFailure();
              return;
            }
            if (data.fatal && !closed && winner !== 'rtc' && generation === fallbackGeneration) {
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries++ < 3) {
                clearTimeout(recover);
                recover = setTimeout(
                  () => {
                    if (!closed) hls?.startLoad();
                  },
                  Math.min(8000, 1000 * 2 ** networkRetries),
                );
                return;
              }
              if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries++ < 1) {
                hls?.recoverMediaError();
                return;
              }
              hls?.destroy();
              hls = undefined;
              showFallbackFailure();
            }
          });
        } else if (relayElement.canPlayType('application/vnd.apple.mpegurl')) {
          relayElement.src = url.href;
          await relayElement.play();
        } else throw new Error('This stream format is unavailable.');
      } catch {
        if (!closed && !winner && generation === fallbackGeneration) {
          showFallbackFailure();
        }
      }
    };
    const start = async () => {
      setVideoReady(false);
      snapshot();
      setError('');
      setStreamState('Connecting');
      // A ready, bounded server lease can win immediately. Do not spend the
      // entire negotiation deadline waiting while a warm HLS picture is available.
      void warming.then((relay) => {
        if (relay?.warm && !closed && !winner) void fallback(false);
      });
      // Count negotiation from the user's click, including slow HA requests.
      timeout = setTimeout(() => {
        const media = video.current;
        if (!media || media.readyState < 2 || !media.videoWidth || media.paused) void fallback();
      }, 8000);
      startupTimeout = setTimeout(() => {
        if (!closed && !winner) {
          reportFallbackFailure = true;
          showFallbackFailure();
        }
      }, 25000);
      try {
        const [capabilities, config] = await Promise.all([
          api.request<{ frontend_stream_types?: string[] }>({
            type: 'camera/capabilities',
            entity_id: entityId,
          }),
          api
            .request<{ configuration?: RTCConfiguration; dataChannel?: string }>({
              type: 'camera/webrtc/get_client_config',
              entity_id: entityId,
            })
            .catch(() => ({ configuration: {} })),
        ]);
        if (closed || (winner === 'hls' && !rtcRetirement)) return;
        if (!capabilities.frontend_stream_types?.includes('web_rtc')) {
          await fallback();
          return;
        }
        const pc = new RTCPeerConnection(config.configuration ?? {});
        peer = pc;
        if ('dataChannel' in config && typeof config.dataChannel === 'string')
          pc.createDataChannel(config.dataChannel);
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });
        const incoming = new MediaStream();
        pc.ontrack = (e) => {
          if (!closed && peer === pc) {
            // Some cameras deliver streamless audio/video tracks separately.
            // Keep one stream so the audio event cannot replace the video track.
            if (!incoming.getTracks().some((track) => track.id === e.track.id))
              incoming.addTrack(e.track);
            rtcElement.srcObject = incoming;
            void rtcElement.play().catch(() => {});
          }
        };
        const sendCandidate = (candidate: RTCIceCandidateInit) =>
          void api
            .request({
              type: 'camera/webrtc/candidate',
              entity_id: entityId,
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
          if (['failed', 'disconnected'].includes(pc.connectionState)) void fallback();
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (closed || peer !== pc) return;
        const cleanup = await api.subscribe<Signal>(
          { type: 'camera/webrtc/offer', entity_id: entityId, offer: offer.sdp },
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
      } catch {
        await fallback();
      }
    };
    const mediaWatchdog = setInterval(() => {
      if (!presentedRef.current) {
        // Hidden retained decoders may suspend frame callbacks. That is not a
        // source stall and must not trigger reconnection while browsing history.
        progress.reset(performance.now());
        return;
      }
      const media = video.current;
      if (!activeElement || !media) return;
      if (media !== activeElement) return;
      const state = progress.check(performance.now(), document.visibilityState === 'visible');
      if (state === 'repair') {
        if (winner === 'rtc') void fallback();
        else {
          const livePosition = hls?.liveSyncPosition;
          if (
            typeof livePosition === 'number' &&
            Number.isFinite(livePosition) &&
            livePosition > media.currentTime + 0.5
          ) {
            try {
              media.currentTime = livePosition;
            } catch {
              /* The decoder may be detaching; the bounded restart still runs. */
            }
          }
          hls?.startLoad(-1);
          void media.play().catch(() => {});
        }
      } else if (state === 'restart') setRetry((value) => value + 1);
    }, 1000);
    void start();
    return () => {
      clearInterval(mediaWatchdog);
      closed = true;
      if (activeFrame && activeElement) activeElement.cancelVideoFrameCallback(activeFrame);
      clearInterval(warmHeartbeat);
      void api
        .helper({
          method: 'POST',
          path: `/api/cameras/${entityId}/warm`,
          data: { active: false },
        })
        .catch(() => {});
      stopRtc();
      clearTimeout(startupTimeout);
      clearTimeout(rtcRetirement);
      hls?.destroy();
      clearInterval(poll);
      clearTimeout(recover);
      rtcElement.removeEventListener('playing', awaitRtcFrame);
      relayElement.removeEventListener('playing', selectRelay);
      relayElement.removeEventListener('canplay', resumeRelay);
      if (relayFrame) relayElement.cancelVideoFrameCallback(relayFrame);
      for (const element of [rtcElement, relayElement]) {
        element.pause();
        element.srcObject = null;
        element.removeAttribute('src');
        element.load();
      }
      video.current = null;
    };
  }, [entityId, enabled, serverUrl, retry]);
}
