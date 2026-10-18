import { useEffect } from 'react';

/** Keep the native material aligned with responsive CSS, in logical CSS pixels. */
export function useNativeSidebar(open: boolean): void {
  useEffect(() => {
    const native = window.hausNative;
    const sidebar = document.querySelector<HTMLElement>('.sidebar');
    if (!native || !sidebar) return;
    let frame = 0;
    const setMaterial = (material: string) => {
      document.documentElement.dataset.sidebarMaterial = material;
    };
    const removeMaterialEvents = native.onEvent((event) => {
      if (event.type === 'appearance') setMaterial(event.sidebarMaterial);
    });
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = sidebar.getBoundingClientRect();
        const width = Math.min(
          400,
          Math.max(0, Math.min(window.innerWidth, bounds.right) - Math.max(0, bounds.left)),
        );
        void native
          .updateSidebarMaterial?.(width)
          .then(setMaterial)
          .catch(() => {});
      });
    };
    if (!native.updateSidebarMaterial) return removeMaterialEvents;
    const observer = new ResizeObserver(update);
    observer.observe(sidebar);
    window.addEventListener('resize', update);
    sidebar.addEventListener('transitionend', update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      removeMaterialEvents();
      observer.disconnect();
      window.removeEventListener('resize', update);
      sidebar.removeEventListener('transitionend', update);
    };
  }, [open]);
}
