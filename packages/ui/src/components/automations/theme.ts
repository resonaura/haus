/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  colorToken,
  corners,
  insets,
  mixColor,
  transparentColor,
  type ColorValue,
  type CornerRadius,
  type EdgeInsets,
} from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import type { ThemeMode, UiStyleSpec } from '../../ir/node.js';
import { getDeviceTileTokens } from '../devices/tile-theme.js';

export interface AutomationNeutralTokens {
  readonly cardSurface: SolidMaterial;
  readonly cardNestedSurface: SolidMaterial;
  readonly badgeSurface: SolidMaterial;
  readonly activePillSurface: SolidMaterial;
  readonly border: ColorValue;
  readonly activeBorder: ColorValue;
  readonly iconCss: string;
  readonly mutedIconCss: string;
}

/** Monochrome neutral surface tokens aligned with DesktopDeviceTile (no rainbow category tints). */
export function getAutomationNeutralTokens(mode: ThemeMode): AutomationNeutralTokens {
  const dark = mode === 'dark';
  const tile = getDeviceTileTokens(mode);
  return {
    cardSurface: new SolidMaterial(tile.tileGlassBase),
    cardNestedSurface: new SolidMaterial(colorToken('surface')),
    badgeSurface: new SolidMaterial(
      mixColor(transparentColor, colorToken('ink'), dark ? 0.1 : 0.07),
    ),
    activePillSurface: new SolidMaterial(colorToken('surfaceActive')),
    border: tile.tileGlassEdge,
    activeBorder: mixColor(tile.tileGlassEdge, tile.deviceNeutral, 0.34),
    iconCss: dark ? '#f4f4f5' : '#18181b',
    mutedIconCss: dark ? '#a1a1aa' : '#71717a',
  };
}

/** Shared interactive pill style with smooth hover and press transitions on both GPUIX and DOM. */
export function automationPillStyle({
  active,
  padding = insets(6, 12),
  cornerSpec = corners(999, 'round'),
  restToken = 'surface',
}: {
  readonly active: boolean;
  readonly padding?: EdgeInsets;
  readonly cornerSpec?: CornerRadius;
  readonly restToken?: 'surface' | 'surfaceSecondary';
}): UiStyleSpec {
  return {
    layout: { padding },
    material: new SolidMaterial(active ? colorToken('surfaceActive') : colorToken(restToken)),
    border: {
      width: 1,
      color: active ? colorToken('accent') : colorToken('border'),
    },
    corners: cornerSpec,
    cursor: 'pointer',
    transitionMs: 160,
    states: {
      hover: {
        material: new SolidMaterial(
          active ? colorToken('surfaceActive') : colorToken('surfaceHover'),
        ),
        border: {
          width: 1,
          color: active
            ? colorToken('accent')
            : mixColor(colorToken('border'), colorToken('ink'), 0.18),
        },
      },
      pressed: {
        transform: { scale: 0.96 },
      },
    },
  };
}
