/* @jsxImportSource @gpuix/react */
/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useMemo, useRef } from 'react';
import { useGpuix, useScrollController, type PublicInstance, type StyleDesc } from '@gpuix/react';
import type { RenderContext } from '../renderers/contract.js';
import type { HostScrollViewProps } from '../renderers/host.js';
import {
  assignRef,
  type HausScrollHandle,
  type HausScrollIntoViewOptions,
  type HausScrollToOptions,
} from '../renderers/scroll-handle.js';
import {
  DEFAULT_SCROLL_SHADOW_SIZE_PX,
  DEFAULT_SCROLL_SHADOW_TRANSITION_MS,
  resolveScrollShadowEdges,
} from '../renderers/scroll-shadow.js';
import { styleFor } from './style.js';

const SMOOTH_SCROLL_MS = 220;
const SMOOTH_FRAME_MS = 16;

function toNativeScrollCoord(positiveOffset: number): number {
  const clamped = Math.max(0, positiveOffset);
  return clamped === 0 ? 0 : -clamped;
}

function extractInstanceId(target: unknown): number | undefined {
  if (typeof target !== 'object' || target === null || !('id' in target)) return undefined;
  const id = (target as { id?: unknown }).id;
  return typeof id === 'number' && Number.isFinite(id) ? id : undefined;
}

function invokeNativeScrollIntoView(target: unknown): boolean {
  if (typeof target !== 'object' || target === null || !('scrollIntoView' in target)) {
    return false;
  }
  const fn = (target as { scrollIntoView?: unknown }).scrollIntoView;
  if (typeof fn !== 'function') return false;
  (fn as () => void)();
  return true;
}

/** Compiles `HostScrollViewProps` into a GPUIX native `StyleDesc` with fade scroll shadows. */
export function buildGpuiScrollViewStyle(
  props: HostScrollViewProps,
  context: RenderContext,
  resolvedScrollId?: string,
): StyleDesc {
  const {
    id,
    style,
    orientation = 'vertical',
    shadowSizePx,
    edges,
    transitionMs,
    hideScrollBar,
    overscrollBehavior,
    scrollPolicy,
    scrollId,
    hidden,
    isEnabled = true,
  } = props;
  const resolvedShadowSize =
    shadowSizePx === undefined ? DEFAULT_SCROLL_SHADOW_SIZE_PX : shadowSizePx;
  const resolvedEdges = resolveScrollShadowEdges(orientation, edges);
  const effectiveTransitionMs = context.viewport.reducedMotion
    ? 0
    : Math.max(0, Math.round(transitionMs ?? DEFAULT_SCROLL_SHADOW_TRANSITION_MS));
  const scrollShadow =
    isEnabled && resolvedShadowSize > 0 && resolvedEdges.activeEdges.length > 0
      ? {
          enabled: true,
          mode: 'fade' as const,
          size: resolvedShadowSize,
          transitionMs: effectiveTransitionMs,
          edges: [...resolvedEdges.activeEdges],
        }
      : undefined;
  const baseStyle = styleFor(style, context);

  return {
    ...baseStyle,
    display: hidden ? 'none' : 'flex',
    flexDirection: baseStyle.flexDirection ?? (orientation === 'horizontal' ? 'row' : 'column'),
    overflowX: orientation === 'horizontal' ? 'scroll' : 'hidden',
    overflowY: orientation === 'horizontal' ? 'hidden' : 'scroll',
    ...(hideScrollBar ? { scrollbarColor: undefined } : {}),
    overscrollBehavior: overscrollBehavior ?? 'contain',
    scrollPolicy: scrollPolicy ?? (orientation === 'horizontal' ? 'horizontal' : 'vertical'),
    scrollId: resolvedScrollId ?? scrollId ?? id,
    ...(scrollShadow ? { scrollShadow } : {}),
    flexShrink: 1,
  };
}

