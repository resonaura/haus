/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export {
  AnimatePresence,
  MotionValue,
  animate,
  motion,
  stagger,
  useGpuix,
  useGpuixRequired,
  useIsPresent,
  useMotionValue,
  usePresence,
  useScrollController,
  useSpring,
  useTransform,
  useWindowInsets,
  useWindowSize,
} from '@gpuix/react';
export type {
  ConicGradientBackground,
  CustomShaderDesc,
  GlowDesc,
  GradientBackground,
  LinearGradientBackground,
  LinearGradientStop,
  LiquidGlassDesc,
  MaskDesc,
  MotionBindDesc,
  MotionBindProperty,
  MotionDivProps,
  MotionEase,
  MotionElementProps,
  MotionProps,
  MotionStyle,
  MotionTargetStyle,
  MotionTransition,
  NativeScrollState,
  OverscrollBehavior,
  PerfMetrics,
  RadialGradientBackground,
  ScrollBindDesc,
  ScrollController,
  ScrollPolicy,
  ScrollShadowDesc,
  SpringOptions,
  StaggerOptions,
  StyleDesc,
  TransformDesc,
  TransformOptions,
  TransformOriginDesc,
} from '@gpuix/react';

export const GPUI_FORK_BASELINE = {
  gpuixCommit: '0ce4f41fca8ffb9c18fd1efd2631f0f4b97a1abf',
  zedCommit: 'f77e5cfe9dad04288566f00c66ecf3c58d6f84b3',
  sonoraReferenceCommit: 'e5766e772ee939b741456eeec22dbe6764fafcdd',
} as const;
