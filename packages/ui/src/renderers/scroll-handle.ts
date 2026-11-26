/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type * as React from 'react';

export interface HausScrollToOptions {
  readonly left?: number;
  readonly top?: number;
  readonly behavior?: 'auto' | 'instant' | 'smooth';
}

export interface HausScrollIntoViewOptions {
  readonly axis?: 'x' | 'y';
  readonly align?: 'center' | 'nearest';
  readonly behavior?: 'auto' | 'instant' | 'smooth';
}

/**
 * Platform-neutral imperative scroll container handle implemented natively by
 * DOM `HTMLDivElement` and exposed via `scrollRef` on GPUIX `ScrollView`.
 */
export interface HausScrollHandle {
  scrollTo(options: HausScrollToOptions): void;
  scrollTo(left: number, top: number): void;
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  scrollElementIntoView?(target: unknown, options?: HausScrollIntoViewOptions): boolean;
}

interface DomRectLike {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface DomBoxLike {
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  getBoundingClientRect(): DomRectLike;
}

interface DomScrollableLike extends HausScrollHandle {
  getBoundingClientRect(): DomRectLike;
}

function isScrollHandle(value: unknown): value is HausScrollHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'scrollTo' in value &&
    typeof (value as { scrollTo?: unknown }).scrollTo === 'function'
  );
}

function isDomBox(value: unknown): value is DomBoxLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getBoundingClientRect' in value &&
    typeof (value as { getBoundingClientRect?: unknown }).getBoundingClientRect === 'function' &&
    typeof (value as { offsetWidth?: unknown }).offsetWidth === 'number'
  );
}

function isDomScrollable(value: unknown): value is DomScrollableLike {
  return (
    isScrollHandle(value) &&
    'getBoundingClientRect' in value &&
    typeof (value as { getBoundingClientRect?: unknown }).getBoundingClientRect === 'function'
  );
}

/** Assigns a value to either a callback ref or a mutable React ref object. */
export function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  (ref as { current: T | null }).current = value;
}

/** Programmatically scrolls either a DOM scroll element or a GPUIX `HausScrollHandle`. */
export function scrollContainerTo(container: unknown, options: HausScrollToOptions): boolean {
  if (!isScrollHandle(container)) return false;
  container.scrollTo(options);
  return true;
}

/**
 * Keeps `target` visible inside `container` along `axis`, centering it when it
 * overflows the visible scrollport — matching Electron's `HomeCategoryDock` behavior
 * identically on both DOM and GPUIX.
 */
export function keepElementVisibleInScroll(
  container: unknown,
  target: unknown,
  options: {
    readonly axis?: 'x' | 'y';
    readonly align?: 'center' | 'nearest';
    readonly reducedMotion?: boolean;
  } = {},
): boolean {
  if (!container || !target) return false;
  const axis = options.axis ?? 'x';
  const align = options.align ?? 'center';
  const behavior: 'instant' | 'smooth' = options.reducedMotion ? 'instant' : 'smooth';

  if (isScrollHandle(container) && typeof container.scrollElementIntoView === 'function') {
    return container.scrollElementIntoView(target, { axis, align, behavior });
  }

  if (isDomScrollable(container) && isDomBox(target)) {
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (axis === 'x') {
      const left = targetRect.left - containerRect.left + container.scrollLeft;
      const width = target.offsetWidth || targetRect.width;
      const right = left + width;
      if (left < container.scrollLeft || right > container.scrollLeft + container.clientWidth) {
        const nextLeft =
          align === 'center'
            ? left - (container.clientWidth - width) / 2
            : left < container.scrollLeft
              ? left
              : right - container.clientWidth;
        container.scrollTo({ left: Math.max(0, nextLeft), behavior });
        return true;
      }
      return false;
    }
    const top = targetRect.top - containerRect.top + container.scrollTop;
    const height = target.offsetHeight || targetRect.height;
    const bottom = top + height;
    if (top < container.scrollTop || bottom > container.scrollTop + container.clientHeight) {
      const nextTop =
        align === 'center'
          ? top - (container.clientHeight - height) / 2
          : top < container.scrollTop
            ? top
            : bottom - container.clientHeight;
      container.scrollTo({ top: Math.max(0, nextTop), behavior });
      return true;
    }
    return false;
  }

  return false;
}
