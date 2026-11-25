/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export type UiMotionEase =
  | 'linear'
  | 'ease'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'circIn'
  | 'circOut'
  | 'circInOut'
  | 'backIn'
  | 'backOut'
  | 'backInOut'
  | readonly [number, number, number, number];

export interface UiMotionScalarTarget {
  readonly opacity?: number;
  readonly left?: number;
  readonly x?: number;
  readonly y?: number;
  readonly scale?: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly rotate?: number;
  readonly blur?: number;
}

export type UiMotionValue = number | readonly (number | null)[];

export type UiMotionTarget = {
  readonly [K in keyof UiMotionScalarTarget]?: UiMotionValue;
};

/**
 * Cross-platform declarative motion contract.
 * Maps to CSS transitions / Web Animations API in DOM and native Rust `motion.div` in GPUIX.
 */
export interface UiMotionSpec {
  readonly initial?: UiMotionScalarTarget | false;
  readonly animate: UiMotionTarget;
  readonly durationMs: number;
  readonly delayMs?: number;
  readonly ease?: UiMotionEase;
  readonly times?: readonly number[];
  readonly repeat?: number | 'Infinity';
  readonly repeatType?: 'loop' | 'reverse' | 'mirror';
  readonly propertyDurationsMs?: {
    readonly opacity?: number;
    readonly transform?: number;
  };
  readonly propertyEases?: {
    readonly opacity?: UiMotionEase;
    readonly transform?: UiMotionEase;
  };
  readonly originX?: number;
  readonly originY?: number;
}
