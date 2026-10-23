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
