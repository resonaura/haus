/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { LightEffectMotion, LightEffectOption } from '@haus/core/device';
import {
  colorToken,
  mixColor,
  rgba,
  transparentColor,
  type BorderSpec,
  type ColorValue,
  type ShadowSpec,
} from '../../ir/geometry.js';
import { GradientMaterial, SolidMaterial, type SurfaceMaterial } from '../../ir/materials.js';
import type { UiMotionSpec } from '../../ir/motion.js';
import type { ThemeMode, UiStyleSpec } from '../../ir/node.js';

export interface DeviceTileSurfaceTokens {
  readonly tileGlassBase: ColorValue;
  readonly tileGlassTop: ColorValue;
  readonly tileGlassEdge: ColorValue;
  readonly tileGlassInactiveEdge: ColorValue;
  readonly tileGlassRim: ColorValue;
  readonly deviceNeutral: ColorValue;
  readonly deviceWash: number;
  readonly deviceIconMix: number;
  readonly deviceIconBase: ColorValue;
  readonly catLights: ColorValue;
  readonly hoverEdgeMix: ColorValue;
}

const LIGHT_TILE_TOKENS: DeviceTileSurfaceTokens = {
  tileGlassBase: rgba(255, 255, 255, 0.84),
  tileGlassTop: rgba(255, 255, 255, 0.65),
  tileGlassEdge: rgba(0, 0, 0, 0.075),
  tileGlassInactiveEdge: rgba(0, 0, 0, 0.075),
  tileGlassRim: rgba(255, 255, 255, 0.66),
  deviceNeutral: rgba(103, 103, 103, 1),
  deviceWash: 0.1,
  deviceIconMix: 0.76,
  deviceIconBase: rgba(0, 0, 0, 1),
  catLights: rgba(184, 121, 0, 1),
  hoverEdgeMix: rgba(32, 32, 32, 1),
};

const DARK_TILE_TOKENS: DeviceTileSurfaceTokens = {
  tileGlassBase: rgba(18, 18, 18, 0.94),
  tileGlassTop: rgba(255, 255, 255, 0.025),
  tileGlassEdge: rgba(255, 255, 255, 0.065),
  tileGlassInactiveEdge: rgba(255, 255, 255, 0.055),
  tileGlassRim: rgba(255, 255, 255, 0.13),
  deviceNeutral: rgba(244, 244, 244, 1),
  deviceWash: 0.26,
  deviceIconMix: 0.8,
  deviceIconBase: rgba(255, 255, 255, 1),
  catLights: rgba(255, 204, 46, 1),
  hoverEdgeMix: rgba(250, 250, 250, 1),
};

export function getDeviceTileTokens(mode: ThemeMode): DeviceTileSurfaceTokens {
  return mode === 'dark' ? DARK_TILE_TOKENS : LIGHT_TILE_TOKENS;
}

/** Parses `#rgb`, `#rrggbb`, `rgb(r, g, b)`, or `rgba(r, g, b, a)` CSS strings into structured IR colors. */
export function parseCssColor(value: string | undefined): ColorValue | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const hex6 = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(trimmed);
  if (hex6) {
    return rgba(parseInt(hex6[1], 16), parseInt(hex6[2], 16), parseInt(hex6[3], 16), 1);
  }
  const hex3 = /^#([\da-f])([\da-f])([\da-f])$/i.exec(trimmed);
  if (hex3) {
    return rgba(
      parseInt(hex3[1] + hex3[1], 16),
      parseInt(hex3[2] + hex3[2], 16),
      parseInt(hex3[3] + hex3[3], 16),
      1,
    );
  }
  const rgbMatch =
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(trimmed);
  if (rgbMatch) {
    return rgba(
      Number(rgbMatch[1]),
      Number(rgbMatch[2]),
      Number(rgbMatch[3]),
      rgbMatch[4] !== undefined ? Number(rgbMatch[4]) : 1,
    );
  }
  return undefined;
}

