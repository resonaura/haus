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

/** Browser / Electron DOM scroll container with dynamic edge fade shadows. */
export function DomScrollView({
  props,
  context,
}: {
  readonly props: HostScrollViewProps;
  readonly context: RenderContext;
}): React.ReactElement {
  const orientation = props.orientation ?? 'vertical';
  const size = props.shadowSizePx ?? 24;
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [edge, setEdge] = React.useState<{ start: boolean; end: boolean }>({
    start: false,
    end: false,
  });

  const updateEdges = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (orientation === 'horizontal') {
      const start = el.scrollLeft > 2;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setEdge((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    } else {
      const start = el.scrollTop > 2;
      const end = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
      setEdge((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    }
  }, [orientation]);

  React.useEffect(() => {
    updateEdges();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(updateEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateEdges, props.children]);

  const { style: baseCss } = compileStyleToReactCss(props.style ?? {}, context);
  const axis = orientation === 'horizontal' ? 'to right' : 'to bottom';
  const maskImage =
    props.isEnabled !== false && (edge.start || edge.end)
      ? `linear-gradient(${axis}, ${edge.start ? `transparent 0px, black ${size}px` : 'black 0px'}, ${edge.end ? `black calc(100% - ${size}px), transparent 100%` : 'black 100%'})`
      : undefined;

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

  return (
    <div
      ref={setRef}
      id={props.id}
      className={classes}
      hidden={props.hidden}
      role={props.role}
      aria-label={props.ariaLabel}
      onScroll={() => {
        updateEdges();
        props.onScroll?.();
      }}
      data-haus-kind="scroll"
      data-orientation={orientation}
      style={{
        overflowX: orientation === 'horizontal' ? 'auto' : 'hidden',
        overflowY: orientation === 'vertical' ? 'auto' : 'hidden',
        ...(props.hideScrollBar ? { scrollbarWidth: 'none' } : {}),
        ...(maskImage ? { maskImage, WebkitMaskImage: maskImage } : {}),
        ...baseCss,
      }}
    >
      {props.children}
    </div>
  );
}
