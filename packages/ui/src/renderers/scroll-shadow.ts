/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export type ScrollShadowEdge = 'top' | 'bottom' | 'left' | 'right';

export const DEFAULT_SCROLL_SHADOW_SIZE_PX = 24;
export const DEFAULT_SCROLL_SHADOW_TRANSITION_MS = 180;

export const SCROLL_SHADOW_PRESETS = {
  main: 36,
  sidebar: 28,
  rail: 26,
  default: DEFAULT_SCROLL_SHADOW_SIZE_PX,
} as const;

export function computeScrollShadowRampPx(sizePx: number): number {
  return Math.min(20, Math.max(8, sizePx * 0.5));
}

export interface ScrollShadowTargetInput {
  readonly offsetPx: number;
  readonly maxOffsetPx: number;
  readonly sizePx: number;
  readonly startEnabled?: boolean;
  readonly endEnabled?: boolean;
}

export interface ScrollShadowTargets {
  readonly start: number;
  readonly end: number;
  readonly startPx: number;
  readonly endPx: number;
}

/**
 * Computes normalized (`0..1`) and pixel-scaled edge fade targets for a scroll axis.
 * Matches GPUI Rust's `compute_scroll_fade_targets` 1:1 so Electron/DOM and GPUIX share
 * identical activation thresholds, ramp curves, and edge sizes.
 */
export function computeScrollShadowTargets({
  offsetPx,
  maxOffsetPx,
  sizePx,
  startEnabled = true,
  endEnabled = true,
}: ScrollShadowTargetInput): ScrollShadowTargets {
  const safeSize = Number.isFinite(sizePx) && sizePx > 0 ? sizePx : 0;
  const safeMax = Number.isFinite(maxOffsetPx) ? Math.max(0, maxOffsetPx) : 0;
  if (safeSize <= 0 || safeMax <= 1) {
    return { start: 0, end: 0, startPx: 0, endPx: 0 };
  }
  const ramp = computeScrollShadowRampPx(safeSize);
  const scrolled = Math.min(safeMax, Math.max(0, Number.isFinite(offsetPx) ? offsetPx : 0));
  const start = startEnabled ? Math.min(1, Math.max(0, scrolled / ramp)) : 0;
  const end = endEnabled ? Math.min(1, Math.max(0, (safeMax - scrolled) / ramp)) : 0;
  return {
    start,
    end,
    startPx: safeSize * start,
    endPx: safeSize * end,
  };
}

export function resolveScrollShadowEdges(
  orientation: 'vertical' | 'horizontal',
  edges?: readonly ScrollShadowEdge[],
): {
  readonly start: boolean;
  readonly end: boolean;
  readonly activeEdges: readonly ScrollShadowEdge[];
} {
  const startEdge: ScrollShadowEdge = orientation === 'horizontal' ? 'left' : 'top';
  const endEdge: ScrollShadowEdge = orientation === 'horizontal' ? 'right' : 'bottom';
  if (!edges) {
    return { start: true, end: true, activeEdges: [startEdge, endEdge] };
  }
  const start = edges.includes(startEdge);
  const end = edges.includes(endEdge);
  const activeEdges: ScrollShadowEdge[] = [];
  if (start) activeEdges.push(startEdge);
  if (end) activeEdges.push(endEdge);
  return { start, end, activeEdges };
}
