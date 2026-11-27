/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ReactNode } from 'react';
import {
  colorToken,
  corners,
  insets,
  mixColor,
  pct,
  px,
  rgba,
  transparentColor,
  type ColorValue,
} from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  GlassRim,
  Pressable,
  Row,
  Text,
  TextInput,
  useHausUi,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';

/** Refined search input bar with glass rim & optional count badge / trailing actions. */
export function ManagementSearchBar({
  id,
  ariaLabel,
  placeholder,
  value,
  onChange,
  countBadge,
  trailing,
}: {
  readonly id?: string;
  readonly ariaLabel: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly countBadge?: string;
  readonly trailing?: ReactNode;
}) {
  return (
    <Row align="center" gapPx={10} wrap style={{ layout: { width: pct(100), flexShrink: 0 } }}>
      <Box
        style={{
          layout: {
            display: 'flex',
            direction: 'row',
            alignItems: 'center',
            gap: px(8),
            flexGrow: 1,
            minWidth: px(200),
            minHeight: px(38),
            padding: insets(0, 12),
            position: 'relative',
            overflow: 'hidden',
          },
          material: new SolidMaterial(colorToken('card')),
          border: { width: 1, color: colorToken('border') },
          corners: corners(14),
        }}
      >
        <UiIcon name="search" size={15} />
        <TextInput
          id={id}
          ariaLabel={ariaLabel}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          style={{
            layout: { flexGrow: 1, minWidth: px(0), height: px(22) },
            typography: { size: 13, lineHeight: 1.35, color: colorToken('textPrimary') },
          }}
        />
        {value.length > 0 && (
          <Pressable
            id={id ? `${id}-clear` : undefined}
            ariaLabel="Clear search"
            onActivate={() => onChange('')}
            style={{
              layout: {
                padding: insets(4),
                alignItems: 'center',
                justifyContent: 'center',
              },
              corners: corners(999),
            }}
          >
            <UiIcon name="x" size={13} />
          </Pressable>
        )}
        <GlassRim preset="card" radiusPx={13} opacity={0.32} />
      </Box>
      {countBadge && (
        <Box
          style={{
            layout: {
              padding: insets(6, 11),
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            },
            material: new SolidMaterial(colorToken('card')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(999),
          }}
        >
          <Text size={11.5} mono tone="muted">
            {countBadge}
          </Text>
        </Box>
      )}
      {trailing}
    </Row>
  );
}

export interface ManagementFilterTabItem<TId extends string = string> {
  readonly id: TId;
  readonly label: string;
  readonly count: number;
}

/** Refined pill filter tab strip used across Integrations, Apps/Add-ons, and Discovery. */
export function ManagementFilterBar<TId extends string>({
  idPrefix,
  tabs,
  activeId,
  onChange,
}: {
  readonly idPrefix: string;
  readonly tabs: readonly ManagementFilterTabItem<TId>[];
  readonly activeId: TId;
  readonly onChange: (id: TId) => void;
}) {
  const activeBg = colorToken('controlFillActive');
  const activeBorder = colorToken('controlBorderActive');

  return (
    <Row gapPx={8} wrap style={{ layout: { flexShrink: 0 } }}>
      {tabs.map((tab) => {
        const active = activeId === tab.id;
        return (
          <Pressable
            key={tab.id}
            id={`${idPrefix}-${tab.id}`}
            ariaPressed={active}
            onActivate={() => onChange(tab.id)}
            style={{
              layout: {
                direction: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: px(7),
                padding: insets(6, 12),
                position: 'relative',
                overflow: 'hidden',
              },
              material: new SolidMaterial(active ? activeBg : colorToken('card')),
              border: {
                width: 1,
                color: active ? activeBorder : colorToken('border'),
              },
              corners: corners(999),
              transitionMs: 160,
            }}
          >
            <Text size={12} weight={active ? 600 : 500} tone={active ? 'primary' : 'muted'}>
              {tab.label}
            </Text>
            <Box
              style={{
                layout: { padding: insets(1, 6), alignItems: 'center', justifyContent: 'center' },
                material: new SolidMaterial(
                  mixColor(transparentColor, colorToken('ink'), active ? 0.12 : 0.06),
                ),
                corners: corners(999),
              }}
            >
              <Text
                size={10.5}
                mono
                weight={active ? 600 : 500}
                tone={active ? 'primary' : 'muted'}
              >
                {String(tab.count)}
              </Text>
            </Box>
          </Pressable>
        );
      })}
    </Row>
  );
}

export type ManagementPillTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

function pillToneColors(
  tone: ManagementPillTone,
  dark: boolean,
): {
  readonly bg: ColorValue;
  readonly border: ColorValue;
  readonly dot: ColorValue;
  readonly text: ColorValue;
} {
  switch (tone) {
    case 'success':
      return {
        bg: rgba(52, 211, 153, dark ? 0.14 : 0.12),
        border: rgba(52, 211, 153, dark ? 0.34 : 0.3),
        dot: rgba(52, 211, 153, 1),
        text: dark ? rgba(110, 231, 183, 1) : rgba(4, 120, 87, 1),
      };
    case 'warning':
      return {
        bg: rgba(245, 158, 11, dark ? 0.15 : 0.12),
        border: rgba(245, 158, 11, dark ? 0.36 : 0.32),
        dot: rgba(251, 191, 36, 1),
        text: dark ? rgba(252, 211, 77, 1) : rgba(180, 83, 9, 1),
      };
    case 'danger':
      return {
        bg: rgba(239, 68, 68, dark ? 0.15 : 0.12),
        border: rgba(239, 68, 68, dark ? 0.36 : 0.3),
        dot: rgba(248, 113, 113, 1),
        text: dark ? rgba(252, 165, 165, 1) : rgba(185, 28, 28, 1),
      };
    case 'accent':
      return {
        bg: rgba(56, 189, 248, dark ? 0.14 : 0.12),
        border: rgba(56, 189, 248, dark ? 0.34 : 0.3),
        dot: rgba(56, 189, 248, 1),
        text: dark ? rgba(125, 211, 252, 1) : rgba(3, 105, 161, 1),
      };
    default:
      return {
        bg: mixColor(transparentColor, colorToken('ink'), dark ? 0.08 : 0.055),
        border: colorToken('border'),
        dot: colorToken('textMuted'),
        text: colorToken('textSecondary'),
      };
  }
}

/** Crisp pill badge used for running/stopped state, discovery source, updates, and warnings. */
export function ManagementStatusPill({
  label,
  tone = 'neutral',
  showDot = false,
}: {
  readonly label: string;
  readonly tone?: ManagementPillTone;
  readonly showDot?: boolean;
}) {
  const { theme } = useHausUi();
  const colors = pillToneColors(tone, theme.mode === 'dark');

  return (
    <Box
      style={{
        layout: {
          display: 'flex',
          direction: 'row',
          alignItems: 'center',
          gap: px(5),
          padding: insets(2, 8),
          flexShrink: 0,
        },
        material: new SolidMaterial(colors.bg),
        border: { width: 1, color: colors.border },
        corners: corners(999),
      }}
    >
      {showDot && (
        <Box
          ariaHidden
          style={{
            layout: { width: px(6), height: px(6), flexShrink: 0 },
            material: new SolidMaterial(colors.dot),
            corners: corners(999, 'round'),
          }}
        />
      )}
      <Text
        size={10.5}
        weight={600}
        style={{ typography: { size: 10.5, weight: 600, color: colors.text, lineHeight: 1.25 } }}
      >
        {label}
      </Text>
    </Box>
  );
}
