/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import type { RenderContext } from './contract.js';
import type { HostScrollViewProps } from './host.js';
import { compileStyleToReactCss } from './react-dom.js';
import {
  computeScrollShadowTargets,
  DEFAULT_SCROLL_SHADOW_SIZE_PX,
  DEFAULT_SCROLL_SHADOW_TRANSITION_MS,
  resolveScrollShadowEdges,
} from './scroll-shadow.js';

const SCROLL_SHADOW_STYLE_ATTR = 'data-haus-scroll-shadow-css';

/**
 * Smoothstep-matched multi-stop CSS mask with `@property` `<length>` interpolation so
 * edge fade masks appear and disappear smoothly with zero React re-renders during scroll.
 */
export const HAUS_DOM_SCROLL_SHADOW_CSS = `
@property --haus-ss-start {
  syntax: '<length>';
  inherits: false;
  initial-value: 0px;
}
@property --haus-ss-end {
  syntax: '<length>';
  inherits: false;
  initial-value: 0px;
}
[data-haus-scroll-shadow='true'] {
  --haus-ss-duration: ${DEFAULT_SCROLL_SHADOW_TRANSITION_MS}ms;
  transition:
    --haus-ss-start var(--haus-ss-duration) cubic-bezier(0.22, 1, 0.36, 1),
    --haus-ss-end var(--haus-ss-duration) cubic-bezier(0.22, 1, 0.36, 1);
}
[data-haus-scroll-shadow='true'][data-orientation='vertical'] {
  mask-image: linear-gradient(
    to bottom,
    transparent 0px,
    rgb(0 0 0 / 0.16) calc(var(--haus-ss-start) * 0.25),
    rgb(0 0 0 / 0.5) calc(var(--haus-ss-start) * 0.5),
    rgb(0 0 0 / 0.84) calc(var(--haus-ss-start) * 0.75),
    #000 var(--haus-ss-start),
    #000 calc(100% - var(--haus-ss-end)),
    rgb(0 0 0 / 0.84) calc(100% - var(--haus-ss-end) * 0.75),
    rgb(0 0 0 / 0.5) calc(100% - var(--haus-ss-end) * 0.5),
    rgb(0 0 0 / 0.16) calc(100% - var(--haus-ss-end) * 0.25),
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0px,
    rgb(0 0 0 / 0.16) calc(var(--haus-ss-start) * 0.25),
    rgb(0 0 0 / 0.5) calc(var(--haus-ss-start) * 0.5),
    rgb(0 0 0 / 0.84) calc(var(--haus-ss-start) * 0.75),
    #000 var(--haus-ss-start),
    #000 calc(100% - var(--haus-ss-end)),
    rgb(0 0 0 / 0.84) calc(100% - var(--haus-ss-end) * 0.75),
    rgb(0 0 0 / 0.5) calc(100% - var(--haus-ss-end) * 0.5),
    rgb(0 0 0 / 0.16) calc(100% - var(--haus-ss-end) * 0.25),
    transparent 100%
  );
}
[data-haus-scroll-shadow='true'][data-orientation='horizontal'] {
  mask-image: linear-gradient(
    to right,
    transparent 0px,
    rgb(0 0 0 / 0.16) calc(var(--haus-ss-start) * 0.25),
    rgb(0 0 0 / 0.5) calc(var(--haus-ss-start) * 0.5),
    rgb(0 0 0 / 0.84) calc(var(--haus-ss-start) * 0.75),
    #000 var(--haus-ss-start),
    #000 calc(100% - var(--haus-ss-end)),
    rgb(0 0 0 / 0.84) calc(100% - var(--haus-ss-end) * 0.75),
    rgb(0 0 0 / 0.5) calc(100% - var(--haus-ss-end) * 0.5),
    rgb(0 0 0 / 0.16) calc(100% - var(--haus-ss-end) * 0.25),
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to right,
    transparent 0px,
    rgb(0 0 0 / 0.16) calc(var(--haus-ss-start) * 0.25),
    rgb(0 0 0 / 0.5) calc(var(--haus-ss-start) * 0.5),
    rgb(0 0 0 / 0.84) calc(var(--haus-ss-start) * 0.75),
    #000 var(--haus-ss-start),
    #000 calc(100% - var(--haus-ss-end)),
    rgb(0 0 0 / 0.84) calc(100% - var(--haus-ss-end) * 0.75),
    rgb(0 0 0 / 0.5) calc(100% - var(--haus-ss-end) * 0.5),
    rgb(0 0 0 / 0.16) calc(100% - var(--haus-ss-end) * 0.25),
    transparent 100%
  );
}
[data-haus-scroll-shadow='true'][data-haus-ss-static='true'] {
  transition: none;
}
@media (prefers-reduced-motion: reduce) {
  [data-haus-scroll-shadow='true'] {
    transition: none;
  }
}
`.trim();

/** Idempotently appends the `@haus/ui` smooth scroll-shadow stylesheet into `<head>`. */
export function ensureDomScrollShadowStyle(doc?: Document): void {
  const targetDoc = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!targetDoc?.head) return;
  if (targetDoc.head.querySelector(`style[${SCROLL_SHADOW_STYLE_ATTR}]`)) return;
  const style = targetDoc.createElement('style');
  style.setAttribute(SCROLL_SHADOW_STYLE_ATTR, '1');
  style.textContent = HAUS_DOM_SCROLL_SHADOW_CSS;
  targetDoc.head.append(style);
}

