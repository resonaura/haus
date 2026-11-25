/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import type {
  UiMotionEase,
  UiMotionScalarTarget,
  UiMotionSpec,
  UiMotionValue,
} from '../ir/motion.js';
import type { HostBoxProps } from './host.js';
import { BOX_SEMANTIC_TAG, buildDomBoxProps } from './dom-helpers.js';

function easeToCss(ease: UiMotionEase | undefined): string {
  if (!ease) return 'ease';
  if (Array.isArray(ease)) {
    return `cubic-bezier(${ease[0]}, ${ease[1]}, ${ease[2]}, ${ease[3]})`;
  }
  switch (ease) {
    case 'linear':
      return 'linear';
    case 'easeIn':
      return 'ease-in';
    case 'easeOut':
      return 'ease-out';
    case 'easeInOut':
      return 'ease-in-out';
    case 'circIn':
      return 'cubic-bezier(0.55, 0, 1, 0.45)';
    case 'circOut':
      return 'cubic-bezier(0, 0.55, 0.45, 1)';
    case 'circInOut':
      return 'cubic-bezier(0.85, 0, 0.15, 1)';
    case 'backIn':
      return 'cubic-bezier(0.36, 0, 0.66, -0.56)';
    case 'backOut':
      return 'cubic-bezier(0.34, 1.56, 0.64, 1)';
    case 'backInOut':
      return 'cubic-bezier(0.68, -0.6, 0.32, 1.6)';
    default:
      return 'ease';
  }
}

function finalScalar(value: UiMotionValue | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  for (let i = value.length - 1; i >= 0; i--) {
    const item = value[i];
    if (typeof item === 'number') return item;
  }
  return undefined;
}

function resolveTransformString(
  values: {
    readonly x?: number;
    readonly y?: number;
    readonly scale?: number;
    readonly scaleX?: number;
    readonly scaleY?: number;
    readonly rotate?: number;
  },
  baseTransform?: string,
): string | undefined {
  const parts: string[] = [];
  if (values.x !== undefined || values.y !== undefined) {
    parts.push(`translate3d(${values.x ?? 0}px, ${values.y ?? 0}px, 0)`);
  }
  if (values.scale !== undefined) {
    parts.push(`scale(${values.scale})`);
  }
  if (values.scaleX !== undefined) {
    parts.push(`scaleX(${values.scaleX})`);
  }
  if (values.scaleY !== undefined) {
    parts.push(`scaleY(${values.scaleY})`);
  }
  if (values.rotate !== undefined) {
    parts.push(`rotate(${values.rotate}deg)`);
  }
  if (!parts.length) return baseTransform;
  return baseTransform ? `${baseTransform} ${parts.join(' ')}` : parts.join(' ');
}

function scalarSnapshot(animate: UiMotionSpec['animate']): UiMotionScalarTarget {
  return {
    opacity: finalScalar(animate.opacity),
    left: finalScalar(animate.left),
    x: finalScalar(animate.x),
    y: finalScalar(animate.y),
    scale: finalScalar(animate.scale),
    scaleX: finalScalar(animate.scaleX),
    scaleY: finalScalar(animate.scaleY),
    rotate: finalScalar(animate.rotate),
    blur: finalScalar(animate.blur),
  };
}

function hasKeyframeArray(animate: UiMotionSpec['animate']): boolean {
  return (
    Array.isArray(animate.opacity) ||
    Array.isArray(animate.left) ||
    Array.isArray(animate.x) ||
    Array.isArray(animate.y) ||
    Array.isArray(animate.scale) ||
    Array.isArray(animate.scaleX) ||
    Array.isArray(animate.scaleY) ||
    Array.isArray(animate.rotate) ||
    Array.isArray(animate.blur)
  );
}

function valueAt(
  value: UiMotionValue | undefined,
  index: number,
  total: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  const clamped = Math.min(
    value.length - 1,
    Math.max(0, Math.round((index / Math.max(1, total - 1)) * (value.length - 1))),
  );
  const direct = value[index] ?? value[clamped];
  if (typeof direct === 'number') return direct;
  return finalScalar(value);
}

function buildWaaKeyframes(motion: UiMotionSpec, baseTransform: string | undefined): Keyframe[] {
  const { animate, times } = motion;
  const counts = [
    Array.isArray(animate.opacity) ? animate.opacity.length : 0,
    Array.isArray(animate.left) ? animate.left.length : 0,
    Array.isArray(animate.x) ? animate.x.length : 0,
    Array.isArray(animate.y) ? animate.y.length : 0,
    Array.isArray(animate.scale) ? animate.scale.length : 0,
    Array.isArray(animate.scaleX) ? animate.scaleX.length : 0,
    Array.isArray(animate.scaleY) ? animate.scaleY.length : 0,
    Array.isArray(animate.rotate) ? animate.rotate.length : 0,
    Array.isArray(animate.blur) ? animate.blur.length : 0,
  ];
  const frameCount = Math.max(2, ...counts);
  const frames: Keyframe[] = [];
  for (let i = 0; i < frameCount; i++) {
    const frame: Keyframe = {};
    const opacity = valueAt(animate.opacity, i, frameCount);
    if (opacity !== undefined) frame.opacity = opacity;
    const left = valueAt(animate.left, i, frameCount);
    if (left !== undefined) frame.left = `${left}px`;
    const blur = valueAt(animate.blur, i, frameCount);
    if (blur !== undefined) frame.filter = blur > 0 ? `blur(${blur}px)` : 'blur(0px)';
    const transform = resolveTransformString(
      {
        x: valueAt(animate.x, i, frameCount),
        y: valueAt(animate.y, i, frameCount),
        scale: valueAt(animate.scale, i, frameCount),
        scaleX: valueAt(animate.scaleX, i, frameCount),
        scaleY: valueAt(animate.scaleY, i, frameCount),
        rotate: valueAt(animate.rotate, i, frameCount),
      },
      baseTransform,
    );
    if (transform) frame.transform = transform;
    if (times && times[i] !== undefined) frame.offset = times[i];
    frames.push(frame);
  }
  return frames;
}

