/* @jsxImportSource @gpuix/react */
/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useRef } from 'react';
import { useGpuix, type EventPayload, type KeyEvent } from '@gpuix/react';
import type { HostRangeInputProps } from '../renderers/host.js';

export function GpuiRange({
  id,
  value,
  min,
  max,
  step,
  disabled,
  ariaLabel,
  onChange,
  onChangeEnd,
}: HostRangeInputProps) {
  const { renderer } = useGpuix();
  const dragStart = useRef<number | null>(null);
  const normalize = (next: number) => {
    const snapped = min + Math.round((next - min) / step) * step;
    return Math.round(Math.max(min, Math.min(max, snapped)) * 1e6) / 1e6;
  };
  const position = (event: EventPayload) => {
    const bounds = renderer?.getElementBounds?.(event.elementId);
    if (!bounds || bounds.width <= 0 || event.x === undefined) return undefined;
    const ratio = Math.max(0, Math.min(1, (event.x - bounds.x) / bounds.width));
    if (ratio === 0) return min;
    if (ratio === 1) return max;
    return normalize(min + ratio * (max - min));
  };
  const cancel = () => {
    const previous = dragStart.current;
    dragStart.current = null;
    if (previous !== null) onChange?.(previous);
  };
  const commit = (next: number) => {
    onChange?.(next);
    onChangeEnd?.(next);
  };
  const keyDown = (event: KeyEvent) => {
    const key = event.key?.toLowerCase();
    if (key === 'left' || key === 'down') commit(normalize(value - step));
    else if (key === 'right' || key === 'up') commit(normalize(value + step));
    else if (key === 'home') commit(min);
    else if (key === 'end') commit(max);
    else if (key === 'escape' && dragStart.current !== null) cancel();
    else return;
    event.preventDefault();
  };
  const inactive = disabled || !(step > 0) || !(max > min);
  return (
    <div
      testId={id}
      role="slider"
      aria-label={ariaLabel}
      aria-valuetext={String(value)}
      aria-disabled={inactive}
      tabIndex={inactive ? -1 : 0}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        cursor: inactive ? 'default' : 'pointer',
        focusVisible: { outlineColor: '#9bb6ff', outlineWidth: 2 },
      }}
      onMouseDown={
        inactive
          ? undefined
          : (event: EventPayload) => {
              if (event.button !== 0) return;
              const next = position(event);
              if (next === undefined) return;
              dragStart.current = value;
              renderer?.focusElement?.(event.elementId);
              onChange?.(next);
            }
      }
      onMouseMove={
        inactive
          ? undefined
          : (event: EventPayload) => {
              if (dragStart.current === null || event.pressedButton !== 0) return;
              const next = position(event);
              if (next !== undefined) onChange?.(next);
            }
      }
      onMouseUp={
        inactive
          ? undefined
          : (event: EventPayload) => {
              if (dragStart.current === null || event.button !== 0) return;
              const next = position(event);
              if (next === undefined) cancel();
              else {
                dragStart.current = null;
                commit(next);
              }
            }
      }
      onMouseLeave={cancel}
      onBlur={cancel}
      onKeyDown={inactive ? undefined : keyDown}
    />
  );
}
