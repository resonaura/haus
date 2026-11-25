/* @jsxImportSource @gpuix/react */
/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { COMPILED_GLASS_RIM_WGSL } from '../generated/compiled-shaders.js';
import { PILL_RADIUS_THRESHOLD, superellipseToContinuousRadiusRatio } from '../ir/geometry.js';
import { getGlassRimPreset, type GlassRimEffectMotion } from '../ir/glass-rim.js';
import { resolveColorToCss, type RenderContext } from '../renderers/contract.js';
import type { HostGlassRimProps } from '../renderers/host.js';

const MOTION_TO_ID: Readonly<Record<GlassRimEffectMotion, number>> = {
  none: 0,
  flicker: 1,
  pulse: 2,
  rainbow: 3,
  aurora: 4,
  wave: 5,
  sparkle: 6,
  beat: 7,
};

export function GpuiGlassRim({
  props,
  context,
}: {
  readonly props: HostGlassRimProps;
  readonly context: RenderContext;
}) {
  const { theme, viewport } = context;
  if (viewport.reducedTransparency || viewport.highContrast) return null;

  const preset = getGlassRimPreset(props.preset ?? 'card');
  const rawRadius = props.radiusPx ?? preset.radius;
  const useContinuous =
    !preset.circular && props.continuous !== false && rawRadius < PILL_RADIUS_THRESHOLD;
  const radius = useContinuous
    ? Number((rawRadius * superellipseToContinuousRadiusRatio(1.4)).toFixed(2))
    : rawRadius;
  const isDark = theme.mode === 'dark';
  const refPlate = isDark ? preset.refPlateDark : preset.refPlateLight;
  const variant = props.variant ?? (preset.name === 'panel' ? 'panel' : 'card');
  const opacity = props.opacity ?? (variant === 'panel' ? 0.74 : 0.56);

  const hasEffect = Boolean(props.effectColors?.[0]);
  const mode = hasEffect ? 2 : props.tintColor !== undefined ? 1 : 0;
  const motionId = hasEffect && props.effectMotion ? (MOTION_TO_ID[props.effectMotion] ?? 0) : 0;
  const primaryColor = props.effectColors?.[0] ?? props.tintColor;
  const c1 = primaryColor ? resolveColorToCss(primaryColor, theme, false) : '#ffffff';
  const c2 = props.effectColors?.[1] ? resolveColorToCss(props.effectColors[1], theme, false) : c1;
  const c3 = props.effectColors?.[2] ? resolveColorToCss(props.effectColors[2], theme, false) : c2;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        borderRadius: radius,
        cornerSmoothing: useContinuous ? 1 : 0,
        pointerEvents: 'none',
        shader: {
          label: 'haus.glass-rim.v1',
          wgsl: COMPILED_GLASS_RIM_WGSL,
          samplesBackdrop: false,
          customShapeAlpha: true,
          animated: mode === 2 && motionId > 0 && !viewport.reducedMotion,
          params: [
            radius,
            isDark ? 1 : 0,
            preset.strength,
            opacity,
            refPlate,
            mode,
            motionId,
            variant === 'panel' ? 1 : 0,
            preset.circular ? 1 : 0,
            viewport.reducedMotion ? 1 : 0,
            useContinuous ? 1 : 0,
            0,
          ],
          colors: [c1, c2, c3],
        },
      }}
    />
  );
}
