import { useEffect, useRef } from 'react';

/** Only request live counters while a server surface actually intersects the window. */
export function useServerVisibility(enabled: boolean, onVisible: () => void) {
  const visible = useRef(false);
  const notify = useRef(onVisible);
  notify.current = onVisible;
  useEffect(() => {
    if (!enabled) {
      visible.current = false;
      return;
    }
    if (typeof IntersectionObserver === 'undefined' || typeof MutationObserver === 'undefined') {
      visible.current = true;
      return;
    }
    const observed = new Set<Element>();
    const intersecting = new Set<Element>();
    let active = true;
    let queued = false;
    const update = () => {
      if (!active) return;
      const next = intersecting.size > 0;
      const previous = visible.current;
      visible.current = next;
      if (next && !previous && document.visibilityState === 'visible') notify.current();
    };
    const observer = new IntersectionObserver((entries) => {
      if (!active) return;
      for (const entry of entries) {
        if (entry.isIntersecting && entry.target.isConnected) intersecting.add(entry.target);
        else intersecting.delete(entry.target);
      }
      update();
    });
    const scan = () => {
      queued = false;
      if (!active) return;
      const elements = new Set(document.querySelectorAll('.server-tile, [data-server-surface]'));
      for (const element of observed) {
        if (!elements.has(element)) {
          observer.unobserve(element);
          observed.delete(element);
          intersecting.delete(element);
        }
      }
      for (const element of elements) {
        if (observed.has(element)) continue;
        observed.add(element);
        observer.observe(element);
      }
      update();
    };
    scan();
    const mutations = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(scan);
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    return () => {
      active = false;
      observer.disconnect();
      mutations.disconnect();
      visible.current = false;
    };
  }, [enabled]);
  return visible;
}
