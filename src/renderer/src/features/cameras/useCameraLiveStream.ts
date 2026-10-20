import { useEffect, type RefObject, type Dispatch, type SetStateAction } from 'react';
import type Hls from 'hls.js';
import { message } from '../../hooks/useHaus';

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
    if (!enabled || !window.hausNative || !serverUrl) return;
    const api = window.hausNative;
    const rtcElement = rtcVideo.current;
    const relayElement = relayVideo.current;
    if (!rtcElement || !relayElement) return;
    video.current = rtcElement;
    setLiveTransport('rtc');
    let winner: 'rtc' | 'hls' | undefined;
    let closed = false;
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
      peer?.close();
      peer = undefined;
      off?.();
      off = undefined;
      clearTimeout(timeout);
      if (relayFrame) relayElement.cancelVideoFrameCallback(relayFrame);
      relayFrame = 0;
    };
    const selectRtc = () => {
      if (closed || winner === 'hls') return;
      winner = 'rtc';
      fallbackStarted = false;
      ++fallbackGeneration;
      video.current = rtcElement;
      setLiveTransport('rtc');
      setVideoReady(true);
      setStreamState('Live · WebRTC');
      setError('');
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
    let relayFrame = 0;
    const promoteRelay = () => {
      if (closed || winner === 'rtc') return;
      winner = 'hls';
      reportFallbackFailure = true;
      stopRtc();
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
    };
    const selectRelay = () => {
      if (relayFrame || closed || winner) return;
      const startedAt = relayElement.currentTime;
      const advancing: VideoFrameRequestCallback = (_now, metadata) => {
        relayFrame = 0;
        if (closed || winner === 'rtc') return;
        // A stale single-frame HLS segment can fire playing. Keep RTC alive
        // until the fallback has actually advanced through decoded frames.
        if (metadata.mediaTime >= startedAt + 0.08) promoteRelay();
        else relayFrame = relayElement.requestVideoFrameCallback(advancing);
      };
      relayFrame = relayElement.requestVideoFrameCallback(advancing);
    };
    rtcElement.addEventListener('playing', selectRtc);
    relayElement.addEventListener('playing', selectRelay);
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
        if (closed || winner === 'hls') return;
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
          if (!closed && peer === pc && winner !== 'hls') {
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
    let observedTime = -1,
      advancedAt = Date.now();
    const mediaWatchdog = setInterval(() => {
      const media = video.current;
      if (document.visibilityState !== 'visible' || !media || media.paused || !media.videoWidth) {
        advancedAt = Date.now();
        return;
      }
      if (media.currentTime !== observedTime) {
        observedTime = media.currentTime;
        advancedAt = Date.now();
      } else if (Date.now() - advancedAt > 15000) {
        advancedAt = Date.now();
        setRetry((value) => value + 1);
      }
    }, 2500);
    void start();
    return () => {
      clearInterval(mediaWatchdog);
      closed = true;
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
      hls?.destroy();
      clearInterval(poll);
      clearTimeout(recover);
      rtcElement.removeEventListener('playing', selectRtc);
      relayElement.removeEventListener('playing', selectRelay);
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
