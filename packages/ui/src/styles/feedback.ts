/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { clampLength, colorToken, corners, insets, pct, px, rgba, vw } from '../ir/geometry.js';
import { BackdropMaterial, LiquidGlassMaterial, SolidMaterial } from '../ir/materials.js';
import { defineStyleSheet } from './sheet.js';

export type HausToastTone = 'default' | 'success' | 'warning' | 'danger';

export const toastStyles = defineStyleSheet('toast', (theme, tone: HausToastTone) => {
  const isDark = theme.mode === 'dark';
  const indicatorColor =
    tone === 'success'
      ? theme.color('success')
      : tone === 'warning'
        ? theme.color('warning')
        : tone === 'danger'
          ? theme.color('critical')
          : theme.color('accent');

  return {
    region: {
      layout: {
        position: 'fixed',
        inset: { bottom: px(20), left: pct(50) },
        zIndex: 1200,
        display: 'flex',
        direction: 'column',
        gap: px(9),
        width: clampLength(px(280), vw(92), px(420)),
      },
      transform: { translateX: 0 },
      pointerEvents: 'none',
    },
    card: {
      layout: {
        display: 'flex',
        direction: 'row',
        alignItems: 'center',
        gap: px(10),
        padding: insets(11, 14),
        width: pct(100),
      },
      material: new LiquidGlassMaterial({
        tintColor: theme.color('surfaceElevated'),
        blurRadius: theme.palette.blur.glass,
        refractionStrength: 10,
        saturation: 1.32,
        tintOpacity: isDark ? 0.82 : 0.88,
        rimPreset: 'pill',
      }),
      corners: corners(16, 'superellipse', 1.4),
      border: { width: 1, style: 'solid', color: colorToken('materialEdge') },
      shadows: [
        {
          offsetX: 0,
          offsetY: 14,
          blurRadius: 34,
          spreadRadius: -12,
          color: rgba(0, 0, 0, isDark ? 0.56 : 0.2),
        },
      ],
      pointerEvents: 'auto',
    },
    indicator: {
      layout: { width: px(8), height: px(8), flexShrink: 0 },
      material: new SolidMaterial(indicatorColor),
      corners: corners(999, 'round'),
    },
    title: {
      layout: { flexGrow: 1 },
      typography: { size: 13, weight: 500, lineHeight: 1.35, color: colorToken('textPrimary') },
    },
    closeButton: {
      layout: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: px(24),
        height: px(24),
        flexShrink: 0,
      },
      material: new SolidMaterial(rgba(0, 0, 0, 0)),
      corners: corners(999, 'round'),
      border: { width: 0, style: 'none', color: rgba(0, 0, 0, 0) },
      typography: { size: 14, color: colorToken('textMuted') },
      cursor: 'pointer',
      states: {
        hover: {
          material: new SolidMaterial(isDark ? rgba(255, 255, 255, 0.1) : rgba(15, 23, 42, 0.08)),
          textColor: colorToken('textPrimary'),
        },
      },
    },
  };
});

export const popoverStyles = defineStyleSheet(
  'popover',
  (theme, placement: 'top' | 'bottom' | 'left' | 'right') => {
    const isDark = theme.mode === 'dark';
    const positionInset =
      placement === 'top'
        ? { bottom: pct(100), left: px(0) }
        : placement === 'left'
          ? { top: px(0), right: pct(100) }
          : placement === 'right'
            ? { top: px(0), left: pct(100) }
            : { top: pct(100), left: px(0) };

    return {
      anchor: {
        layout: { position: 'relative', display: 'inline-flex' },
      },
      surface: {
        layout: {
          position: 'absolute',
          inset: positionInset,
          zIndex: 1100,
          display: 'flex',
          direction: 'column',
          minWidth: px(180),
          padding: insets(8),
          gap: px(4),
          margin:
            placement === 'top'
              ? { bottom: px(8) }
              : placement === 'left'
                ? { right: px(8) }
                : placement === 'right'
                  ? { left: px(8) }
                  : { top: px(8) },
        },
        material: new BackdropMaterial(
          {
            blurRadius: theme.palette.blur.lg,
            saturation: 1.35,
            tintColor: theme.color('surfaceElevated'),
          },
          { fallbackColor: theme.color('surfaceElevated') },
        ),
        corners: corners(14, 'superellipse', 1.4),
        border: { width: 1, style: 'solid', color: colorToken('materialEdge') },
        typography: { color: colorToken('textPrimary') },
        shadows: [
          {
            offsetX: 0,
            offsetY: 16,
            blurRadius: 40,
            spreadRadius: -14,
            color: rgba(0, 0, 0, isDark ? 0.56 : 0.2),
          },
        ],
      },
      menuItem: {
        layout: {
          display: 'flex',
          direction: 'row',
          alignItems: 'center',
          gap: px(8),
          padding: insets(7, 10),
          width: pct(100),
        },
        material: new SolidMaterial(rgba(0, 0, 0, 0)),
        corners: corners(9, 'superellipse', 1.4),
        border: { width: 0, style: 'none', color: rgba(0, 0, 0, 0) },
        typography: { size: 12.5, weight: 500, color: colorToken('textPrimary'), align: 'left' },
        cursor: 'pointer',
        transitionMs: 120,
        states: {
          hover: {
            material: new SolidMaterial(isDark ? rgba(255, 255, 255, 0.1) : rgba(15, 23, 42, 0.07)),
          },
        },
      },
      menuDanger: {
        layout: {
          display: 'flex',
          direction: 'row',
          alignItems: 'center',
          gap: px(8),
          padding: insets(7, 10),
          width: pct(100),
        },
        material: new SolidMaterial(rgba(0, 0, 0, 0)),
        corners: corners(9, 'superellipse', 1.4),
        border: { width: 0, style: 'none', color: rgba(0, 0, 0, 0) },
        typography: { size: 12.5, weight: 500, color: colorToken('critical'), align: 'left' },
        cursor: 'pointer',
        transitionMs: 120,
        states: {
          hover: { material: new SolidMaterial(rgba(239, 68, 68, 0.14)) },
        },
      },
    };
  },
);

export const codeStyles = defineStyleSheet('code', (theme) => ({
  inline: {
    layout: { padding: insets(2, 6) },
    material: new SolidMaterial(theme.color('soft')),
    corners: corners(6, 'round'),
    typography: { fontFamily: 'mono', size: 12, color: colorToken('textPrimary') },
  },
  block: {
    layout: { padding: insets(10, 12), overflowX: 'auto', width: pct(100) },
    material: new SolidMaterial(theme.color('soft')),
    corners: corners(10, 'superellipse', 1.4),
    border: { width: 1, style: 'solid', color: colorToken('border') },
    typography: { fontFamily: 'mono', size: 12, lineHeight: 1.5, color: colorToken('textPrimary') },
  },
}));
