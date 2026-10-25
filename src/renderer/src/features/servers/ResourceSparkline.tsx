import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import type { ResourceSample } from './types';

/** ResoStage-style slide: animate the SVG group, never React state per frame. */
export const ResourceSparkline = memo(function ResourceSparkline({
  history,
  field,
}: {
  history: ResourceSample[];
  field: 'cpu' | 'memory' | 'swap';
}) {
  const group = useRef<SVGGElement>(null);
  const previousTime = useRef<number | undefined>(undefined);
  const slide = useRef<{ animation: Animation; from: number } | undefined>(undefined);
  const lastTime = history.at(-1)?.time;
  const step = 200 / 60;
  const parts: string[] = [];
  let continuous = false;
  let previousSampleTime: number | undefined;
  for (const sample of history) {
    if (lastTime === undefined || sample.time < lastTime - 62000) continue;
    const value = sample[field];
    if (value === null) {
      continuous = false;
      continue;
    }
    if (previousSampleTime !== undefined && sample.time - previousSampleTime > 10000)
      continuous = false;
    // Keep the newest vertex one full sample beyond the clipping edge.
    // Only the existing line slides into view as the next sample arrives.
    const x = 200 + step - ((lastTime - sample.time) / 1000) * step;
    const y = 36 - Math.min(1, Math.max(0, value)) * 31;
    parts.push(`${continuous ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`);
    previousSampleTime = sample.time;
    continuous = true;
  }
  useLayoutEffect(() => {
    const element = group.current;
    const previous = previousTime.current;
    previousTime.current = lastTime;
    const running = slide.current;
    const progress =
      typeof running?.animation.currentTime === 'number'
        ? Math.min(1, Math.max(0, running.animation.currentTime / 1000))
        : 1;
    const remainder = (running?.from ?? 0) * (1 - progress);
    running?.animation.cancel();
    slide.current = undefined;
    if (!element || lastTime === undefined || previous === undefined || lastTime <= previous)
      return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const elapsed = lastTime - previous;
    if (elapsed > 2500) return;
    const from = remainder + (elapsed / 1000) * step;
    const animation = element.animate(
      [{ transform: `translateX(${from.toFixed(3)}px)` }, { transform: 'translateX(0px)' }],
      { duration: 1000, easing: 'linear' },
    );
    slide.current = { animation, from };
  }, [lastTime, step]);
  useEffect(() => () => slide.current?.animation.cancel(), []);
  return (
    <svg
      className="server-sparkline"
      viewBox="0 0 200 42"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g ref={group}>
        <path d={parts.join(' ')} />
      </g>
    </svg>
  );
});
