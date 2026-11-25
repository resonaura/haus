/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState, type ReactNode } from 'react';
import {
  colorToken,
  corners,
  insets,
  pct,
  px,
  type ColorValue,
  type EdgeInsets,
  type ShadowSpec,
} from '../../ir/geometry.js';
import { SolidMaterial, type MaterialIR } from '../../ir/materials.js';
import type { UiStyleSpec } from '../../ir/node.js';
import { Box, Text } from '../../primitives/elements.js';
import { GlassRim } from '../../primitives/glass-rim.js';

export function serverPanelSurface(): {
  readonly material: MaterialIR;
  readonly borderColor: ColorValue;
  readonly shadows: readonly ShadowSpec[];
} {
  return {
    material: new SolidMaterial(colorToken('card')),
    borderColor: colorToken('border'),
    shadows: [],
  };
}

/** Shared Electron-matched neutral continuous-corner panel with analytical Liquid Glass rim. */
export function ServerGlassPanel({
  padding = insets(22),
  radius = 24,
  interactive = false,
  ariaLabel,
  style,
  children,
}: {
  readonly padding?: EdgeInsets;
  readonly radius?: number;
  readonly interactive?: boolean;
  readonly ariaLabel?: string;
  readonly style?: UiStyleSpec;
  readonly children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const surface = serverPanelSurface();

  return (
    <Box
      semantic="section"
      ariaLabel={ariaLabel}
      onPointerEnter={interactive ? () => setHovered(true) : undefined}
      onPointerLeave={interactive ? () => setHovered(false) : undefined}
      style={{
        ...style,
        layout: {
          display: 'flex',
          direction: 'column',
          flexShrink: 0,
          position: 'relative',
          overflow: 'hidden',
          padding,
          ...style?.layout,
        },
        material: surface.material,
        border: { width: 1, color: surface.borderColor },
        shadows: surface.shadows,
        corners: corners(radius),
      }}
    >
      {children}
      <GlassRim preset="card" radiusPx={Math.max(8, radius - 1)} opacity={hovered ? 0.68 : 0.46} />
    </Box>
  );
}

/** Clean two-column definition row matching Electron's `.server-system-facts`. */
export function ServerFactRow({
  label,
  icon,
  value,
  subContent,
}: {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly value: ReactNode;
  readonly subContent?: ReactNode;
}) {
  return (
    <Box
      style={{
        layout: {
          display: 'flex',
          direction: 'row',
          alignItems: 'start',
          gap: px(12),
          width: pct(100),
          padding: insets(6, 0),
        },
      }}
    >
      <Box
        style={{
          layout: {
            display: 'flex',
            direction: 'row',
            alignItems: 'center',
            gap: px(6),
            width: px(136),
            flexShrink: 0,
            padding: insets(1, 0, 0, 0),
          },
        }}
      >
        {icon}
        <Text size={11.5} tone="muted" style={{ typography: { size: 11.5, lineHeight: 1.4 } }}>
          {label}
        </Text>
      </Box>
      <Box
        style={{
          layout: {
            display: 'flex',
            direction: 'column',
            gap: px(4),
            flexGrow: 1,
            minWidth: px(0),
          },
        }}
      >
        {typeof value === 'string' ? (
          <Text
            size={12.5}
            style={{
              typography: {
                size: 12.5,
                lineHeight: 1.45,
                tabularNums: true,
                color: colorToken('textPrimary'),
              },
            }}
          >
            {value}
          </Text>
        ) : (
          value
        )}
        {subContent}
      </Box>
    </Box>
  );
}
