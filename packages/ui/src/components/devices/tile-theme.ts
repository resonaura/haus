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

export function effectMotionFor(motion: LightEffectMotion): UiMotionSpec | undefined {
  switch (motion) {
    case 'flicker':
      return {
        initial: false,
        animate: {
          opacity: [0.78, 0.98, 0.85, 1, 0.78],
          scale: [0.985, 1.025, 0.995, 1.03, 0.985],
        },
        times: [0, 0.34, 0.62, 0.82, 1],
        durationMs: 8400,
        ease: 'easeInOut',
        repeat: 'Infinity',
      };
    case 'pulse':
      return {
        initial: false,
        animate: { opacity: [0.68, 1, 0.68], scale: [0.96, 1.04, 0.96] },
        times: [0, 0.5, 1],
        durationMs: 7200,
        ease: 'easeInOut',
        repeat: 'Infinity',
      };
    case 'rainbow':
      return {
        initial: false,
        animate: { opacity: [0.82, 1, 0.88, 1, 0.82], scale: [0.985, 1.015, 0.99, 1.015, 0.985] },
        times: [0, 0.25, 0.5, 0.75, 1],
        durationMs: 16000,
        ease: 'easeInOut',
        repeat: 'Infinity',
      };
    case 'aurora':
      return {
        initial: false,
        animate: {
          scale: [0.985, 1.02, 0.995],
          opacity: [0.84, 1, 0.9],
        },
        times: [0, 0.5, 1],
        durationMs: 13000,
        ease: 'easeInOut',
        repeat: 'Infinity',
        repeatType: 'reverse',
      };
    case 'wave':
      return {
        initial: false,
        animate: {
          scaleY: [0.98, 1.02, 0.99],
          opacity: [0.8, 1, 0.86],
        },
        times: [0, 0.5, 1],
        durationMs: 9500,
        ease: 'easeInOut',
        repeat: 'Infinity',
        repeatType: 'reverse',
      };
    case 'sparkle':
      return {
        initial: false,
        animate: { opacity: [0.76, 1, 0.84, 0.98, 0.76] },
        times: [0, 0.36, 0.66, 0.86, 1],
        durationMs: 6800,
        ease: 'easeInOut',
        repeat: 'Infinity',
      };
    case 'beat':
      return {
        initial: false,
        animate: {
          opacity: [0.72, 1, 0.8, 0.98, 0.72],
          scale: [0.97, 1.04, 0.985, 1.035, 0.97],
        },
        times: [0, 0.25, 0.5, 0.75, 1],
        durationMs: 3800,
        ease: 'easeInOut',
        repeat: 'Infinity',
      };
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
