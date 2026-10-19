import { useEffect, useRef, type RefObject } from 'react';

/** Tiny canvas, at most eight paints/second; never reads pixels or runs offscreen. */
export function CameraAmbilight({
  video,
  still,
}: {
  video: RefObject<HTMLVideoElement | null>;
  still?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const surface = canvas.current;
    const context = surface?.getContext('2d', { alpha: false, desynchronized: true });
    if (!surface || !context) return;
    const image = new Image();
    if (still) image.src = still;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0,
      paintedAt = 0,
      mediaAt = -1,
      imagePainted = false;
    let active = true;
    const paint = (now: number) => {
      frame = 0;
      if (!active || document.visibilityState !== 'visible') return;
      const media = video.current;
      if (now - paintedAt >= (reduced.matches ? 1000 : 125)) {
        const source =
          media && media.readyState >= 2
            ? media
            : image.complete && image.naturalWidth
              ? image
              : undefined;
        const changed = source === media ? media!.currentTime !== mediaAt : !imagePainted;
        if (source && changed) {
          try {
            context.drawImage(source, 0, 0, 64, 36);
          } catch {
            /* Keep the last background across a decoder handoff. */
          }
          paintedAt = now;
          mediaAt = media?.currentTime ?? -1;
          imagePainted = source === image;
        }
      }
      frame = requestAnimationFrame(paint);
    };
    const visible = () => {
      cancelAnimationFrame(frame);
      if (document.visibilityState === 'visible') frame = requestAnimationFrame(paint);
    };
    visible();
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      image.src = '';
      document.removeEventListener('visibilitychange', visible);
    };
  }, [video, still]);
  return (
    <canvas className="camera-ambilight" ref={canvas} width={64} height={36} aria-hidden="true" />
  );
}
