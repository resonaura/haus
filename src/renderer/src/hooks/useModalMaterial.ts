import { useEffect } from 'react';
export function useModalMaterial() {
  useEffect(() => {
    let previous: boolean | undefined;
    // Spotlight blurs the whole window itself. Keep the native sidebar in place
    // through its animation instead of briefly removing its material layer.
    const materialDialog = '[role="dialog"]:not([data-spotlight])';
    const syncModalMaterial = () => {
      const open = [...document.querySelectorAll<HTMLElement>(materialDialog)].some(
        (dialog) => dialog.getClientRects().length > 0 && !dialog.hasAttribute('data-exiting'),
      );
      if (open !== previous) document.documentElement.classList.toggle('modal-open', open);
      previous = open;
    };
    let frame: number | undefined;
    const containsDialog = (node: Node) =>
      node instanceof Element &&
      (node.matches(materialDialog) || node.querySelector(materialDialog));
    const observer = new MutationObserver((records) => {
      // Timeline virtualization and clock text are ordinary content updates.
      // Only dialog lifecycle changes can affect the native sidebar material.
      if (
        !records.some((record) =>
          record.type === 'attributes'
            ? record.target instanceof Element && record.target.matches(materialDialog)
            : [...record.addedNodes, ...record.removedNodes].some(containsDialog),
        )
      )
        return;
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
