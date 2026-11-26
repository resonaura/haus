/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import {
  colorToken,
  corners,
  insets,
  mixColor,
  px,
  rgba,
  transparentColor,
  type ColorValue,
  type ShadowSpec,
} from '../../ir/geometry.js';
import { BackdropMaterial, GradientMaterial, SolidMaterial } from '../../ir/materials.js';
import type { ThemeMode, UiStyleSpec } from '../../ir/node.js';
import { Box, Heading, Text } from '../../primitives/elements.js';
import { getDeviceTileTokens } from '../devices/tile-theme.js';

export const SCENE_WHITE_INK = rgba(255, 255, 255, 0.94);

export const SCENE_BADGE_BACKDROP = new BackdropMaterial(
  { blurRadius: 12, tintColor: rgba(0, 0, 0, 0.34), tintOpacity: 1 },
  { fallbackColor: rgba(0, 0, 0, 0.58) },
);

export const SCENE_ICON_BACKDROP = new BackdropMaterial(
  { blurRadius: 12, tintColor: rgba(0, 0, 0, 0.24), tintOpacity: 1 },
  { fallbackColor: rgba(0, 0, 0, 0.44) },
);

export const SCENE_DETAILS_BACKDROP = new BackdropMaterial(
  { blurRadius: 10, tintColor: rgba(0, 0, 0, 0.38), tintOpacity: 1 },
  { fallbackColor: rgba(0, 0, 0, 0.62) },
);

export const SCENE_BADGE_STYLE: UiStyleSpec = {
  layout: { direction: 'row', alignItems: 'center', gap: px(4), padding: insets(3, 8) },
  typography: {
    size: 9,
    weight: 600,
    color: SCENE_WHITE_INK,
    letterSpacing: 0.15,
    lineHeight: 1.2,
  },
  material: SCENE_BADGE_BACKDROP,
  border: { width: 1, color: rgba(255, 255, 255, 0.12) },
  corners: corners(999, 'round'),
};

export function buildSceneCardFrame({
  mode,
  active,
  applying,
  hovered,
  highContrast,
  reducedTransparency,
  leadColor,
}: {
  readonly mode: ThemeMode;
  readonly active: boolean;
  readonly applying: boolean;
  readonly hovered: boolean;
  readonly highContrast: boolean;
  readonly reducedTransparency: boolean;
  readonly leadColor?: ColorValue;
}) {
  const tokens = getDeviceTileTokens(mode);
  const activeEdge = mixColor(tokens.tileGlassEdge, leadColor ?? tokens.hoverEdgeMix, 0.28);
  const baseEdge = active
    ? activeEdge
    : applying
      ? mixColor(tokens.tileGlassEdge, tokens.hoverEdgeMix, 0.16)
      : tokens.tileGlassInactiveEdge;
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
        ...(leadColor
          ? [
              {
                offsetX: 0,
                offsetY: 0,
                blurRadius: 20,
                color: mixColor(transparentColor, leadColor, 0.08),
              },
            ]
          : []),
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
    borderColor,
    shadows,
    material: new SolidMaterial(reducedTransparency ? colorToken('card') : tokens.tileGlassBase),
    sheenMaterial,
  };
}

export function SceneRooms({
  groups,
  portable = true,
}: {
  readonly groups: readonly {
    readonly id: string;
    readonly name: string;
    readonly count: number;
    readonly children: ReactNode;
  }[];
  readonly portable?: boolean;
}) {
  return (
    <Box className="scene-room-groups" style={portable ? { layout: { gap: px(27) } } : undefined}>
      {groups.map(({ id, name, count, children }) => (
        <Box
          semantic="section"
          id={`scene-group-${id}`}
          key={id}
          style={portable ? { layout: { gap: px(14) } } : undefined}
        >
          <Box
            className="scene-room-heading"
            style={
              portable
                ? { layout: { direction: 'row', alignItems: 'center', gap: px(10) } }
                : undefined
            }
          >
            <Heading
              level={2}
              style={portable ? { typography: { whiteSpace: 'nowrap' } } : undefined}
            >
              {name}
            </Heading>
            <Text
              size={portable ? 11 : undefined}
              tone={portable ? 'muted' : undefined}
              style={portable ? { typography: { whiteSpace: 'nowrap' } } : undefined}
            >
              {`${count} scenes`}
            </Text>
          </Box>
          {children}
        </Box>
      ))}
    </Box>
  );
}
