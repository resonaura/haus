import { useEffect } from 'react';

/** Keep the native material aligned with responsive CSS, in logical CSS pixels. */
export function useNativeSidebar(open: boolean): void {
  useEffect(() => {
    const native = window.hausNative;
    const sidebar = document.querySelector<HTMLElement>('.sidebar');
    if (!native || !sidebar) return;
    let frame = 0;
    let active = true;
    let pending = false;
    let desiredWidth: number | undefined;
    const setMaterial = (material: string) => {
      if (active) document.documentElement.dataset.sidebarMaterial = material;
    };
    const removeMaterialEvents = native.onEvent((event) => {
      if (event.type === 'appearance') setMaterial(event.sidebarMaterial);
    });
    const flush = async () => {
      if (pending || !active) return;
      pending = true;
      try {
        while (active && desiredWidth !== undefined) {
          const width = desiredWidth;
          desiredWidth = undefined;
          const material = await native.updateSidebarMaterial?.(width);
          if (material) setMaterial(material);
        }
      } catch {
        // The window can close while the material IPC is in flight.
      } finally {
        pending = false;
      }
    };
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = sidebar.getBoundingClientRect();
        desiredWidth = Math.min(
          400,
          Math.max(0, Math.min(window.innerWidth, bounds.right) - Math.max(0, bounds.left)),
        );
        // Modal/Spotlight CSS covers the native material with an opaque plane.
        // Never tear it down for overlays: delayed IPC used to leave it disabled.
        void flush();
      });
    };
    if (!native.updateSidebarMaterial) return removeMaterialEvents;
    const observer = new ResizeObserver(update);
    observer.observe(sidebar);
    const sidebarTransitionEnd = (event: TransitionEvent) => {
      // Descendant hover/navigation animations do not change the native plane.
      if (event.target === sidebar && ['transform', 'width'].includes(event.propertyName)) update();
    };
    window.addEventListener('resize', update);
    sidebar.addEventListener('transitionend', sidebarTransitionEnd);
    update();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      removeMaterialEvents();
      observer.disconnect();
      window.removeEventListener('resize', update);
      sidebar.removeEventListener('transitionend', sidebarTransitionEnd);
    };
  }, [open]);
}