export function resolveDeviceTileColor(
  mode: ThemeMode,
  accent?: ColorValue,
  effect?: LightEffectOption,
): ColorValue {
  const tokens = getDeviceTileTokens(mode);
  if (effect?.palette[0]) {
    return parseCssColor(effect.palette[0]) ?? accent ?? tokens.deviceNeutral;
  }
  return accent ?? tokens.deviceNeutral;
}

export function buildTileFrameStyle({
  mode,
  active,
  hovered,
  highContrast,
  reducedTransparency,
  deviceColor,
  effect,
  hasRestore,
}: {
  readonly mode: ThemeMode;
  readonly active: boolean;
  readonly hovered: boolean;
  readonly highContrast: boolean;
  readonly reducedTransparency: boolean;
  readonly deviceColor: ColorValue;
  readonly effect?: LightEffectOption;
  readonly hasRestore: boolean;
}): {
  readonly border: BorderSpec;
  readonly shadows: readonly ShadowSpec[];
  readonly minHeightPx: number;
  readonly material: SurfaceMaterial;
  readonly sheenMaterial?: SurfaceMaterial;
} {
  const tokens = getDeviceTileTokens(mode);
  const edgePrimary = (effect?.palette[0] && parseCssColor(effect.palette[0])) || deviceColor;
  const activeEdge = mixColor(tokens.tileGlassEdge, edgePrimary, 0.24);
  const baseEdge = active ? activeEdge : tokens.tileGlassInactiveEdge;
  const hoverEdge = active ? activeEdge : mixColor(baseEdge, tokens.hoverEdgeMix, 0.12);
  const borderColor = highContrast ? colorToken('textMuted') : hovered ? hoverEdge : baseEdge;

  const rimHighlight: ShadowSpec = {
    offsetX: 0,
    offsetY: 1,
    blurRadius: 0,
    color: mixColor(transparentColor, tokens.tileGlassRim, active ? 0.65 : 0.45),
    inset: true,
  };
  const shadows: readonly ShadowSpec[] = active
    ? [
        rimHighlight,
        { offsetX: 0, offsetY: 5, blurRadius: 18, color: rgba(0, 0, 0, 0.12) },
        {
          offsetX: 0,
          offsetY: 0,
          blurRadius: 22,
          color: mixColor(transparentColor, edgePrimary, 0.07),
        },
      ]
    : hovered
      ? [rimHighlight, { offsetX: 0, offsetY: 8, blurRadius: 24, color: rgba(0, 0, 0, 0.12) }]
      : [rimHighlight, { offsetX: 0, offsetY: 4, blurRadius: 12, color: rgba(0, 0, 0, 0.07) }];

  const sheenMaterial = reducedTransparency
    ? undefined
    : new GradientMaterial(
        [
          { offset: 0, color: tokens.tileGlassTop },
          { offset: 0.48, color: transparentColor },
          { offset: 1, color: transparentColor },
        ],
        150,
        'linear',
      );

  return {
    border: { width: 1, color: borderColor },
    shadows,
    minHeightPx: hasRestore ? 185 : 126,
    material: new SolidMaterial(tokens.tileGlassBase),
    sheenMaterial,
  };
}

export function buildTileIconOrbStyle(
  mode: ThemeMode,
  active: boolean,
  outputColor: ColorValue,
): {
  readonly spec: UiStyleSpec;
  readonly iconColor: ColorValue;
} {
  const tokens = getDeviceTileTokens(mode);
  const topTint = active
    ? mixColor(transparentColor, outputColor, 0.25)
    : mixColor(transparentColor, colorToken('ink'), 0.09);
  const bottomTint = active
    ? mixColor(transparentColor, outputColor, 0.1)
    : mixColor(transparentColor, colorToken('ink'), 0.04);
  const rimTint = active
    ? mixColor(transparentColor, outputColor, 0.25)
    : mixColor(transparentColor, colorToken('ink'), 0.09);

  const shadows: readonly ShadowSpec[] = active
    ? [
        { offsetX: 0, offsetY: 0.75, blurRadius: 0, color: rimTint, inset: true },
        { offsetX: 0, offsetY: 2, blurRadius: 6, color: rgba(0, 0, 0, 0.07) },
      ]
    : [{ offsetX: 0, offsetY: 0.75, blurRadius: 0, color: rimTint, inset: true }];

  return {
    spec: {
      material: new GradientMaterial(
        [
          { offset: 0, color: topTint },
          { offset: 1, color: bottomTint },
        ],
        155,
        'linear',
      ),
      shadows,
    },
    iconColor: active
      ? mixColor(tokens.deviceIconBase, outputColor, tokens.deviceIconMix)
      : tokens.deviceIconBase,
  };
}

