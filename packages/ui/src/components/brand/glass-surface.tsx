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
  mixColor,
  pct,
  px,
  rgba,
  type EdgeInsets,
} from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import type { UiStyleSpec } from '../../ir/node.js';
import {
  Box,
  GlassRim,
  Heading,
  Pressable,
  Row,
  Stack,
  Text,
  useHausUi,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';

const ATTENTION_BORDER = rgba(245, 158, 11, 0.36);
const ATTENTION_RIM_TINT = rgba(251, 191, 36, 0.55);

/**
 * Refined monochrome continuous-corner glass card modeled directly on `ServerGlassPanel`,
 * with analytical `<GlassRim />` edge lighting and subtle hover response.
 */
export function ManagementGlassCard({
  id,
  padding = insets(18),
  radius = 22,
  interactive = false,
  attention = false,
  ariaLabel,
  className,
  style,
  onPress,
  children,
}: {
  readonly id?: string;
  readonly padding?: EdgeInsets;
  readonly radius?: number;
  readonly interactive?: boolean;
  readonly attention?: boolean;
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly onPress?: () => void;
  readonly children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const { theme } = useHausUi();
  const hoverSurface =
    theme.mode === 'dark'
      ? mixColor(colorToken('card'), colorToken('ink'), 0.04)
      : mixColor(colorToken('card'), colorToken('ink'), 0.025);

  const isHoverable = interactive || Boolean(onPress);
  const baseStyle: UiStyleSpec = {
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
    material: new SolidMaterial(isHoverable && hovered ? hoverSurface : colorToken('card')),
    border: {
      width: 1,
      color: attention ? ATTENTION_BORDER : colorToken('border'),
    },
    shadows: [],
    corners: corners(radius),
    transitionMs: 180,
  };

  const rim = (
    <GlassRim
      preset="card"
      radiusPx={Math.max(8, radius - 1)}
      opacity={hovered ? 0.68 : 0.46}
      tintColor={attention ? ATTENTION_RIM_TINT : undefined}
    />
  );

  if (onPress) {
    return (
      <Pressable
        id={id}
        className={className}
        ariaLabel={ariaLabel}
        onActivate={onPress}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        style={{
          ...baseStyle,
          layout: {
            ...baseStyle.layout,
            alignItems: 'stretch',
            justifyContent: 'start',
          },
        }}
      >
        {children}
        {rim}
      </Pressable>
    );
  }

  return (
    <Box
      id={id}
      semantic="article"
      className={className}
      ariaLabel={ariaLabel}
      onPointerEnter={interactive ? () => setHovered(true) : undefined}
      onPointerLeave={interactive ? () => setHovered(false) : undefined}
      style={baseStyle}
    >
      {children}
      {rim}
    </Box>
  );
}

/** Refined intro hero card matching Electron & Servers page geometry with `<GlassRim />`. */
export function ManagementHeroBanner({
  icon,
  title,
  subtitle,
  actions,
}: {
  readonly icon: UiIconName;
  readonly title: string;
  readonly subtitle: string;
  readonly actions?: ReactNode;
}) {
  return (
    <ManagementGlassCard
      padding={insets(18, 20)}
      radius={24}
      style={{ layout: { width: pct(100) } }}
    >
      <Row align="center" justify="between" gapPx={16} wrap style={{ layout: { width: pct(100) } }}>
        <Row align="center" gapPx={14} style={{ layout: { flexGrow: 1, minWidth: px(220) } }}>
          <Box
            style={{
              layout: {
                width: px(42),
                height: px(42),
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              },
              material: new SolidMaterial(colorToken('surface')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(13),
            }}
          >
            <UiIcon name={icon} size={19} />
          </Box>
          <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Text
              size={15}
              weight={600}
              style={{ typography: { size: 15, weight: 600, lineHeight: 1.3 } }}
            >
              {title}
            </Text>
            <Text size={12.5} tone="muted" style={{ typography: { size: 12.5, lineHeight: 1.4 } }}>
              {subtitle}
            </Text>
          </Stack>
        </Row>
        {actions ? (
          <Row align="center" gapPx={8} wrap>
            {actions}
          </Row>
        ) : null}
      </Row>
    </ManagementGlassCard>
  );
}

/** Centered glass empty-state card with `<GlassRim />`. */
export function ManagementEmptyCard({
  icon,
  title,
  subtitle,
  action,
}: {
  readonly icon: UiIconName;
  readonly title: string;
  readonly subtitle: string;
  readonly action?: ReactNode;
}) {
  return (
    <ManagementGlassCard
      padding={insets(36, 24)}
      radius={22}
      style={{ layout: { width: pct(100) } }}
    >
      <Stack align="center" gapPx={8} style={{ layout: { width: pct(100) } }}>
        <Box
          style={{
            layout: {
              width: px(46),
              height: px(46),
              alignItems: 'center',
              justifyContent: 'center',
              margin: insets(0, 0, 4, 0),
            },
            material: new SolidMaterial(colorToken('surface')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(14),
          }}
        >
          <UiIcon name={icon} size={22} />
        </Box>
        <Heading level={3} size={15.5} weight={600}>
          {title}
        </Heading>
        <Text
          size={12.5}
          tone="muted"
          style={{ typography: { size: 12.5, align: 'center', lineHeight: 1.45 } }}
        >
          {subtitle}
        </Text>
        {action ? <Box style={{ layout: { margin: insets(6, 0, 0, 0) } }}>{action}</Box> : null}
      </Stack>
    </ManagementGlassCard>
  );
}
