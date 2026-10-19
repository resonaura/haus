import { useEffect } from 'react';
export function useModalMaterial() {
  useEffect(() => {
    const syncModalMaterial = () => {
      const open = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some(
        (dialog) => dialog.getClientRects().length > 0 && !dialog.hasAttribute('data-exiting'),
      );
      document.documentElement.classList.toggle('modal-open', open);
    };
    let frame: number | undefined;
    const observer = new MutationObserver(() => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        syncModalMaterial();
      });
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-hidden', 'data-entering', 'data-exiting'],
    });
    syncModalMaterial();
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      document.documentElement.classList.remove('modal-open');
    };
  }, []);
}