export function buildEffectBadgeStyle(
  effect: LightEffectOption,
  fallbackColor: ColorValue,
): {
  readonly borderColor: ColorValue;
  readonly iconColor: ColorValue;
  readonly material: SurfaceMaterial;
  readonly shadows: readonly ShadowSpec[];
} {
  const c1 = parseCssColor(effect.palette[0]) ?? fallbackColor;
  const c2 = parseCssColor(effect.palette[1]) ?? c1;
  return {
    iconColor: c1,
    borderColor: mixColor(transparentColor, c1, 0.34),
    material: new GradientMaterial(
      [
        { offset: 0, color: mixColor(colorToken('card'), c1, 0.26) },
        { offset: 1, color: mixColor(colorToken('card'), c2, 0.14) },
      ],
      145,
      'linear',
    ),
    shadows: [
      {
        offsetX: 0,
        offsetY: 0,
        blurRadius: 8,
        color: mixColor(transparentColor, c1, 0.24),
      },
    ],
  };
}

export const WASH_ACTIVATE_MS = 540;
export const WASH_DEACTIVATE_MS = 500;
export const WASH_MIN_SCALE = 0.72;
export const WASH_MAX_BLUR = 28;

/** Inverse size-to-blur ("motion blur") law: scale >= 1 -> 0 blur; smaller scale -> stronger blur. */
export function washBlurForScale(
  scale: number,
  maxBlur = WASH_MAX_BLUR,
  minScale = WASH_MIN_SCALE,
): number {
  if (scale >= 1 || maxBlur <= 0) return 0;
  const deficit = Math.min(1, Math.max(0, (1 - scale) / Math.max(0.01, 1 - minScale)));
  return Number((maxBlur * deficit).toFixed(2));
}

export function buildWashTransitionMotion(
  activating: boolean,
  reducedTransparency = false,
): UiMotionSpec {
  const maxBlur = reducedTransparency ? 0 : WASH_MAX_BLUR;
  const shrunkBlur = washBlurForScale(WASH_MIN_SCALE, maxBlur);
  const ease = activating ? ([0.22, 1, 0.36, 1] as const) : ([0.22, 0.8, 0.25, 1] as const);
  const durationMs = activating ? WASH_ACTIVATE_MS : WASH_DEACTIVATE_MS;
  const opacityEase = activating ? ([0.2, 0.7, 0.2, 1] as const) : ([0.25, 0.6, 0.3, 1] as const);
  const opacityMs = activating ? 440 : 450;
  return {
    initial: activating
      ? { opacity: 0, scale: WASH_MIN_SCALE, ...(maxBlur > 0 ? { blur: shrunkBlur } : {}) }
      : { opacity: 1, scale: 1, ...(maxBlur > 0 ? { blur: 0 } : {}) },
    animate: activating
      ? { opacity: 1, scale: 1, ...(maxBlur > 0 ? { blur: 0 } : {}) }
      : { opacity: 0, scale: WASH_MIN_SCALE, ...(maxBlur > 0 ? { blur: shrunkBlur } : {}) },
    originX: 0.12,
    originY: 0.19,
    durationMs,
    ease,
    propertyDurationsMs: { opacity: opacityMs, transform: durationMs, blur: durationMs },
    propertyEases: { opacity: opacityEase, transform: ease, blur: ease },
  };
}

