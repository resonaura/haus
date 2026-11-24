/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import {
  getCategoryMetadata,
  type DeviceBadgeStatus,
  type DeviceCategory,
} from '../categories/index.js';
import { corners, insets, pct, px, rgba } from '../ir/geometry.js';
import { SolidMaterial } from '../ir/materials.js';
import { Pressable, Row, Stack, Text } from '../primitives/elements.js';
import { StatusBadge } from './badge.js';
import { CategoryIcon } from './icon.js';

export interface DeviceCardProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly category: DeviceCategory;
  readonly status: DeviceBadgeStatus;
  readonly statusLabel?: string;
  readonly onClick?: () => void;
  readonly actionSlot?: ReactNode;
  readonly className?: string;
}

const background = new SolidMaterial(rgba(21, 25, 30));
const border = rgba(42, 49, 58);
const foreground = rgba(243, 244, 246);
const muted = rgba(156, 163, 175);

export function DeviceCard({
  title,
  subtitle,
  category,
  status,
  statusLabel,
  onClick,
  actionSlot,
  className = '',
}: DeviceCardProps) {
  return (
    <Row
      onPress={onClick}
      className={`haus-device-card ${className}`.trim()}
      justify="between"
      style={{
        layout: { padding: insets(12, 16) },
        corners: corners(12, 'round'),
        material: background,
        border: { width: 1, color: border },
        cursor: onClick ? 'pointer' : 'default',
        transitionMs: 150,
      }}
    >
      <Row gapPx={12}>
        <CategoryIcon category={category} size={24} />
        <Stack gapPx={0}>
          <Text size={14} weight={600} style={{ typography: { color: foreground } }}>
            {title}
          </Text>
          {subtitle && (
            <Text size={12} style={{ typography: { color: muted } }}>
              {subtitle}
            </Text>
          )}
        </Stack>
      </Row>
      <Row gapPx={10}>
        <StatusBadge
          status={status}
          label={statusLabel ?? getCategoryMetadata(category).singularLabel}
        />
        {actionSlot}
      </Row>
    </Row>
  );
}

export interface ControlTileProps {
  readonly title: string;
  readonly stateText: string;
  readonly category: DeviceCategory;
  readonly active: boolean;
  readonly onToggle?: () => void;
  readonly className?: string;
}

export function ControlTile({
  title,
  stateText,
  category,
  active,
  onToggle,
  className = '',
}: ControlTileProps) {
  return (
    <Pressable
      className={`haus-control-tile ${className}`.trim()}
      onActivate={onToggle}
      style={{
        layout: {
          display: 'flex',
          direction: 'column',
          alignItems: 'start',
          justifyContent: 'between',
          width: pct(100),
          minHeight: px(84),
          padding: insets(14),
          gap: px(8),
        },
        corners: corners(14, 'round'),
        material: active ? new SolidMaterial(rgba(59, 130, 246, 0.12)) : background,
        border: { width: 1, color: active ? rgba(59, 130, 246, 0.4) : border },
        cursor: onToggle ? 'pointer' : 'default',
        transitionMs: 150,
      }}
    >
      <CategoryIcon category={category} size={22} color={active ? '#3b82f6' : undefined} />
      <Stack gapPx={0}>
        <Text
          size={13}
          weight={600}
          style={{ typography: { color: active ? rgba(255, 255, 255) : foreground } }}
        >
          {title}
        </Text>
        <Text size={11} style={{ typography: { color: active ? rgba(147, 197, 253) : muted } }}>
          {stateText}
        </Text>
      </Stack>
    </Pressable>
  );
}
