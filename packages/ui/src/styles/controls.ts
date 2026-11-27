/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  colorToken,
  corners,
  insets,
  pct,
  px,
  rgba,
  type ColorValue,
} from '../ir/geometry.js';
import { LiquidGlassMaterial, SolidMaterial } from '../ir/materials.js';
import type { UiStyleSpec, UiTheme } from '../ir/node.js';
import { defineStyleSheet } from './sheet.js';

export function resolveCapsuleThumbColor(
  accentColor: ColorValue | undefined,
  theme: UiTheme,
): ColorValue {
  if (!accentColor || (accentColor.kind === 'token' && accentColor.name === 'accent')) {
    return theme.color('accentForeground');
  }
  if (accentColor.kind === 'rgba') {
    const lum = (0.2126 * accentColor.r + 0.7152 * accentColor.g + 0.0722 * accentColor.b) / 255;
    return lum > 0.58 ? rgba(12, 14, 18, 0.96) : rgba(255, 255, 255, 0.98);
  }
  if (accentColor.kind === 'oklch') {
    return accentColor.l > 0.68 ? rgba(12, 14, 18, 0.96) : rgba(255, 255, 255, 0.98);
  }
  return theme.color('accentForeground');
}

export type HausButtonVariant =
  'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'danger-soft' | 'glass';
export type HausControlSize = 'sm' | 'md' | 'lg';

export interface ButtonStyleProps {
  readonly variant: HausButtonVariant;
  readonly size: HausControlSize;
  readonly disabled?: boolean;
  readonly fullWidth?: boolean;
  readonly isIconOnly?: boolean;
}

const BUTTON_SIZES = {
  sm: { py: 6, px: 12, fontSize: 12.5, radius: 10, minHeight: 30, gap: 6 },
  md: { py: 8, px: 16, fontSize: 13.5, radius: 12, minHeight: 36, gap: 8 },
  lg: { py: 11, px: 20, fontSize: 14.5, radius: 14, minHeight: 42, gap: 8 },
} as const;

export const buttonStyles = defineStyleSheet('button', (theme, props: ButtonStyleProps) => {
  const dim = BUTTON_SIZES[props.size];
  const isDark = theme.mode === 'dark';

  const variantStyle = (): UiStyleSpec => {
    switch (props.variant) {
      case 'primary':
        return {
          material: new SolidMaterial(theme.color('accent')),
          typography: { color: colorToken('accentForeground'), weight: 600 },
          border: { width: 1, style: 'solid', color: colorToken('accent') },
          shadows: [
            {
              offsetX: 0,
              offsetY: 4,
              blurRadius: 12,
              spreadRadius: -4,
              color: rgba(0, 0, 0, 0.25),
            },
          ],
          states: {
            hover: { opacity: 0.92 },
            pressed: { opacity: 0.85, transform: { scale: 0.98 } },
          },
        };
      case 'secondary':
        return {
          material: new SolidMaterial(theme.color('controlFill')),
          typography: { color: colorToken('textPrimary'), weight: 500 },
          border: { width: 1, style: 'solid', color: colorToken('border') },
          states: {
            hover: {
              material: new SolidMaterial(theme.color('controlFillHover')),
            },
            pressed: { transform: { scale: 0.98 } },
          },
        };
      case 'outline':
        return {
          material: new SolidMaterial(rgba(0, 0, 0, 0)),
          typography: { color: colorToken('textPrimary'), weight: 500 },
          border: { width: 1, style: 'solid', color: colorToken('materialEdge') },
          states: {
            hover: {
              material: new SolidMaterial(theme.color('controlFill')),
            },
            pressed: { transform: { scale: 0.98 } },
          },
        };
      case 'ghost':
        return {
          material: new SolidMaterial(rgba(0, 0, 0, 0)),
          typography: { color: colorToken('textSecondary'), weight: 500 },
          border: { width: 1, style: 'solid', color: rgba(0, 0, 0, 0) },
          states: {
            hover: {
              material: new SolidMaterial(theme.color('controlFill')),
              textColor: colorToken('textPrimary'),
            },
            pressed: { transform: { scale: 0.98 } },
          },
        };
      case 'danger':
        return {
          material: new SolidMaterial(theme.color('critical')),
          typography: { color: rgba(255, 255, 255, 0.98), weight: 600 },
          border: { width: 1, style: 'solid', color: colorToken('critical') },
          states: {
            hover: { opacity: 0.92 },
            pressed: { opacity: 0.84, transform: { scale: 0.98 } },
          },
        };
      case 'danger-soft':
        return {
          material: new SolidMaterial(rgba(239, 68, 68, isDark ? 0.16 : 0.12)),
          typography: { color: colorToken('critical'), weight: 500 },
          border: { width: 1, style: 'solid', color: rgba(239, 68, 68, isDark ? 0.32 : 0.24) },
          states: {
            hover: { material: new SolidMaterial(rgba(239, 68, 68, isDark ? 0.24 : 0.18)) },
            pressed: { transform: { scale: 0.98 } },
          },
        };
      case 'glass':
        return {
          material: new LiquidGlassMaterial({
            tintColor: theme.color('materialTop'),
            blurRadius: theme.palette.blur.md,
            refractionStrength: 12,
            saturation: 1.35,
            tintOpacity: 0.28,
            rimPreset: 'pill',
          }),
          typography: { color: colorToken('textPrimary'), weight: 500 },
          border: { width: 1, style: 'solid', color: colorToken('materialEdge') },
          states: {
            hover: { opacity: 0.95 },
            pressed: { transform: { scale: 0.98 } },
          },
        };
    }
  };

  const baseVariant = variantStyle();

  return {
    root: {
      ...baseVariant,
      layout: {
        display: 'inline-flex',
        direction: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: px(dim.gap),
        minHeight: px(dim.minHeight),
        ...(props.fullWidth ? { width: pct(100) } : {}),
        ...(props.isIconOnly
          ? { width: px(dim.minHeight), height: px(dim.minHeight), padding: insets(0) }
          : { padding: insets(dim.py, dim.px) }),
      },
      typography: {
        fontFamily: 'sans',
        size: dim.fontSize,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        ...baseVariant.typography,
      },
      corners: corners(dim.radius, 'superellipse', 1.4),
      selectNone: true,
      cursor: props.disabled ? 'not-allowed' : 'pointer',
      opacity: props.disabled ? 0.45 : 1,
      transitionMs: 150,
    },
  };
});