function applyScalarTransitionCss(
  motion: UiMotionSpec,
  target: React.CSSProperties,
  reducedMotion: boolean,
): React.CSSProperties {
  const scalars = scalarSnapshot(motion.animate);
  const baseTransform = typeof target.transform === 'string' ? target.transform : undefined;
  const transform = resolveTransformString(scalars, baseTransform);
  const next: React.CSSProperties = { ...target };
  if (scalars.opacity !== undefined) next.opacity = scalars.opacity;
  if (scalars.left !== undefined) next.left = `${scalars.left}px`;
  if (transform !== undefined) next.transform = transform;
  if (scalars.blur !== undefined) {
    next.filter = scalars.blur > 0 ? `blur(${scalars.blur}px)` : 'none';
  }
  if (motion.originX !== undefined || motion.originY !== undefined) {
    next.transformOrigin = `${(motion.originX ?? 0.5) * 100}% ${(motion.originY ?? 0.5) * 100}%`;
  }
  if (!reducedMotion && !hasKeyframeArray(motion.animate) && motion.repeat === undefined) {
    const opacityDur = motion.propertyDurationsMs?.opacity ?? motion.durationMs;
    const transformDur = motion.propertyDurationsMs?.transform ?? motion.durationMs;
    const opacityEase = easeToCss(motion.propertyEases?.opacity ?? motion.ease);
    const transformEase = easeToCss(motion.propertyEases?.transform ?? motion.ease);
    const transitions = [
      `opacity ${opacityDur}ms ${opacityEase}`,
      `transform ${transformDur}ms ${transformEase}`,
    ];
    if (scalars.left !== undefined) {
      transitions.push(`left ${transformDur}ms ${transformEase}`);
    }
    if (scalars.blur !== undefined) {
      transitions.push(`filter ${motion.durationMs}ms ${easeToCss(motion.ease)}`);
    }
    if (typeof target.transition === 'string' && target.transition) {
      transitions.unshift(target.transition);
    }
    next.transition = transitions.join(', ');
  }
  return next;
}

function assignRef(ref: React.Ref<unknown> | undefined, node: HTMLElement | null): void {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(node);
  } else if ('current' in ref) {
    (ref as { current: unknown }).current = node;
  }
}

export function DomMotionBox({
  props,
  motion,
  mergedStyle,
  shaderId,
  reducedMotion,
}: {
  readonly props: HostBoxProps;
  readonly motion: UiMotionSpec;
  readonly mergedStyle: React.CSSProperties;
  readonly shaderId?: string;
  readonly reducedMotion: boolean;
}): React.ReactElement {
  const elementRef = React.useRef<HTMLElement | null>(null);
  const motionRef = React.useRef(motion);
  motionRef.current = motion;
  const isKeyframeOrRepeat =
    !reducedMotion && (hasKeyframeArray(motion.animate) || motion.repeat !== undefined);
  const styled = applyScalarTransitionCss(motion, mergedStyle, reducedMotion);
  const baseTransform =
    typeof mergedStyle.transform === 'string' ? mergedStyle.transform : undefined;

  const keyframeSignature = isKeyframeOrRepeat ? JSON.stringify(motion) : '';
  React.useEffect(() => {
    if (!isKeyframeOrRepeat || reducedMotion || !keyframeSignature) return;
    const activeMotion = motionRef.current;
    const el = elementRef.current;
    if (!el || typeof el.animate !== 'function') return;
    const keyframes = buildWaaKeyframes(activeMotion, baseTransform);
    const iterations =
      activeMotion.repeat === 'Infinity'
        ? Infinity
        : activeMotion.repeat !== undefined
          ? activeMotion.repeat + 1
          : 1;
    const direction =
      activeMotion.repeatType === 'reverse' || activeMotion.repeatType === 'mirror'
        ? 'alternate'
        : 'normal';
    const anim = el.animate(keyframes, {
      duration: Math.max(1, activeMotion.durationMs),
      delay: activeMotion.delayMs ?? 0,
      easing: easeToCss(activeMotion.ease),
      iterations,
      direction,
    });
    return () => {
      anim.cancel();
    };
  }, [keyframeSignature, isKeyframeOrRepeat, reducedMotion, baseTransform]);

  const tag = BOX_SEMANTIC_TAG[props.semantic ?? 'box'];
  const domProps = buildDomBoxProps(props, styled, shaderId);
  domProps.ref = (node: HTMLElement | null) => {
    elementRef.current = node;
    assignRef(props.boxRef, node);
  };
  return tag === 'col'
    ? React.createElement(tag, domProps)
    : React.createElement(tag, domProps, props.children);
}
