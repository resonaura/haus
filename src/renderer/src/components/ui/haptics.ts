import type { HapticPattern } from '../../../../shared/native';

let lastAt = -Infinity;
/** Discrete feedback only; unsupported systems have no native implementation. */
export function triggerHaptic(pattern: HapticPattern = 'alignment'): void {
  if (!window.hausNative?.hapticFeedback || document.visibilityState !== 'visible') return;
  const at = performance.now();
  if (at - lastAt < 35) return;
  lastAt = at;
  window.hausNative.hapticFeedback(pattern);
}

export function sliderHasDetents(min: number, max: number, step: number): boolean {
  const positions = step > 0 ? (max - min) / step : Infinity;
  return Number.isFinite(positions) && positions > 1 && positions <= 96;
}

/** One semantic activation covers HeroUI's compound controls and plain buttons. */
export function installHaptics(root: Document = document): () => void {
  const feedback = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    if (
      target.closest(
        '[data-haptic="off"], [disabled], [aria-disabled="true"], [data-disabled]:not([data-disabled="false"]), [inert]',
      )
    )
      return;
    const control = target.closest(
      'button, a[href], summary, input[type="checkbox"], input[type="radio"], [data-slot="switch-content"], [data-slot="switch-control"], [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]',
    );
    if (!control || control.getAttribute('aria-selected') === 'true') return;
    const choice = control.matches(
      'input, [data-slot="switch-content"], [data-slot="switch-control"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitemcheckbox"], [role="menuitemradio"]',
    );
    triggerHaptic(choice ? 'alignment' : 'generic');
  };
  const activate = (event: MouseEvent) => {
    if (event.isTrusted && event.button === 0) feedback(event.target);
  };
  const keyup = (event: KeyboardEvent) => {
    // React Aria's Space press may not create a native click. Native buttons
    // that do create one are coalesced by the same short feedback budget.
    if (event.isTrusted && event.key === ' ' && !event.repeat) feedback(event.target);
  };
  // React Aria owns/cancels the native click after recognizing its PressEvent.
  // Capture the trusted activation first; mount/value updates never enter here.
  root.addEventListener('click', activate, true);
  root.addEventListener('keyup', keyup, true);
  return () => {
    root.removeEventListener('click', activate, true);
    root.removeEventListener('keyup', keyup, true);
  };
}
