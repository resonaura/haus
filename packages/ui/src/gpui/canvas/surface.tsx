/* @jsxImportSource @gpuix/react */
/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { EventPayload, ImgInstance, KeyEvent, PublicInstance, StyleDesc } from '@gpuix/react';
import { useGpuix } from '@gpuix/react';
import type { HostCanvasProps } from '../../renderers/host.js';
import { GpuiCanvasElement, installGpuiCanvasGlobals } from './element.js';

export interface GpuiCanvasProps {
  readonly canvas: HostCanvasProps;
  readonly style: StyleDesc;
  readonly autoFocus?: boolean;
  readonly onLayoutBounds?: (bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }) => void;
  readonly onWheel?: (event: EventPayload) => void;
  readonly onPointerDown?: (event: EventPayload) => void;
  readonly onPointerMove?: (event: EventPayload) => void;
  readonly onPointerUp?: (event: EventPayload) => void;
  readonly onRawKeyDown?: (event: KeyEvent) => void;
  readonly onFocusChange?: (focused: boolean) => void;
}

function assignRef(ref: HostCanvasProps['canvasRef'], value: GpuiCanvasElement | null): void {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(value);
  } else if ('current' in ref) {
    (ref as { current: unknown }).current = value;
  }
}

/**
 * Native GPUIX `<CanvasSurface />` implementation backed by `GpuiCanvasElement` (Skia 2D +
 * hardware OpenGL Core WebGL 2) composited directly onto a GPU-resident `<img>` texture.
 */
export function GpuiCanvas({
  canvas,
  style,
  autoFocus,
  onLayoutBounds,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onRawKeyDown,
  onFocusChange,
}: GpuiCanvasProps) {
  installGpuiCanvasGlobals();
  const { renderer } = useGpuix();
  const containerRef = useRef<PublicInstance>(null);
  const imageRef = useRef<ImgInstance>(null);
  const elementRef = useRef<GpuiCanvasElement | null>(null);
  if (!elementRef.current) {
    elementRef.current = new GpuiCanvasElement(canvas.width ?? 300, canvas.height ?? 150);
  }

  const callbacksRef = useRef({
    canvas,
    onLayoutBounds,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onRawKeyDown,
    onFocusChange,
  });
  callbacksRef.current = {
    canvas,
    onLayoutBounds,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onRawKeyDown,
    onFocusChange,
  };

  useLayoutEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    if (canvas.width !== undefined) el.width = canvas.width;
    if (canvas.height !== undefined) el.height = canvas.height;
  }, [canvas.width, canvas.height]);

  useLayoutEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    el.attachImage(imageRef.current);
    assignRef(canvas.canvasRef, el);
    return () => {
      assignRef(canvas.canvasRef, null);
      el.attachImage(null);
    };
  }, [canvas.canvasRef]);

  useEffect(() => {
    return () => {
      elementRef.current?.dispose();
      elementRef.current = null;
    };
  }, []);

  const dispatchPointer = (type: string, event: EventPayload) => {
    const el = elementRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clientX = event.x ?? rect.left;
    const clientY = event.y ?? rect.top;
    el.dispatchEvent({
      type,
      clientX,
      clientY,
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top,
      button: event.button ?? 0,
      buttons:
        event.pressedButton !== undefined ? 1 << event.pressedButton : event.button === 0 ? 1 : 0,
      pointerId: 1,
      pointerType: 'mouse',
      target: el,
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
    });
  };

  const handleLayout = (event: EventPayload) => {
    const el = elementRef.current;
    if (!el) return;
    const width = Math.max(1, event.width ?? el.width);
    const height = Math.max(1, event.height ?? el.height);
    const x = event.x ?? 0;
    const y = event.y ?? 0;
    el.setLayoutBounds(x, y, width, height);
    callbacksRef.current.onLayoutBounds?.({ x, y, width, height });
  };

  const handleMouseDown = (event: EventPayload) => {
    const node = containerRef.current;
    if (node && (canvas.tabIndex !== undefined || callbacksRef.current.onRawKeyDown)) {
      renderer?.focusElement?.(node.id);
    }
    dispatchPointer('pointerdown', event);
    dispatchPointer('mousedown', event);
    callbacksRef.current.onPointerDown?.(event);
    const onClickRatio = callbacksRef.current.canvas.onClickRatio;
    const el = elementRef.current;
    if (onClickRatio && el && event.x !== undefined && event.y !== undefined) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const rx = Math.max(0, Math.min(1, (event.x - rect.left) / rect.width));
        const ry = Math.max(0, Math.min(1, (event.y - rect.top) / rect.height));
        onClickRatio(rx, ry);
      }
    }
  };

  const handleMouseMove = (event: EventPayload) => {
    dispatchPointer('pointermove', event);
    dispatchPointer('mousemove', event);
    callbacksRef.current.onPointerMove?.(event);
  };

  const handleMouseUp = (event: EventPayload) => {
    dispatchPointer('pointerup', event);
    dispatchPointer('mouseup', event);
    callbacksRef.current.onPointerUp?.(event);
  };

  const handleScroll = (event: EventPayload) => {
    const el = elementRef.current;
    if (el) {
      el.dispatchEvent({
        type: 'wheel',
        deltaX: event.deltaX ?? 0,
        deltaY: -(event.deltaY ?? 0),
        deltaMode: event.precise ? 0 : 1,
        target: el,
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
      });
    }
    callbacksRef.current.onWheel?.(event);
  };

  const handleKeyDown = (event: KeyEvent) => {
    callbacksRef.current.onRawKeyDown?.(event);
    callbacksRef.current.canvas.onKeyDown?.({
      key: event.key ?? '',
      target: elementRef.current,
      currentTarget: elementRef.current,
      preventDefault: () => event.preventDefault(),
      stopPropagation: () => event.stopPropagation(),
    });
  };

  return (
    <div
      ref={containerRef}
      testId={canvas.id}
      role={canvas.ariaHidden ? 'presentation' : (canvas.role ?? 'img')}
      aria-label={canvas.ariaHidden ? undefined : canvas.ariaLabel}
      aria-valuetext={canvas.ariaValueText}
      tabIndex={canvas.tabIndex}
      autoFocus={autoFocus}
      onLayout={handleLayout}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onScroll={handleScroll}
      onKeyDown={canvas.onKeyDown || onRawKeyDown ? handleKeyDown : undefined}
      onFocus={onFocusChange ? () => callbacksRef.current.onFocusChange?.(true) : undefined}
      onBlur={onFocusChange ? () => callbacksRef.current.onFocusChange?.(false) : undefined}
      style={{
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
        keyboardFocusDim: false,
        ...style,
      }}
    >
      <img
        ref={imageRef}
        objectFit="fill"
        style={{
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  );
}