/** Browser / Electron DOM scroll container with smooth alpha-fade edge masks. */
export function DomScrollView({
  props,
  context,
}: {
  readonly props: HostScrollViewProps;
  readonly context: RenderContext;
}): React.ReactElement {
  const orientation = props.orientation ?? 'vertical';
  const size =
    props.shadowSizePx === undefined ? DEFAULT_SCROLL_SHADOW_SIZE_PX : props.shadowSizePx;
  const edges = resolveScrollShadowEdges(orientation, props.edges);
  const shadowActive = props.isEnabled !== false && size > 0 && (edges.start || edges.end);
  const transitionMs = context.viewport.reducedMotion
    ? 0
    : Math.max(0, Math.round(props.transitionMs ?? DEFAULT_SCROLL_SHADOW_TRANSITION_MS));

  const ref = React.useRef<HTMLDivElement | null>(null);
  const lastAppliedRef = React.useRef<{ start: string; end: string }>({ start: '', end: '' });

  const syncMask = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (!shadowActive) {
      if (lastAppliedRef.current.start !== '0px' || lastAppliedRef.current.end !== '0px') {
        lastAppliedRef.current = { start: '0px', end: '0px' };
        el.style.setProperty('--haus-ss-start', '0px');
        el.style.setProperty('--haus-ss-end', '0px');
      }
      return;
    }
    const offsetPx = orientation === 'horizontal' ? el.scrollLeft : el.scrollTop;
    const maxOffsetPx =
      orientation === 'horizontal'
        ? Math.max(0, el.scrollWidth - el.clientWidth)
        : Math.max(0, el.scrollHeight - el.clientHeight);
    const targets = computeScrollShadowTargets({
      offsetPx,
      maxOffsetPx,
      sizePx: size,
      startEnabled: edges.start,
      endEnabled: edges.end,
    });
    const nextStart = `${targets.startPx.toFixed(2)}px`;
    const nextEnd = `${targets.endPx.toFixed(2)}px`;
    if (lastAppliedRef.current.start !== nextStart) {
      lastAppliedRef.current.start = nextStart;
      el.style.setProperty('--haus-ss-start', nextStart);
    }
    if (lastAppliedRef.current.end !== nextEnd) {
      lastAppliedRef.current.end = nextEnd;
      el.style.setProperty('--haus-ss-end', nextEnd);
    }
  }, [orientation, size, shadowActive, edges.start, edges.end]);

  React.useLayoutEffect(() => {
    ensureDomScrollShadowStyle(ref.current?.ownerDocument);
    const el = ref.current;
    if (!el) return undefined;
    el.dataset.hausSsStatic = 'true';
    syncMask();
    if (transitionMs === 0 || typeof requestAnimationFrame !== 'function') {
      if (transitionMs > 0) delete el.dataset.hausSsStatic;
      return undefined;
    }
    const raf = requestAnimationFrame(() => {
      if (ref.current === el) delete el.dataset.hausSsStatic;
    });
    return () => cancelAnimationFrame(raf);
  }, [syncMask, transitionMs]);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let frame = 0;
    const schedule = () => {
      if (frame !== 0) return;
      if (typeof requestAnimationFrame === 'function') {
        frame = requestAnimationFrame(() => {
          frame = 0;
          syncMask();
        });
      } else {
        syncMask();
      }
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : undefined;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);

    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(schedule) : undefined;
    mo?.observe(el, { childList: true, subtree: true });

    syncMask();
    return () => {
      if (frame !== 0 && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frame);
      }
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [syncMask, props.children]);

  const { style: baseCss } = compileStyleToReactCss(props.style ?? {}, context);
  const classes = ['scroll-shadow', props.className].filter(Boolean).join(' ');

  const setRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      ref.current = node;
      const external = props.scrollRef;
      if (typeof external === 'function') external(node);
      else if (external && typeof external === 'object') {
        (external as { current: unknown }).current = node;
      }
    },
    [props.scrollRef],
  );

  const shadowVars = shadowActive
    ? ({ '--haus-ss-duration': `${transitionMs}ms` } as React.CSSProperties)
    : undefined;

  return (
    <div
      ref={setRef}
      id={props.id}
      className={classes}
      hidden={props.hidden}
      role={props.role}
      aria-label={props.ariaLabel}
      onScroll={() => {
        syncMask();
        props.onScroll?.();
      }}
      data-haus-kind="scroll"
      data-orientation={orientation}
      data-haus-scroll-shadow={shadowActive ? 'true' : undefined}
      style={{
        overflowX: orientation === 'horizontal' ? 'auto' : 'hidden',
        overflowY: orientation === 'vertical' ? 'auto' : 'hidden',
        ...(props.hideScrollBar ? { scrollbarWidth: 'none' } : {}),
        ...shadowVars,
        ...baseCss,
      }}
    >
      {props.children}
    </div>
  );
}
