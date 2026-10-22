import { useCallback, useEffect, useRef, useState } from 'react';

/** One bounded frame bridges decoder changes without encoding or reading pixels. */
export function useCameraHandoff(ready: boolean) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hasFrame = useRef(false);
  const [captured, setCaptured] = useState(false);
  const [revision, setRevision] = useState(0);
  const [holding, setHolding] = useState(false);
  useEffect(() => {
    if (!ready) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setHolding(false));
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, revision]);
  const retain = useCallback((source: HTMLVideoElement | null) => {
    const surface = canvas.current;
    if (!surface || !source || source.readyState < 2 || !source.videoWidth) return;
    try {
      const width = Math.min(960, source.videoWidth);
      const height = Math.max(1, Math.round((width * source.videoHeight) / source.videoWidth));
      if (surface.width !== width || surface.height !== height) {
        surface.width = width;
        surface.height = height;
      }
      const context = surface.getContext('2d', { alpha: false });
      if (!context) return;
      context.drawImage(source, 0, 0, surface.width, surface.height);
      if (!hasFrame.current) {
        hasFrame.current = true;
        setCaptured(true);
      }
    } catch {
      // A disappearing decoder must not replace the already retained picture.
    }
  }, []);
  const capture = useCallback(
    (source: HTMLVideoElement | null) => {
      retain(source);
      if (hasFrame.current) {
        setHolding(true);
        setRevision((value) => value + 1);
      }
    },
    [retain],
  );
  return { canvas, captured, holding, capture, retain };
}

/** Keep just this viewer warm briefly during history, always muted and released on dismissal. */
export function useRetainedLive(enabled: boolean, history: boolean) {
  const [retained, setRetained] = useState(true);
  useEffect(() => {
    if (!enabled || !history) {
      setRetained(true);
      return;
    }
    const timer = setTimeout(() => setRetained(false), 30_000);
    return () => clearTimeout(timer);
  }, [enabled, history]);
  return enabled && (!history || retained);
}
