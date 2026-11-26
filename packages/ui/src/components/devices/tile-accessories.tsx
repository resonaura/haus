/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type * as React from 'react';
import type { ReactNode } from 'react';
import type { LightEffectOption } from '@haus/core/device';
import {
  colorToken,
  corners,
  insets,
  mixColor,
  px,
  transparentColor,
  type ColorValue,
} from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { useHausUi } from '../../primitives/context.js';
import { Box, Pressable, Row, Text } from '../../primitives/elements.js';
import { resolveColorToCss } from '../../renderers/contract.js';
import { UiIcon } from '../icon.js';
import { BatteryLevelIcon } from './battery.js';
import type { DeviceTileBatteryData } from './device.js';
import { buildEffectBadgeStyle, parseCssColor } from './tile-theme.js';

export function DesktopTileIndicators({
  slowPending,
  favorite,
  groupCount,
  battery,
  hovered,
  showStatusDot,
  isActive,
  deviceColor,
  colorSwatch,
  activeEffect,
  topRight,
  indicators,
}: {
  readonly slowPending: boolean;
  readonly favorite?: boolean;
  readonly groupCount?: number;
  readonly battery?: DeviceTileBatteryData;
  readonly hovered: boolean;
  readonly showStatusDot: boolean;
  readonly isActive: boolean;
  readonly deviceColor: ColorValue;
  readonly colorSwatch?: ColorValue;
  readonly activeEffect?: LightEffectOption;
  readonly topRight?: ReactNode;
  readonly indicators?: ReactNode;
}) {
  const { theme } = useHausUi();
  const mutedCss = resolveColorToCss(colorToken('textMuted'), theme, false);

  const hasBattery =
    battery !== undefined &&
    (typeof battery.level === 'number' ||
      typeof battery.charging === 'boolean' ||
      typeof battery.powerConnected === 'boolean');
  const batteryHoverOnly =
    hasBattery &&
    typeof battery.level === 'number' &&
    battery.level >= 75 &&
    !battery.charging &&
    !battery.powerConnected;
  const resolvedSwatch = isActive
    ? (colorSwatch ?? (activeEffect ? parseCssColor(activeEffect.palette[0]) : undefined))
    : undefined;
  const effectBadge =
    activeEffect && !activeEffect.isStatic
      ? buildEffectBadgeStyle(activeEffect, deviceColor)
      : undefined;
  const showDot = showStatusDot && isActive && (Boolean(effectBadge) || Boolean(resolvedSwatch));
  const hasBuiltIn = Boolean(
    slowPending || favorite || groupCount || hasBattery || showDot || topRight,
  );

  if (!hasBuiltIn && indicators === undefined) return null;

  return (
    <Row
      gapPx={8}
      style={{
        layout: {
          direction: 'row',
          alignItems: 'center',
          gap: px(8),
          padding: { right: px(1) },
        },
      }}
    >
      {slowPending && (
        <Box
          className="tile-pending-indicator"
          ariaLabel="Updating device"
          title="Updating…"
          motion={{
            initial: false,
            animate: { rotate: [0, 360] },
            durationMs: 1000,
            ease: 'linear',
            repeat: 'Infinity',
          }}
        >
          <UiIcon name="loader-circle" size={13} color={mutedCss} />
        </Box>
      )}
      {favorite ? (
        <UiIcon name="heart" size={13} fill="currentColor" color={mutedCss} label="Favorite" />
      ) : null}
      {groupCount !== undefined && groupCount > 0 && (
        <Box
          className="light-group-count"
          ariaLabel={`${groupCount} lights grouped`}
          style={{
            layout: {
              minWidth: px(20),
              height: px(20),
              padding: insets(0, 5),
              alignItems: 'center',
              justifyContent: 'center',
            },
            pointerEvents: 'none',
            border: { width: 1, color: colorToken('materialEdge') },
            corners: corners(7),
            material: new SolidMaterial(mixColor(transparentColor, colorToken('ink'), 0.06)),
          }}
        >
          <Text size={10} weight={600} tone="muted" mono>
            {groupCount}
          </Text>
        </Box>
      )}
      {hasBattery && (
        <Box
          className={`battery-tile-reading ${typeof battery.level === 'number' && battery.level <= 20 ? 'is-low' : ''} ${battery.charging || battery.powerConnected ? 'is-charging' : ''}`}
          ariaLabel={`${typeof battery.level === 'number' ? `Battery ${Math.round(battery.level)}%` : 'Battery'}${battery.charging ? ', charging' : ''}`}
          title={`${typeof battery.level === 'number' ? `Battery ${Math.round(battery.level)}%` : 'Battery status'}${battery.charging ? ' · Charging' : ''}`}
          style={{
            layout: { alignItems: 'center', justifyContent: 'center' },
            opacity: batteryHoverOnly && !hovered ? 0 : 1,
            transitionMs: 180,
          }}
        >
          <BatteryLevelIcon
            level={battery.level}
            charging={battery.charging}
            powerConnected={battery.powerConnected}
            size={10.5}
          />
        </Box>
      )}
      {showStatusDot && effectBadge ? (
        <Box
          className="light-effect-badge"
          title={activeEffect ? `Effect: ${activeEffect.label}` : undefined}
          ariaLabel={activeEffect ? `Effect: ${activeEffect.label}` : undefined}
          motion={
            activeEffect?.motion === 'sparkle'
              ? {
                  initial: false,
                  animate: { scale: [0.97, 1.05, 0.97], opacity: [0.88, 1, 0.88] },
                  times: [0, 0.5, 1],
                  durationMs: 6800,
                  ease: 'easeInOut',
                  repeat: 'Infinity',
                }
              : undefined
          }
          style={{
            layout: {
              width: px(20),
              height: px(20),
              alignItems: 'center',
              justifyContent: 'center',
            },
            corners: corners(999, 'round'),
            material: effectBadge.material,
            border: { width: 1, color: effectBadge.borderColor },
            shadows: effectBadge.shadows,
          }}
        >
          {activeEffect && (
            <UiIcon
              name={activeEffect.icon}
              size={11}
              color={resolveColorToCss(effectBadge.iconColor, theme, false)}
            />
          )}
        </Box>
      ) : showStatusDot && resolvedSwatch ? (
        <Box
          className="light-color-swatch"
          title="Current light color"
          style={{
            layout: { width: px(13), height: px(13) },
            corners: corners(999, 'round'),
            material: new SolidMaterial(resolvedSwatch),
            border: { width: 2, color: colorToken('card') },
            shadows: [
              {
                offsetX: 0,
                offsetY: 0,
                blurRadius: 0,
                spreadRadius: 1,
                color: colorToken('border'),
              },
            ],
          }}
        />
      ) : null}
      {topRight}
      {indicators}
    </Row>
  );
}

