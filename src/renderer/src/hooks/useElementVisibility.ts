import { useEffect, useRef, useState } from 'react';

/** Prefetch near the viewport and stop recurring work for offscreen content. */
export function useElementVisibility<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '150px',
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, visible };
}
