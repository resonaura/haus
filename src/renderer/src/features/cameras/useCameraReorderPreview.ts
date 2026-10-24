import { useLayoutEffect, useRef } from 'react';

/** FLIP keeps the live grid preview smooth, including a changed target mid-animation. */
export function useCameraReorderPreview(order: string) {
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const previous = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const [id, node] of nodes.current) {
      node.getAnimations().forEach((animation) => animation.cancel());
      const before = previous.current.get(id),
        after = node.getBoundingClientRect();
      if (!before || reduced) continue;
      const x = before.left - after.left,
        y = before.top - after.top;
      if (Math.abs(x) + Math.abs(y) > 0.5)
        node.animate(
          [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }],
          { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' },
        );
    }
    return () => {
      previous.current = new Map(
        [...nodes.current].map(([id, node]) => [id, node.getBoundingClientRect()]),
      );
    };
  }, [order]);
  return nodes;
}