export const SWITCH_SIZES = {
  sm: { width: 38, height: 20, thumbWidth: 18, thumbHeight: 14, pad: 3 },
  md: { width: 46, height: 24, thumbWidth: 22, thumbHeight: 18, pad: 3 },
  lg: { width: 54, height: 28, thumbWidth: 26, thumbHeight: 22, pad: 3 },
} as const;

export interface SwitchStyleProps {
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly size: HausControlSize;
  readonly accentColor?: ColorValue;
}

export const switchStyles = defineStyleSheet('switch', (theme, props: SwitchStyleProps) => {
  const dim = SWITCH_SIZES[props.size];
  const isDark = theme.mode === 'dark';
  const travel = dim.width - dim.thumbWidth - dim.pad * 2;
  const activeFill = props.accentColor ?? theme.color('accent');
  const uncheckedFill = isDark ? rgba(255, 255, 255, 0.16) : rgba(0, 0, 0, 0.12);
  const thumbColor = props.checked
    ? resolveCapsuleThumbColor(props.accentColor, theme)
    : rgba(255, 255, 255, isDark ? 0.92 : 0.98);

  return {
    wrapper: {
      layout: {
        display: 'inline-flex',
        direction: 'row',
        alignItems: 'center',
        gap: px(10),
      },
      cursor: props.disabled ? 'not-allowed' : 'pointer',
    },
    track: {
      layout: {
        display: 'inline-flex',
        direction: 'row',
        alignItems: 'center',
        justifyContent: 'start',
        width: px(dim.width),
        height: px(dim.height),
        padding: insets(dim.pad),
        flexShrink: 0,
      },
      material: new SolidMaterial(props.checked ? activeFill : uncheckedFill),
      corners: corners(999, 'round'),
      border: { width: 0, style: 'none', color: rgba(0, 0, 0, 0) },
      opacity: props.disabled ? 0.45 : 1,
      cursor: props.disabled ? 'not-allowed' : 'pointer',
      transitionMs: 190,
      states: {
        hover: { opacity: 0.93 },
        pressed: { transform: { scale: 0.97 } },
      },
    },
    thumb: {
      layout: {
        width: px(dim.thumbWidth),
        height: px(dim.thumbHeight),
        flexShrink: 0,
      },
      material: new SolidMaterial(thumbColor),
      corners: corners(999, 'round'),
      shadows: [{ offsetX: 0, offsetY: 1, blurRadius: 2.5, color: rgba(0, 0, 0, 0.22) }],
      transform: { translateX: props.checked ? travel : 0 },
      pointerEvents: 'none',
      transitionMs: 190,
    },
    label: {
      typography: { size: 13.5, weight: 500, color: colorToken('textPrimary') },
    },
    description: {
      typography: { size: 11.5, color: colorToken('textMuted') },
    },
  };
});