export function effectMotionFor(
  motion: LightEffectMotion,
  reducedTransparency = false,
): UiMotionSpec | undefined {
  const blurForScales = (scales: readonly number[]) =>
    reducedTransparency ? {} : { blur: scales.map((s) => washBlurForScale(s)) };
  switch (motion) {
    case 'flicker': {
      const scale = [0.96, 1.025, 0.98, 1.03, 0.96] as const;
      return {
        initial: false,
        animate: { opacity: [0.78, 0.98, 0.85, 1, 0.78], scale, ...blurForScales(scale) },
        times: [0, 0.34, 0.62, 0.82, 1],
        durationMs: 8400,
        ease: 'easeInOut',
        repeat: 'Infinity',
      };
    }
    case 'pulse': {
      const scale = [0.91, 1.04, 0.91] as const;
      return {
        initial: false,
        animate: { opacity: [0.68, 1, 0.68], scale, ...blurForScales(scale) },
        times: [0, 0.5, 1],
        durationMs: 7200,
        ease: 'easeInOut',
        repeat: 'Infinity',
      };
    }
    case 'rainbow': {
      const scale = [0.965, 1.015, 0.98, 1.015, 0.965] as const;
      return {
        initial: false,
        animate: { opacity: [0.82, 1, 0.88, 1, 0.82], scale, ...blurForScales(scale) },
        times: [0, 0.25, 0.5, 0.75, 1],
        durationMs: 16000,
        ease: 'easeInOut',
        repeat: 'Infinity',
      };
    }
    case 'aurora': {
      const scale = [0.94, 1.02, 0.975] as const;
      return {
        initial: false,
        animate: { scale, opacity: [0.84, 1, 0.9], ...blurForScales(scale) },
        times: [0, 0.5, 1],
        durationMs: 13000,
        ease: 'easeInOut',
        repeat: 'Infinity',
        repeatType: 'reverse',
      };
    }
    case 'wave': {
      const scaleY = [0.93, 1.02, 0.97] as const;
      return {
        initial: false,
        animate: { scaleY, opacity: [0.8, 1, 0.86], ...blurForScales(scaleY) },
        times: [0, 0.5, 1],
        durationMs: 9500,
        ease: 'easeInOut',
        repeat: 'Infinity',
        repeatType: 'reverse',
      };
    }
    case 'sparkle':
      return {
        initial: false,
        animate: { opacity: [0.76, 1, 0.84, 0.98, 0.76] },
        times: [0, 0.36, 0.66, 0.86, 1],
        durationMs: 6800,
        ease: 'easeInOut',
        repeat: 'Infinity',
      };
    case 'beat': {
      const scale = [0.92, 1.04, 0.965, 1.035, 0.92] as const;
      return {
        initial: false,
        animate: { opacity: [0.72, 1, 0.8, 0.98, 0.72], scale, ...blurForScales(scale) },
        times: [0, 0.25, 0.5, 0.75, 1],
        durationMs: 3800,
        ease: 'easeInOut',
        repeat: 'Infinity',
      };
    }
    default:
      return undefined;
  }
}

export function orbEffectMotion(motion?: LightEffectMotion): UiMotionSpec | undefined {
  switch (motion) {
    case 'flicker':
      return {
        initial: false,
        animate: { opacity: [0.88, 1, 0.92, 1, 0.88] },
        times: [0, 0.34, 0.62, 0.82, 1],
        durationMs: 8400,
        ease: 'easeInOut',
        repeat: 'Infinity',
      };
    case 'pulse':
      return {
        initial: false,
        animate: { opacity: [0.86, 1, 0.86] },
        times: [0, 0.5, 1],
        durationMs: 7200,
        ease: 'easeInOut',
        repeat: 'Infinity',
      };
    case 'beat':
      return {
        initial: false,
        animate: { opacity: [0.86, 1, 0.9, 1, 0.86] },
        times: [0, 0.25, 0.5, 0.75, 1],
        durationMs: 3800,
        ease: 'easeInOut',
        repeat: 'Infinity',
      };
    default:
      return undefined;
  }
}