/** GPUIX native scroll container with smooth fade shadows and a `HausScrollHandle` ref API. */
export function GpuiScrollView({
  props,
  context,
}: {
  readonly props: HostScrollViewProps;
  readonly context: RenderContext;
}) {
  const { id, scrollId, role, ariaLabel, children, onScroll, scrollRef } = props;

  const { renderer } = useGpuix();
  const controller = useScrollController(scrollId ?? id);
  const divRef = useRef<PublicInstance | null>(null);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotionRef = useRef(context.viewport.reducedMotion);
  reducedMotionRef.current = context.viewport.reducedMotion;

  const cancelAnimation = () => {
    if (animTimerRef.current !== null) {
      clearTimeout(animTimerRef.current);
      animTimerRef.current = null;
    }
  };

  const cancelRetry = () => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  useEffect(
    () => () => {
      cancelAnimation();
      cancelRetry();
    },
    [],
  );

  const handle = useMemo<HausScrollHandle>(() => {
    const scrollTo = (optionsOrLeft: HausScrollToOptions | number, topArg?: number): void => {
      cancelAnimation();
      const opts: HausScrollToOptions =
        typeof optionsOrLeft === 'number'
          ? { left: optionsOrLeft, top: topArg ?? 0, behavior: 'instant' }
          : optionsOrLeft;

      const state = controller.getState();
      const currentLeft = Math.max(0, -(state?.offsetX ?? 0));
      const currentTop = Math.max(0, -(state?.offsetY ?? 0));
      const maxX = state?.maxX ?? Number.POSITIVE_INFINITY;
      const maxY = state?.maxY ?? Number.POSITIVE_INFINITY;
      const rawLeft = opts.left !== undefined ? Math.max(0, opts.left) : currentLeft;
      const rawTop = opts.top !== undefined ? Math.max(0, opts.top) : currentTop;
      const targetLeft = Number.isFinite(maxX) ? Math.min(rawLeft, maxX) : rawLeft;
      const targetTop = Number.isFinite(maxY) ? Math.min(rawTop, maxY) : rawTop;

      const smooth = opts.behavior === 'smooth' && !reducedMotionRef.current;
      const dx = targetLeft - currentLeft;
      const dy = targetTop - currentTop;
      if (!smooth || (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5)) {
        controller.scrollTo(toNativeScrollCoord(targetLeft), toNativeScrollCoord(targetTop));
        return;
      }

      const startAt = Date.now();
      const step = () => {
        const elapsed = Date.now() - startAt;
        const progress = Math.min(1, elapsed / SMOOTH_SCROLL_MS);
        const eased = 1 - (1 - progress) ** 3;
        controller.scrollTo(
          toNativeScrollCoord(currentLeft + dx * eased),
          toNativeScrollCoord(currentTop + dy * eased),
        );
        if (progress < 1) {
          animTimerRef.current = setTimeout(step, SMOOTH_FRAME_MS);
        } else {
          animTimerRef.current = null;
        }
      };
      step();
    };

    const tryScrollElementIntoView = (
      target: unknown,
      opts: HausScrollIntoViewOptions,
      allowRetry: boolean,
    ): boolean => {
      const axis = opts.axis ?? 'x';
      const align = opts.align ?? 'center';
      const behavior = opts.behavior ?? 'instant';
      const targetId = extractInstanceId(target);
      const containerId = divRef.current?.id;
      const targetBounds =
        targetId !== undefined ? (renderer?.getElementBounds?.(targetId) ?? null) : null;
      const containerBounds =
        containerId !== undefined ? (renderer?.getElementBounds?.(containerId) ?? null) : null;

      if (!targetBounds || !containerBounds) {
        const fallbackMoved = invokeNativeScrollIntoView(target);
        if (allowRetry && targetId !== undefined && containerId !== undefined) {
          cancelRetry();
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            tryScrollElementIntoView(target, opts, false);
          }, 32);
        }
        return fallbackMoved;
      }

      const state = controller.getState();
      if (axis === 'x') {
        const currentLeft = Math.max(0, -(state?.offsetX ?? 0));
        const viewWidth = containerBounds.width || (state?.viewportWidth ?? 0);
        const left = targetBounds.x - containerBounds.x + currentLeft;
        const right = left + targetBounds.width;
        if (left < currentLeft || right > currentLeft + viewWidth) {
          const nextLeft =
            align === 'center'
              ? Math.max(0, left - (viewWidth - targetBounds.width) / 2)
              : left < currentLeft
                ? Math.max(0, left)
                : Math.max(0, right - viewWidth);
          scrollTo({ left: nextLeft, behavior });
          return true;
        }
        return false;
      }

      const currentTop = Math.max(0, -(state?.offsetY ?? 0));
      const viewHeight = containerBounds.height || (state?.viewportHeight ?? 0);
      const top = targetBounds.y - containerBounds.y + currentTop;
      const bottom = top + targetBounds.height;
      if (top < currentTop || bottom > currentTop + viewHeight) {
        const nextTop =
          align === 'center'
            ? Math.max(0, top - (viewHeight - targetBounds.height) / 2)
            : top < currentTop
              ? Math.max(0, top)
              : Math.max(0, bottom - viewHeight);
        scrollTo({ top: nextTop, behavior });
        return true;
      }
      return false;
    };

    return {
      scrollTo,
      get scrollLeft() {
        return Math.max(0, -(controller.getState()?.offsetX ?? 0));
      },
      get scrollTop() {
        return Math.max(0, -(controller.getState()?.offsetY ?? 0));
      },
      get clientWidth() {
        return controller.getState()?.viewportWidth ?? 0;
      },
      get clientHeight() {
        return controller.getState()?.viewportHeight ?? 0;
      },
      get scrollWidth() {
        return controller.getState()?.contentWidth ?? 0;
      },
      get scrollHeight() {
        return controller.getState()?.contentHeight ?? 0;
      },
      scrollElementIntoView(target, opts = {}) {
        cancelRetry();
        return tryScrollElementIntoView(target, opts, true);
      },
    };
  }, [controller, renderer]);

  useEffect(() => {
    assignRef(scrollRef, handle);
    return () => assignRef(scrollRef, null);
  }, [scrollRef, handle]);

  return (
    <div
      ref={divRef}
      testId={id}
      role={role}
      aria-label={ariaLabel}
      onScrollChange={onScroll}
      style={buildGpuiScrollViewStyle(props, context, controller.scrollId)}
    >
      {children}
    </div>
  );
}