export const SLIDER_SIZES = {
  sm: { trackHeight: 18, thumbWidth: 18, thumbHeight: 12, pad: 3, minFill: 24 },
  md: { trackHeight: 22, thumbWidth: 22, thumbHeight: 16, pad: 3, minFill: 28 },
  lg: { trackHeight: 26, thumbWidth: 26, thumbHeight: 20, pad: 3, minFill: 32 },
} as const;

export interface SliderStyleProps {
  readonly ratioPct: number;
  readonly disabled?: boolean;
  readonly size?: HausControlSize;
  readonly accentColor?: ColorValue;
}

export const sliderStyles = defineStyleSheet('slider', (theme, props: SliderStyleProps) => {
  const isDark = theme.mode === 'dark';
  const dim = SLIDER_SIZES[props.size ?? 'md'];
  const clampedRatio = Math.max(0, Math.min(100, props.ratioPct));
  const activeFill = props.accentColor ?? theme.color('accent');
  const grooveFill = isDark ? rgba(255, 255, 255, 0.11) : rgba(0, 0, 0, 0.09);
  const thumbColor = resolveCapsuleThumbColor(props.accentColor, theme);

  return {
    root: {
      layout: { display: 'flex', direction: 'column', gap: px(8), width: pct(100) },
      opacity: props.disabled ? 0.45 : 1,
    },
    header: {
      layout: {
        display: 'flex',
        direction: 'row',
        alignItems: 'center',
        justifyContent: 'between',
        gap: px(8),
      },
    },
    label: {
      typography: { size: 13, weight: 500, color: colorToken('textPrimary') },
    },
    valueLabel: {
      typography: {
        size: 13,
        weight: 500,
        tabularNums: true,
        color: colorToken('textPrimary'),
      },
    },
    trackHost: {
      layout: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        width: pct(100),
        height: px(dim.trackHeight),
      },
      cursor: props.disabled ? 'not-allowed' : 'pointer',
    },
    track: {
      layout: {
        display: 'flex',
        direction: 'row',
        alignItems: 'center',
        width: pct(100),
        height: px(dim.trackHeight),
        overflow: 'hidden',
      },
      material: new SolidMaterial(grooveFill),
      corners: corners(999, 'round'),
    },
    fill: {
      layout: {
        display: 'flex',
        direction: 'row',
        alignItems: 'center',
        justifyContent: 'end',
        width: px(dim.minFill),
        minWidth: px(dim.minFill),
        height: pct(100),
        padding: insets(dim.pad),
        flexGrow: clampedRatio,
        flexShrink: 0,
      },
      material: new SolidMaterial(activeFill),
      corners: corners(999, 'round'),
      pointerEvents: 'none',
    },
    spacer: {
      layout: {
        width: px(0),
        height: pct(100),
        flexGrow: Math.max(0, 100 - clampedRatio),
        flexShrink: 1,
      },
      pointerEvents: 'none',
    },
    thumb: {
      layout: {
        width: px(dim.thumbWidth),
        height: px(dim.thumbHeight),
        flexShrink: 0,
      },
      material: new SolidMaterial(thumbColor),
      corners: corners(999, 'round'),
      shadows: [{ offsetX: 0, offsetY: 1, blurRadius: 2, color: rgba(0, 0, 0, 0.2) }],
      pointerEvents: 'none',
    },
    boundsRow: {
      layout: {
        display: 'flex',
        direction: 'row',
        justifyContent: 'between',
        alignItems: 'center',
      },
    },
    boundText: {
      typography: { size: 11, color: colorToken('textMuted') },
    },
  };
});

export const segmentedStyles = defineStyleSheet('segmented', (theme, selected: boolean) => {
  const isDark = theme.mode === 'dark';
  return {
    root: {
      layout: {
        display: 'inline-flex',
        direction: 'row',
        alignItems: 'center',
        gap: px(2),
        padding: insets(3),
      },
      material: new SolidMaterial(theme.color('controlFill')),
      corners: corners(999, 'round'),
      border: { width: 1, style: 'solid', color: colorToken('border') },
    },
    option: {
      layout: {
        display: 'inline-flex',
        direction: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: insets(5, 12),
      },
      material: selected
        ? new SolidMaterial(isDark ? theme.color('controlFillActive') : theme.color('surface'))
        : new SolidMaterial(rgba(0, 0, 0, 0)),
      corners: corners(999, 'round'),
      border: { width: 0, style: 'none', color: rgba(0, 0, 0, 0) },
      typography: {
        size: 12.5,
        lineHeight: 1.2,
        weight: selected ? 600 : 500,
        color: selected ? colorToken('textPrimary') : colorToken('textMuted'),
      },
      shadows: selected
        ? [{ offsetX: 0, offsetY: 1, blurRadius: 3, color: rgba(0, 0, 0, 0.14) }]
        : undefined,
      cursor: 'pointer',
      selectNone: true,
      transitionMs: 160,
    },
  };
});
