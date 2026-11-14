/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export type IconSizeClass = 'display' | 'large' | 'medium' | 'small';

export type SizeClassMap<T> = Record<IconSizeClass, T>;

export interface RgbaColor {
  readonly alpha: number;
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface GradientStopSpec {
  readonly color: RgbaColor;
  readonly location: number;
}

export interface GlyphHighlightRecipe {
  readonly bias: number;
  readonly blendModeOverride: string | null;
  readonly brightness: number;
  readonly distance: SizeClassMap<number>;
  readonly inset: SizeClassMap<number>;
  readonly minDistancePixels: SizeClassMap<number>;
  readonly minInsetPixels: SizeClassMap<number> | null;
  readonly opacity: SizeClassMap<number>;
  readonly outsetOpacity: SizeClassMap<number> | null;
  readonly spread: SizeClassMap<{ readonly radians: number }>;
}

const GLYPH_HIGHLIGHT_GROUP = {
  dark: {
    bias: 0.2,
    blendModeOverride: null,
    brightness: 0,
    distance: { display: 4, large: 6, medium: 6, small: 6 },
    inset: { display: 0, large: 0, medium: 0, small: 0 },
    minDistancePixels: { display: 1, large: 1, medium: 1, small: 1 },
    minInsetPixels: null,
    opacity: { display: 1, large: 1, medium: 0.2, small: 0.2 },
    outsetOpacity: { display: 0.9, large: 0.9, medium: 0.2, small: 0.2 },
    spread: {
      display: { radians: 1.5707963267948966 },
      large: { radians: 1.5707963267948966 },
      medium: { radians: 3.141592653589793 },
      small: { radians: 3.141592653589793 },
    },
  },
  fillDiffuse: 'matchKey' as const,
  fillSharp: {
    custom: {
      bias: 0.5,
      blendModeOverride: null,
      brightness: 1,
      distance: { display: 4, large: 6, medium: 6, small: 6 },
      inset: { display: 0, large: 0, medium: 0, small: 0 },
      minDistancePixels: { display: 1, large: 1, medium: 1, small: 1 },
      minInsetPixels: null,
      opacity: { display: 1, large: 1, medium: 1, small: 0.3 },
      outsetOpacity: null,
      spread: {
        display: { radians: 1.0471975511965976 },
        large: { radians: 1.0471975511965976 },
        medium: { radians: 1.0471975511965976 },
        small: { radians: 1.0471975511965976 },
      },
    },
  },
  keyDiffuse: {
    bias: 0.08,
    blendModeOverride: null,
    brightness: 1,
    distance: { display: 16, large: 24, medium: 24, small: 24 },
    inset: { display: 0, large: 0, medium: 0, small: 0 },
    minDistancePixels: { display: 4, large: 4, medium: 4, small: 4 },
    minInsetPixels: null,
    opacity: { display: 1, large: 1, medium: 1, small: 1 },
    outsetOpacity: null,
    spread: {
      display: { radians: 1.0471975511965976 },
      large: { radians: 1.0471975511965976 },
      medium: { radians: 1.0471975511965976 },
      small: { radians: 1.0471975511965976 },
    },
  },
  keySharp: {
    bias: 0.5,
    blendModeOverride: null,
    brightness: 1,
    distance: { display: 4, large: 6, medium: 6, small: 6 },
    inset: { display: 0, large: 0, medium: 0, small: 0 },
    minDistancePixels: { display: 1, large: 1, medium: 1, small: 1 },
    minInsetPixels: null,
    opacity: { display: 1, large: 1, medium: 1, small: 0.3 },
    outsetOpacity: null,
    spread: {
      display: { radians: 1.5707963267948966 },
      large: { radians: 1.5707963267948966 },
      medium: { radians: 1.5707963267948966 },
      small: { radians: 1.5707963267948966 },
    },
  },
  rim: null,
};

export const ICON_RENDERING_PARAMETERS = {
  blurStrengthMax: 64,
  clearMode: {
    applyToLightTintToo: true,
    contentDarkeningStrength: 0,
    contentLighteningStrength: 0.85,
    darkeningUsesVCM: false,
    darkeningVCM: { black: -0.5, headroom: null, saturation: 1.5, white: 0.5 },
    debugMode: 'none',
    drawByReference: true,
    highlightsVCM: { black: 0.2, headroom: 1.2, saturation: 1.4, white: 1.35 },
    leaveEnclosureDarklightsToSystem: true,
    lighteningUsesVCM: true,
    lighteningVCM: { black: 0.9, headroom: 1.2, saturation: 2, white: 2.5 },
    passOrder: 'lightenFirst',
    totalDarkeningStrength: 0.3,
    totalHighlightsStrength: 1,
    totalLighteningStrength: 1,
  },
  defaultEnclosureCornerRadius: 266.24,
  fills: {
    automaticGradient: {
      basePosition: 0,
      brightLightening: -0.05,
      dimLightening: 0.04,
      midBrightLightening: 0.15,
      midDimLightening: 0.08,
      saturationBoost: 0.2,
    },
    systemDarkGradient: {
      stops: [
        {
          color: {
            alpha: 1,
            blue: 0.12156862745098039,
            green: 0.12156862745098039,
            red: 0.12156862745098039,
          },
          location: 0,
        },
        {
          color: {
            alpha: 1,
            blue: 0.058823529411764705,
            green: 0.058823529411764705,
            red: 0.058823529411764705,
          },
          location: 1,
        },
      ],
    },
    systemLightGradient: {
      stops: [
        { color: { alpha: 1, blue: 1, green: 1, red: 1 }, location: 0 },
        {
          color: {
            alpha: 1,
            blue: 0.9607843137254902,
            green: 0.9607843137254902,
            red: 0.9607843137254902,
          },
          location: 1,
        },
      ],
    },
  },
  mitigatedEnclosureDarkTint: { alpha: 1, blue: 0.1, green: 0.1, red: 0.1 },
  mitigatedEnclosureDarkClear: { alpha: 1, blue: 0.17, green: 0.17, red: 0.17 },
  shadow: {
    blendMode: 'multiply',
    blendModeForVibrantOnDim: 'normal',
    drawOverContent: true,
    ignoreFillOpacity: true,
    maxNeutralOverdrawOpacity: { display: 0.2, large: 0.2, medium: 0.2, small: 0.2 },
    maxVibrantOverdrawOpacity: { display: 0.5, large: 0.5, medium: 0.5, small: 0.5 },
    neutralOpacity: { display: 0.375, large: 0.375, medium: 0.375, small: 0.375 },
    offsetX: 0,
    offsetY: 32,
    overdrawBlendMode: 'multiply',
    radius: { display: 0.3, large: 0.3, medium: 0.3, small: 0.3 },
    ringWidth: { display: 16, large: 16, medium: 16, small: 16 },
    translucencyForMaxOverdraw: 0.3,
    vibrantBrightness: 0.75,
    vibrantOpacity: { display: 0.75, large: 0.75, medium: 0.75, small: 0.75 },
  },
  enclosureShadow: {
    offsetX: { display: 0, large: 0, medium: 0, small: 0 },
    offsetY: { display: 10, large: 15, medium: 25, small: 25 },
    opacity: { display: 0.25, large: 0.25, medium: 0.25, small: 0.35 },
    radius: { display: 20, large: 25, medium: 40, small: 50 },
  },
  outlines: {
    allowDespiteShadow: false,
    lineOpacityOnBright: { display: 0.12, large: 0.12, medium: 0.12, small: 0.12 },
    lineOpacityOnDim: { display: 0.15, large: 0.15, medium: 0.15, small: 0.15 },
    lineWidth: {
      display: 1.3333333333333333,
      large: 1,
      medium: 0.6666666666666666,
      small: 0.6666666666666666,
    },
    luminanceRangeOnBright: 0.1,
    luminanceRangeOnDim: 0.1,
    sizing: 'points',
    useDynamicOpacity: true,
  },
  thresholds: {
    minDisplaySize: '256.0',
    minLargeSize: '60.0',
    minMediumSize: '25.0',
  },
  highlights: {
    glyphHighlightCurvature: { display: 0.75, large: 0.75, medium: 0.75, small: 0.75 },
    glyphsClear: GLYPH_HIGHLIGHT_GROUP,
    glyphsDefault: GLYPH_HIGHLIGHT_GROUP,
  },
} as const;

export const ENCLOSURE_RIM = Object.freeze({
  height: 1,
  amount: 0.5,
  spread: 1.523526992886717,
  diffuseHeightScale: 8,
  diffuseAmountScale: 0.15000000596046448,
  diffuseSpreadScale: 0.6499999761581421,
  curvature: 0.75,
});

export const APP_ICON_METRICS = Object.freeze({
  cornerRadiusFraction: 0.22,
  tileFraction: 0.9,
  foregroundFraction: 0.7,
  coreAlpha: 160,
});
