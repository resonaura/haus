/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

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
