/* @jsxImportSource @gpuix/react */
/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  animate,
  useGpuix,
  useMotionValue,
  type PublicInstance,
  type StyleDesc,
} from '@gpuix/react';
import { assignRef } from '../renderers/scroll-handle.js';

export function GpuiLayoutBox({
  layoutTransition,
  reducedMotion,
  boxRef,
  style,
  elementProps,
}: {
  readonly layoutTransition: string;
  readonly reducedMotion: boolean;
  readonly boxRef?: React.Ref<unknown>;
  readonly style: StyleDesc;
  readonly elementProps: Omit<import('@gpuix/react').Props, 'ref' | 'style'>;
}) {
  const { renderer } = useGpuix();
  const tx = useMotionValue(0);
  const ty = useMotionValue(0);
  const nodeRef = useRef<PublicInstance | null>(null);
  const prevPosRef = useRef<{ x: number; y: number } | null>(null);
  const prevTokenRef = useRef<string>(layoutTransition);
  const stopRef = useRef<{ x?: () => void; y?: () => void }>({});

  useLayoutEffect(() => {
    const instance = nodeRef.current;
    if (!instance || !renderer?.getElementBounds) return;
    const inFlightX = tx.get();
    const inFlightY = ty.get();
    if (inFlightX !== 0) tx.jump(0);
    if (inFlightY !== 0) ty.jump(0);

    const bounds = renderer.getElementBounds(instance.id);
    if (!bounds || (bounds.width === 0 && bounds.height === 0)) return;
    const scrollState = renderer.getScrollState?.('main-scroll');
    const docX = bounds.x - (scrollState?.offsetX ?? 0);
    const docY = bounds.y - (scrollState?.offsetY ?? 0);

    const prev = prevPosRef.current;
    const tokenChanged = prevTokenRef.current !== layoutTransition;
    prevTokenRef.current = layoutTransition;
    prevPosRef.current = { x: docX, y: docY };

    if (!reducedMotion && prev && tokenChanged) {
      const dx = prev.x + inFlightX - docX;
      const dy = prev.y + inFlightY - docY;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        stopRef.current.x?.();
        stopRef.current.y?.();
        tx.jump(dx);
        ty.jump(dy);
        const animX = animate(tx, 0, { duration: 0.32, ease: [0.22, 0.8, 0.22, 1] });
        const animY = animate(ty, 0, { duration: 0.32, ease: [0.22, 0.8, 0.22, 1] });
        stopRef.current = { x: animX.stop, y: animY.stop };
      }
    }
  }, [layoutTransition, reducedMotion, renderer, tx, ty]);

  useEffect(
    () => () => {
      stopRef.current.x?.();
      stopRef.current.y?.();
    },
    [],
  );

  const existingBinds = Array.isArray(style.motionBind)
    ? style.motionBind
    : style.motionBind
      ? [style.motionBind]
      : [];

  return (
    <div
      {...elementProps}
      ref={(node: PublicInstance | null) => {
        nodeRef.current = node;
        if (boxRef) assignRef(boxRef, node);
      }}
      style={{
        ...style,
        motionBind: [...existingBinds, tx.bind('translateX'), ty.bind('translateY')],
      }}
    />
  );
}
