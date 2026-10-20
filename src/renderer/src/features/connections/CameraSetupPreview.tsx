import { useEffect, useRef, useState } from 'react';
import { SmoothImage } from '../../components/ui/SmoothImage';
import type Hls from 'hls.js';

/** HA owns the temporary test stream; the preview never requests microphone/audio output. */
export function CameraSetupPreview({ flowId }: { flowId: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [still, setStill] = useState('');
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const api = window.hausNative;
    if (!api) return;
    let active = true,
      off: (() => void) | undefined,
      hls: Hls | undefined;
    const media = video.current;
    const start = async () => {
      const session = await api.getSession();
      if (!session || !active) return;
      const origin = new URL(session.url).origin;
      const address = (value: string | undefined, kind: 'still' | 'stream') => {
        if (!value) return undefined;
        const url = new URL(value, session.url);
        if (
          url.origin !== origin ||
          !url.pathname.startsWith(
            kind === 'still' ? `/api/generic/preview_flow_image/${flowId}` : '/api/hls/',
          )
        )
          throw Error('Unexpected preview source');
        return url.href;
      };
      const cleanup = await api.subscribe<{
        attributes?: { still_url?: string; stream_url?: string };
      }>({ type: 'generic_camera/start_preview', flow_id: flowId }, (event) => {
        void (async () => {
          if (!active) return;
          const image = address(event.attributes?.still_url, 'still');
          if (image) setStill(image);
          const stream = address(event.attributes?.stream_url, 'stream');
          if (!stream || !media) return;
          const { default: Hls } = await import('hls.js');
          if (!active) return;
          if (Hls.isSupported()) {
            hls?.destroy();
            hls = new Hls({
              enableWorker: true,
              lowLatencyMode: true,
              maxBufferLength: 4,
              backBufferLength: 0,
              maxMaxBufferLength: 8,
            });
            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (data.fatal && active) setFailed(true);
            });
            hls.attachMedia(media);
            hls.loadSource(stream);
          } else media.src = stream;
          void media.play().catch(() => {});
        })().catch(() => {
          if (active) setFailed(true);
        });
      });
      if (active) off = cleanup;
      else cleanup();
    };
    void start().catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      off?.();
      hls?.destroy();
      if (media) {
        media.pause();
        media.removeAttribute('src');
        media.load();
      }
    };
  }, [flowId]);
  return (
    <div className="camera-setup-preview">
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        onPlaying={() => setReady(true)}
        data-ready={ready || undefined}
      />
      {still && !ready && <SmoothImage src={still} alt="Camera connection preview" />}
      {!ready && !still && (
        <p>
          {failed
            ? 'The server checked the connection. A preview is unavailable here.'
            : 'Preparing a preview…'}
        </p>
      )}
    </div>
  );
}
