import { useEffect, useRef, useState } from 'react';

/** Successive low-pass passes avoid the ringing of a large single-step reduction. */
export async function resizeCameraImage(image: HTMLImageElement, width: number, height: number) {
  const ratio = Math.min(1, Math.max(width / image.naturalWidth, height / image.naturalHeight));
  if (ratio >= 0.85 || !width || !height) return undefined;
  const targetWidth = Math.max(1, Math.round(image.naturalWidth * ratio));
  const targetHeight = Math.max(1, Math.round(image.naturalHeight * ratio));
  let source: CanvasImageSource = image;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  while (sourceWidth > targetWidth * 2) {
    const pass = document.createElement('canvas');
    pass.width = Math.max(targetWidth, Math.floor(sourceWidth / 2));
    pass.height = Math.max(targetHeight, Math.floor(sourceHeight / 2));
    const context = pass.getContext('2d');
    if (!context) return undefined;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'medium';
    context.drawImage(source, 0, 0, pass.width, pass.height);
    source = pass;
    sourceWidth = pass.width;
    sourceHeight = pass.height;
  }
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, targetWidth, targetHeight);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Decode before presenting a frame; preserve the previous one until the new one fades in. */
export function SmoothImage({
  src,
  alt,
  className = '',
  thumbnail = false,
  progressiveBlur = false,
  onLoad,
}: {
  src?: string;
  alt: string;
  className?: string;
  thumbnail?: boolean;
  progressiveBlur?: boolean;
  onLoad?: (source: string) => void;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const loaded = useRef(onLoad);
  loaded.current = onLoad;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [frame, setFrame] = useState<{ url: string; source: string; previous?: string }>();
  const owned = useRef<string[]>([]);
  useEffect(() => {
    if (!thumbnail || !host.current) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(([entry]) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.round(entry.contentRect.width * dpr);
        const height = Math.round(entry.contentRect.height * dpr);
        setSize((old) =>
          Math.abs(old.width - width) < 8 && Math.abs(old.height - height) < 8
            ? old
            : { width, height },
        );
      }, 100);
    });
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [thumbnail]);
  useEffect(() => {
    if (!src || (thumbnail && !size.width)) return;
    let cancelled = false;
    const image = new Image();
    image.decoding = 'async';
    image.src = src;
    void image
      .decode()
      .then(async () => {
        if (cancelled) return;
        const blob = thumbnail
          ? await resizeCameraImage(image, size.width, size.height)
          : undefined;
        if (cancelled) return;
        const url = blob ? URL.createObjectURL(blob) : src;
        if (blob) owned.current.push(url);
        setFrame((old) => (old?.url === url ? old : { url, source: src, previous: old?.url }));
        // Retain the two displayed layers. Older frames are no longer referenced by the DOM.
        while (owned.current.length > 2) URL.revokeObjectURL(owned.current.shift()!);
      })
      .catch(() => {
        /* A failed refresh must not erase the last decoded frame. */
      });
    return () => {
      cancelled = true;
    };
  }, [src, thumbnail, size.width, size.height]);
  useEffect(
    () => () => {
      for (const url of owned.current) URL.revokeObjectURL(url);
    },
    [],
  );
  return (
    <span ref={host} className={`smooth-image ${className}`}>
      {frame?.previous && (
        <img src={frame.previous} alt="" aria-hidden className="smooth-image-previous" />
      )}
      {frame && (
        <img
          key={frame.url}
          src={frame.url}
          alt={alt}
          className="smooth-image-current"
          onLoad={() => loaded.current?.(frame.source)}
        />
      )}
      {frame &&
        progressiveBlur &&
        [2, 6, 12].map((blur) => (
          <span key={blur} className={`smooth-image-blur blur-${blur}`} aria-hidden="true">
            <img src={frame.url} alt="" />
          </span>
        ))}
    </span>
  );
}
