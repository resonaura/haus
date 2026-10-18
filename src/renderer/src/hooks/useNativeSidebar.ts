import { useEffect } from 'react';

/** Keep the native material aligned with responsive CSS, in logical CSS pixels. */
export function useNativeSidebar(open: boolean): void {
  useEffect(() => {
    const native = window.hausNative;
    const sidebar = document.querySelector<HTMLElement>('.sidebar');
    if (!native?.updateSidebarMaterial || !sidebar) return;
    let current = true;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = sidebar.getBoundingClientRect();
        const width = Math.min(
          400,
          Math.max(0, Math.min(window.innerWidth, bounds.right) - Math.max(0, bounds.left)),
        );
        void native
          .updateSidebarMaterial(width)
          .then((material) => {
            if (current) document.documentElement.dataset.sidebarMaterial = material;
          })
          .catch(() => {});
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(sidebar);
    window.addEventListener('resize', update);
    sidebar.addEventListener('transitionend', update);
    update();
    return () => {
      current = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', update);
      sidebar.removeEventListener('transitionend', update);
    };
  }, [open]);
}