export function DesktopTileActions({
  frameId,
  hovered,
  onMore,
  onMorePress,
  moreLabel,
  onRestore,
  restoreLabel,
  actions,
}: {
  readonly frameId?: string;
  readonly hovered: boolean;
  readonly onMore?: () => void;
  readonly onMorePress?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  readonly moreLabel: string;
  readonly onRestore?: () => void;
  readonly restoreLabel: string;
  readonly actions?: ReactNode;
}) {
  const { theme } = useHausUi();
  const mutedCss = resolveColorToCss(colorToken('textMuted'), theme, false);
  const hasMore = Boolean(onMore || onMorePress);
  const hasRestore = Boolean(onRestore);

  return (
    <>
      {hasMore && (
        <Pressable
          id={frameId && `${frameId}-more`}
          className="tile-more"
          ariaLabel={moreLabel}
          stopPropagation
          onPress={
            onMorePress
              ? (event) => {
                  event.stopPropagation();
                  event.nativeEvent.stopImmediatePropagation();
                  onMorePress(event);
                }
              : undefined
          }
          onActivate={onMorePress ? undefined : onMore}
          style={{
            layout: {
              position: 'absolute',
              inset: { bottom: px(hasRestore ? 16 : 10), right: px(hasRestore ? 13 : 9) },
              padding: insets(4),
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2,
            },
            corners: corners(7),
            opacity: hovered || hasRestore ? 1 : 0,
            transitionMs: 160,
            material: new SolidMaterial(transparentColor),
            border: { width: 0, style: 'none', color: transparentColor },
            states: { hover: { material: new SolidMaterial(colorToken('soft')) } },
          }}
        >
          <UiIcon
            name="more-horizontal"
            size={17}
            color={hovered ? resolveColorToCss(colorToken('ink'), theme, false) : mutedCss}
          />
        </Pressable>
      )}
      {onRestore && (
        <Pressable
          id={frameId && `${frameId}-restore`}
          className="tile-restore"
          onActivate={onRestore}
          style={{
            layout: {
              position: 'absolute',
              inset: { left: px(15), bottom: px(12) },
              direction: 'row',
              alignItems: 'center',
              gap: px(6),
              minHeight: px(29),
              padding: insets(0, 9),
              zIndex: 2,
            },
            corners: corners(8),
            border: { width: 1, color: colorToken('border') },
            material: new SolidMaterial(colorToken('card')),
            states: { hover: { material: new SolidMaterial(colorToken('soft')) } },
          }}
        >
          <UiIcon
            name="eye"
            size={14}
            color={resolveColorToCss(colorToken('textPrimary'), theme, false)}
          />
          <Text size={10} weight={600} tone="primary">
            {restoreLabel}
          </Text>
        </Pressable>
      )}
      {actions}
    </>
  );
}
