/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { clampLength, colorToken, corners, insets, pct, px, rgba, vw } from '../ir/geometry.js';
import { BackdropMaterial, LiquidGlassMaterial, SolidMaterial } from '../ir/materials.js';
import { defineStyleSheet } from './sheet.js';

export const fieldStyles = defineStyleSheet(
  'field',
  (theme, props: { readonly error?: boolean; readonly disabled?: boolean }) => ({
    root: {
      layout: { display: 'flex', direction: 'column', gap: px(6), width: pct(100) },
    },
    label: {
      typography: { size: 12.5, weight: 500, color: colorToken('textPrimary') },
    },
    description: {
      typography: { size: 11.5, color: colorToken('textMuted') },
    },
    error: {
      typography: { size: 11.5, color: colorToken('critical') },
    },
    input: {
      layout: { width: pct(100), padding: insets(8, 11) },
      material: new SolidMaterial(theme.color('soft')),
      corners: corners(theme.palette.radii.field, 'superellipse', 1.4),
      border: {
        width: 1,
        style: 'solid',
        color: props.error ? colorToken('critical') : colorToken('border'),
      },
      typography: { size: 13, color: colorToken('textPrimary') },
      opacity: props.disabled ? 0.5 : 1,
      cursor: props.disabled ? 'not-allowed' : 'text',
    },
    select: {
      layout: { padding: insets(7, 11) },
      material: new SolidMaterial(theme.color('soft')),
      corners: corners(theme.palette.radii.field, 'superellipse', 1.4),
      border: { width: 1, style: 'solid', color: colorToken('border') },
      typography: { size: 12.5, color: colorToken('textPrimary') },
      opacity: props.disabled ? 0.5 : 1,
      cursor: props.disabled ? 'not-allowed' : 'pointer',
    },
  }),
);

export interface DialogStyleProps {
  readonly size: 'sm' | 'md' | 'lg' | 'xl' | 'adaptive';
  readonly backdrop: 'blur' | 'liquid-glass' | 'dim';
}

export const dialogStyles = defineStyleSheet('dialog', (theme, props: DialogStyleProps) => {
  const isDark = theme.mode === 'dark';
  const widthSpec =
    props.size === 'sm'
      ? clampLength(px(360), vw(88), px(440))
      : props.size === 'lg'
        ? clampLength(px(520), vw(86), px(780))
        : props.size === 'xl'
          ? clampLength(px(640), vw(90), px(1080))
          : props.size === 'adaptive'
            ? clampLength(px(480), vw(86), px(1120))
            : clampLength(px(420), vw(88), px(520));

  const backdropMaterial =
    props.backdrop === 'dim'
      ? new SolidMaterial(rgba(2, 6, 23, isDark ? 0.62 : 0.36))
      : new BackdropMaterial(
          {
            blurRadius: props.backdrop === 'liquid-glass' ? 16 : 10,
            saturation: 1.2,
            tintColor: rgba(2, 6, 23, isDark ? 0.54 : 0.28),
          },
          { fallbackColor: rgba(2, 6, 23, 0.5) },
        );

  return {
    backdrop: {
      layout: {
        position: 'fixed',
        inset: insets(0),
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: insets(16),
      },
      material: backdropMaterial,
    },
    panel: {
      layout: {
        position: 'relative',
        display: 'flex',
        direction: 'column',
        width: widthSpec,
        maxHeight: pct(90),
        padding: insets(24),
        gap: px(14),
      },
      material:
        props.backdrop === 'liquid-glass'
          ? new LiquidGlassMaterial({
              tintColor: theme.color('surface'),
              blurRadius: theme.palette.blur.glass,
              refractionStrength: 14,
              saturation: 1.32,
              tintOpacity: 0.84,
              rimPreset: 'card',
            })
          : new SolidMaterial(theme.color('surface')),
      corners: corners(theme.palette.radii.panel, 'superellipse', 1.4),
      border: { width: 1, style: 'solid', color: colorToken('materialEdge') },
      shadows: [
        {
          offsetX: 0,
          offsetY: 24,
          blurRadius: 64,
          spreadRadius: -16,
          color: rgba(0, 0, 0, isDark ? 0.62 : 0.24),
        },
      ],
    },
    header: {
      layout: {
        display: 'flex',
        direction: 'row',
        alignItems: 'start',
        justifyContent: 'between',
        gap: px(12),
      },
    },
    footer: {
      layout: {
        display: 'flex',
        direction: 'row',
        alignItems: 'center',
        justifyContent: 'end',
        gap: px(10),
        padding: { top: px(6) },
      },
    },
    closeButton: {
      layout: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: px(30),
        height: px(30),
        flexShrink: 0,
      },
      material: new SolidMaterial(isDark ? rgba(255, 255, 255, 0.08) : rgba(15, 23, 42, 0.06)),
      corners: corners(999, 'round'),
      border: { width: 1, style: 'solid', color: colorToken('border') },
      typography: { size: 16, weight: 500, color: colorToken('textSecondary') },
      cursor: 'pointer',
      transitionMs: 140,
      states: {
        hover: {
          material: new SolidMaterial(isDark ? rgba(255, 255, 255, 0.14) : rgba(15, 23, 42, 0.12)),
          textColor: colorToken('textPrimary'),
        },
      },
    },
  };
});
