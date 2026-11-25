/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import type { RenderContext } from './contract.js';
import type { HostPopoverProps } from './host.js';
import { compileStyleToReactCss } from './react-dom.js';

export interface PopoverRect {
  readonly top: number;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

const DEFAULT_GAP = 8;
const DEFAULT_VIEWPORT_PADDING = 8;
const MIN_POPOVER_Z_INDEX = 1100;

function alignedCoordinate(
  anchorStart: number,
  anchorSize: number,
  surfaceSize: number,
  align: 'start' | 'center' | 'end',
): number {
  if (align === 'center') return anchorStart + (anchorSize - surfaceSize) / 2;
  if (align === 'end') return anchorStart + anchorSize - surfaceSize;
  return anchorStart;
}

/** Computes viewport-clamped `position: fixed` coordinates for a portaled DOM popover. */
export function computePopoverPosition({
  anchor,
  surface,
  viewport,
  placement,
  align = 'start',
  gap = DEFAULT_GAP,
  padding = DEFAULT_VIEWPORT_PADDING,
}: {
  readonly anchor: PopoverRect;
  readonly surface: { readonly width: number; readonly height: number };
  readonly viewport: { readonly width: number; readonly height: number };
  readonly placement: 'top' | 'bottom' | 'left' | 'right';
  readonly align?: 'start' | 'center' | 'end';
  readonly gap?: number;
  readonly padding?: number;
}): {
  readonly top: number;
  readonly left: number;
  readonly placement: 'top' | 'bottom' | 'left' | 'right';
} {
  const spaceAbove = anchor.top - padding - gap;
  const spaceBelow = viewport.height - anchor.bottom - padding - gap;
  const spaceLeft = anchor.left - padding - gap;
  const spaceRight = viewport.width - anchor.right - padding - gap;

  let resolved = placement;
  if (placement === 'bottom' && surface.height > spaceBelow && spaceAbove > spaceBelow) {
    resolved = 'top';
  } else if (placement === 'top' && surface.height > spaceAbove && spaceBelow > spaceAbove) {
    resolved = 'bottom';
  } else if (placement === 'right' && surface.width > spaceRight && spaceLeft > spaceRight) {
    resolved = 'left';
  } else if (placement === 'left' && surface.width > spaceLeft && spaceRight > spaceLeft) {
    resolved = 'right';
  }

  let rawLeft: number;
  let rawTop: number;
  if (resolved === 'top') {
    rawTop = anchor.top - gap - surface.height;
    rawLeft = alignedCoordinate(anchor.left, anchor.width, surface.width, align);
  } else if (resolved === 'bottom') {
    rawTop = anchor.bottom + gap;
    rawLeft = alignedCoordinate(anchor.left, anchor.width, surface.width, align);
  } else if (resolved === 'left') {
    rawLeft = anchor.left - gap - surface.width;
    rawTop = alignedCoordinate(anchor.top, anchor.height, surface.height, align);
  } else {
    rawLeft = anchor.right + gap;
    rawTop = alignedCoordinate(anchor.top, anchor.height, surface.height, align);
  }

  const maxLeft = Math.max(padding, viewport.width - surface.width - padding);
  const maxTop = Math.max(padding, viewport.height - surface.height - padding);
  return {
    left: Math.round(Math.min(maxLeft, Math.max(padding, rawLeft))),
    top: Math.round(Math.min(maxTop, Math.max(padding, rawTop))),
    placement: resolved,
  };
}

/** Browser / Electron portal-backed popover that avoids ancestor backdrop-filter trapping. */
export function DomPopover({
  props,
  context,
}: {
  readonly props: HostPopoverProps;
  readonly context: RenderContext;
}): React.ReactElement {
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const surfaceRef = React.useRef<HTMLDivElement>(null);
  const [coords, setCoords] = React.useState<{
    readonly top: number;
    readonly left: number;
  } | null>(null);

  const { open, placement, align = 'start', onOpenChange, portal } = props;

  React.useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return undefined;
    }
    const updatePosition = () => {
      const anchorEl = anchorRef.current;
      const surfaceEl = surfaceRef.current;
      if (!anchorEl || !surfaceEl || typeof window === 'undefined') return;
      const next = computePopoverPosition({
        anchor: anchorEl.getBoundingClientRect(),
        surface: surfaceEl.getBoundingClientRect(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        placement,
        align,
      });
      setCoords((prev) =>
        prev && prev.top === next.top && prev.left === next.left
          ? prev
          : { top: next.top, left: next.left },
      );
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updatePosition);
      if (anchorRef.current) ro.observe(anchorRef.current);
      if (surfaceRef.current) ro.observe(surfaceRef.current);
    }
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      ro?.disconnect();
    };
  }, [open, placement, align]);

  React.useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (surfaceRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, onOpenChange]);

  const { style: anchorCss } = compileStyleToReactCss(props.anchorStyle, context);
  const { style: rawSurfaceCss } = compileStyleToReactCss(props.surfaceStyle, context);
  const {
    position: _position,
    top: _top,
    right: _right,
    bottom: _bottom,
    left: _left,
    marginTop: _marginTop,
    marginRight: _marginRight,
    marginBottom: _marginBottom,
    marginLeft: _marginLeft,
    ...cleanSurfaceCss
  } = rawSurfaceCss;
  const parsedZIndex =
    typeof cleanSurfaceCss.zIndex === 'number'
      ? cleanSurfaceCss.zIndex
      : Number(cleanSurfaceCss.zIndex) || 0;

  const surfaceElement = open ? (
    <div
      ref={surfaceRef}
      id={props.id}
      role="dialog"
      className={props.className}
      data-haus-kind="popover"
      style={{
        ...cleanSurfaceCss,
        position: 'fixed',
        top: coords?.top ?? 0,
        left: coords?.left ?? 0,
        zIndex: Math.max(parsedZIndex, MIN_POPOVER_Z_INDEX),
        ...(coords === null && typeof window !== 'undefined' ? { visibility: 'hidden' } : {}),
      }}
    >
      {props.children}
    </div>
  ) : null;

  return (
    <div ref={anchorRef} data-haus-kind="popover-anchor" style={anchorCss}>
      {props.trigger}
      {surfaceElement ? (portal ? portal(surfaceElement) : surfaceElement) : null}
    </div>
  );
}
