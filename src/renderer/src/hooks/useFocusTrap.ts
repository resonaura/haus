import { useEffect, type RefObject } from 'react';

/** Keeps keyboard focus inside a custom modal and returns it to its trigger on close. */
export function useFocusTrap(root: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return;
    const element = root.current;
    if (!element) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      [
        ...element.querySelectorAll<HTMLElement>(
          'input:not(:disabled), button:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ),
      ].filter((item) => item.getClientRects().length > 0);
    const focusFirst = () => (focusable()[0] ?? element).focus();
    focusFirst();
    const contain = (event: FocusEvent) => {
      if (!element.contains(event.target as Node)) focusFirst();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (
        !first ||
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener('focusin', contain);
    element.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('focusin', contain);
      element.removeEventListener('keydown', onKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, [root, active]);
}
