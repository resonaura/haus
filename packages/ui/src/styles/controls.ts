/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { colorToken, corners, insets, pct, px, rgba } from '../ir/geometry.js';
import { LiquidGlassMaterial, SolidMaterial } from '../ir/materials.js';
import type { UiStyleSpec } from '../ir/node.js';
import { defineStyleSheet } from './sheet.js';

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
            hover: { opacity: 0.92, transform: { translateY: -0.5 } },
            pressed: { opacity: 0.85, transform: { scale: 0.98 } },
          },
        };
      case 'secondary':
        return {
          material: new SolidMaterial(isDark ? rgba(255, 255, 255, 0.1) : rgba(15, 23, 42, 0.07)),
          typography: { color: colorToken('textPrimary'), weight: 500 },
          border: { width: 1, style: 'solid', color: colorToken('border') },
          states: {
            hover: {
              material: new SolidMaterial(
                isDark ? rgba(255, 255, 255, 0.15) : rgba(15, 23, 42, 0.11),
              ),
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
              material: new SolidMaterial(
                isDark ? rgba(255, 255, 255, 0.08) : rgba(15, 23, 42, 0.05),
              ),
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
              material: new SolidMaterial(
                isDark ? rgba(255, 255, 255, 0.08) : rgba(15, 23, 42, 0.06),
              ),
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
            hover: { opacity: 0.95, transform: { translateY: -0.5 } },
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

const SWITCH_SIZES = {
  sm: { width: 34, height: 20, thumb: 14, pad: 3 },
  md: { width: 42, height: 24, thumb: 18, pad: 3 },
  lg: { width: 50, height: 28, thumb: 22, pad: 3 },
} as const;

export interface SwitchStyleProps {
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly size: HausControlSize;
}

export const switchStyles = defineStyleSheet('switch', (theme, props: SwitchStyleProps) => {
  const dim = SWITCH_SIZES[props.size];
  const isDark = theme.mode === 'dark';

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
        justifyContent: props.checked ? 'end' : 'start',
        width: px(dim.width),
        height: px(dim.height),
        padding: insets(dim.pad),
        flexShrink: 0,
      },
      material: new SolidMaterial(
        props.checked
          ? theme.color('accent')
          : isDark
            ? rgba(255, 255, 255, 0.16)
            : rgba(15, 23, 42, 0.16),
      ),
      corners: corners(999, 'round'),
      border: {
        width: 1,
        style: 'solid',
        color: props.checked ? colorToken('accent') : colorToken('border'),
      },
      opacity: props.disabled ? 0.45 : 1,
      cursor: props.disabled ? 'not-allowed' : 'pointer',
      transitionMs: 180,
      states: {
        hover: { opacity: 0.94 },
        pressed: { transform: { scale: 0.97 } },
      },
    },
    thumb: {
      layout: { width: px(dim.thumb), height: px(dim.thumb), flexShrink: 0 },
      material: new SolidMaterial(
        isDark && props.checked ? rgba(18, 18, 22, 0.96) : rgba(255, 255, 255, 0.98),
      ),
      corners: corners(999, 'round'),
      shadows: [{ offsetX: 0, offsetY: 1, blurRadius: 3, color: rgba(0, 0, 0, 0.28) }],
      transitionMs: 180,
    },
    label: {
      typography: { size: 13.5, weight: 500, color: colorToken('textPrimary') },
    },
    description: {
      typography: { size: 11.5, color: colorToken('textMuted') },
    },
  };
});

export interface SliderStyleProps {
  readonly ratioPct: number;
  readonly disabled?: boolean;
}

export const sliderStyles = defineStyleSheet('slider', (theme, props: SliderStyleProps) => {
  const isDark = theme.mode === 'dark';
  return {
    root: {
      layout: { display: 'flex', direction: 'column', gap: px(6), width: pct(100) },
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
      typography: { size: 12.5, weight: 500, color: colorToken('textPrimary') },
    },
    valueLabel: {
      typography: {
        fontFamily: 'mono',
        size: 11.5,
        tabularNums: true,
        color: colorToken('textMuted'),
      },
    },
    trackHost: {
      layout: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        width: pct(100),
        height: px(22),
      },
      cursor: props.disabled ? 'not-allowed' : 'pointer',
    },
    track: {
      layout: { width: pct(100), height: px(6), overflow: 'hidden' },
      material: new SolidMaterial(isDark ? rgba(255, 255, 255, 0.14) : rgba(15, 23, 42, 0.12)),
      corners: corners(999, 'round'),
    },
    fill: {
      layout: { width: pct(props.ratioPct), height: pct(100) },
      material: new SolidMaterial(theme.color('accent')),
      corners: corners(999, 'round'),
    },
    thumbRow: {
      layout: {
        position: 'absolute',
        inset: insets(0),
        width: pct(100),
        height: pct(100),
        display: 'flex',
        direction: 'row',
        alignItems: 'center',
      },
      pointerEvents: 'none',
    },
    thumb: {
      layout: {
        width: px(16),
        height: px(16),
        flexShrink: 0,
      },
      material: new SolidMaterial(rgba(255, 255, 255, 0.98)),
      corners: corners(999, 'round'),
      border: {
        width: 1,
        style: 'solid',
        color: isDark ? rgba(0, 0, 0, 0.28) : colorToken('materialEdge'),
      },
      shadows: [{ offsetX: 0, offsetY: 2, blurRadius: 6, color: rgba(0, 0, 0, 0.28) }],
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
      material: new SolidMaterial(isDark ? rgba(255, 255, 255, 0.08) : rgba(15, 23, 42, 0.06)),
      corners: corners(999, 'round'),
      border: { width: 1, style: 'solid', color: colorToken('border') },
    },
    option: {
      layout: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: insets(5, 12),
      },
      material: selected
        ? new SolidMaterial(isDark ? rgba(255, 255, 255, 0.16) : rgba(255, 255, 255, 0.96))
        : new SolidMaterial(rgba(0, 0, 0, 0)),
      corners: corners(999, 'round'),
      border: { width: 0, style: 'none', color: rgba(0, 0, 0, 0) },
      typography: {
        size: 12.5,
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
