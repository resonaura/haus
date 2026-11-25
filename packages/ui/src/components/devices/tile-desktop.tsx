/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type * as React from 'react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { LightEffectOption } from '@haus/core/device';
import type { DeviceCategory } from '../../categories/index.js';
import {
  colorToken,
  corners,
  insets,
  mixColor,
  pct,
  px,
  transparentColor,
  type ColorValue,
} from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { mergeStyleSpecs, type UiStyleSpec } from '../../ir/node.js';
import { useHausUi } from '../../primitives/context.js';
import { Box, Pressable, Row, Text, type BoxProps } from '../../primitives/elements.js';
import { GlassRim } from '../../primitives/glass-rim.js';
import { resolveColorToCss } from '../../renderers/contract.js';
import { DEVICE_ICONS, type UiIconName } from '../icons.js';
import { UiIcon } from '../icon.js';
import { useDelayedPending } from './battery.js';
import type { DeviceTileBatteryData } from './device.js';
import { DesktopTileActions, DesktopTileIndicators } from './tile-accessories.js';
import { DeviceTileIconOrb, DeviceTileStateText, DeviceTileWash } from './tile-effects.js';
import {
  buildTileFrameStyle,
  getDeviceTileTokens,
  parseCssColor,
  resolveDeviceTileColor,
} from './tile-theme.js';

export interface DesktopTileRenderProps {
  readonly name: string;
  readonly category?: DeviceCategory;
  readonly categoryLabel?: string;
  readonly state: string;
  readonly available: boolean;
  readonly favorite?: boolean;
  readonly compact?: boolean;
  readonly desktop?: boolean;
  readonly active?: boolean;
  readonly accent?: ColorValue;
  readonly colorSwatch?: ColorValue;
  readonly lightEffect?: LightEffectOption;
  readonly pending?: boolean;
  readonly pendingSince?: number;
  readonly groupCount?: number;
  readonly battery?: DeviceTileBatteryData;
  readonly sourceBadge?: string;
  readonly showStatusDot?: boolean;
  readonly topRight?: ReactNode;
  readonly frame?: BoxProps;
  readonly subtitle?: ReactNode;
  readonly stateKey?: string;
  readonly icon?: ReactNode;
  readonly iconName?: UiIconName;
  readonly indicators?: ReactNode;
  readonly actions?: ReactNode;
  readonly details?: ReactNode;
  readonly quickLabel?: string;
  readonly quickDisabled?: boolean;
  readonly onQuick?: () => void;
  readonly onOpen?: () => void;
  readonly onMore?: () => void;
  readonly onMorePress?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  readonly moreLabel?: string;
  readonly onRestore?: () => void;
  readonly restoreLabel?: string;
  readonly opened?: boolean;
  readonly selected?: boolean;
}

const desktopStyles = {
  top: {
    layout: {
      direction: 'row',
      alignItems: 'center',
      justifyContent: 'between',
      margin: insets(0, 0, 11, 0),
      zIndex: 1,
      position: 'relative',
    },
  },
  body: {
    layout: {
      direction: 'column',
      width: pct(100),
      alignItems: 'start',
      position: 'relative',
      zIndex: 1,
    },
    material: new SolidMaterial(transparentColor),
    border: { width: 0, style: 'none', color: transparentColor },
  },
  subtitle: {
    typography: { size: 10, color: colorToken('textMuted'), lineHeight: 1.3, maxLines: 1 },
  },
  name: {
    layout: { margin: { top: px(3) } },
    typography: {
      size: 13,
      weight: 600,
      color: colorToken('textPrimary'),
      lineHeight: 1.35,
      maxLines: 1,
      truncate: true,
    },
  },
  state: {
    layout: { margin: { top: px(3) } },
    typography: {
      size: 11,
      color: colorToken('textMuted'),
      lineHeight: 1.25,
      maxLines: 1,
      truncate: true,
    },
  },
} satisfies Record<string, UiStyleSpec>;

export function DesktopDeviceTile(props: DesktopTileRenderProps) {
  const {
    name,
    state,
    available,
    category,
    categoryLabel,
    favorite,
    active,
    accent,
    colorSwatch,
    lightEffect,
    pending = false,
    pendingSince,
    groupCount,
    battery,
    sourceBadge,
    showStatusDot = true,
    topRight,
    frame,
    subtitle = categoryLabel,
    stateKey,
    icon,
    iconName = DEVICE_ICONS[category ?? 'other'],
    indicators,
    actions,
    details,
    quickLabel = `Quick control ${name}`,
    quickDisabled = !available,
    onQuick,
    onOpen,
    onMore,
    onMorePress,
    moreLabel = `Options for ${name}`,
    onRestore,
    restoreLabel = 'Restore to app',
    opened,
    selected,
  } = props;
  const { theme, viewport } = useHausUi();
  const [hovered, setHovered] = useState(false);
  const tokens = getDeviceTileTokens(theme.mode);
  const isActive = active ?? (available && Boolean(accent));
  const activeEffect = isActive ? lightEffect : undefined;
  const fallbackAccent =
    accent ?? (isActive && category === 'lights' ? tokens.catLights : undefined);
  const deviceColor = resolveDeviceTileColor(theme.mode, fallbackAccent, activeEffect);
  const slowPending = useDelayedPending(pending, pendingSince);

  const frameLayout = buildTileFrameStyle({
    mode: theme.mode,
    active: isActive,
    hovered,
    highContrast: viewport.highContrast,
    reducedTransparency: viewport.reducedTransparency,
    deviceColor,
    effect: activeEffect,
    hasRestore: Boolean(onRestore),
  });
  const baseFrameSpec: UiStyleSpec = {
    layout: {
      display: 'flex',
      direction: 'column',
      minHeight: px(frameLayout.minHeightPx),
      padding: insets(13, 14),
      position: 'relative',
      overflow: 'hidden',
    },
    material: frameLayout.material,
    border: frameLayout.border,
    shadows: frameLayout.shadows,
    corners: corners(26),
    transitionMs: 220,
  };
  const frameStyle = mergeStyleSpecs(baseFrameSpec, frame?.style);

  const tile = (
    <Box
      semantic="article"
      {...frame}
      className={frame?.className ?? 'accessory-tile'}
      dataAttrs={{
        'data-haus-device-tile': 'shared',
        ...(pending ? { 'data-pending': true } : {}),
        ...(selected ? { 'data-selected': true } : {}),
        ...(activeEffect && activeEffect.motion !== 'none'
          ? { 'data-light-effect': activeEffect.motion }
          : {}),
        ...frame?.dataAttrs,
      }}
      onPointerEnter={() => {
        setHovered(true);
        frame?.onPointerEnter?.();
      }}
      onPointerLeave={() => {
        setHovered(false);
        frame?.onPointerLeave?.();
      }}
      style={frameStyle}
    >
      {frameLayout.sheenMaterial && (
        <Box
          ariaHidden
          style={{
            layout: { position: 'absolute', inset: insets(0), width: pct(100), height: pct(100) },
            corners: corners(25),
            pointerEvents: 'none',
            material: frameLayout.sheenMaterial,
          }}
        />
      )}
      <DeviceTileWash active={isActive} deviceColor={deviceColor} effect={activeEffect} />
      <Box className="tile-top" style={desktopStyles.top}>
        <DeviceTileIconOrb
          id={frame?.id && `${frame.id}-quick`}
          active={isActive}
          deviceColor={deviceColor}
          effectMotion={activeEffect?.motion}
          ariaLabel={quickLabel}
          disabled={quickDisabled}
          onQuick={onQuick}
          renderIcon={(orbColor) =>
            icon ?? (
              <UiIcon name={iconName} size={19} color={resolveColorToCss(orbColor, theme, false)} />
            )
          }
        />
        <DesktopTileIndicators
          slowPending={slowPending}
          favorite={favorite}
          groupCount={groupCount}
          battery={battery}
          hovered={hovered}
          showStatusDot={showStatusDot}
          isActive={isActive}
          deviceColor={deviceColor}
          colorSwatch={colorSwatch}
          activeEffect={activeEffect}
          topRight={topRight}
          indicators={indicators}
        />
      </Box>
      <TileBodyAction
        id={frame?.id && `${frame.id}-details`}
        selected={selected}
        opened={opened}
        onOpen={onOpen}
        style={{ ...desktopStyles.body, opacity: available ? 1 : 0.65 }}
      >
        {(Boolean(subtitle) || Boolean(sourceBadge)) && (
          <Row gapPx={5} align="center" style={{ layout: { maxWidth: pct(100) } }}>
            {subtitle && (
              <Text semantic="small" style={desktopStyles.subtitle}>
                {subtitle}
              </Text>
            )}
            {sourceBadge && (
              <Box
                style={{
                  layout: { padding: insets(2, 6), alignItems: 'center', justifyContent: 'center' },
                  pointerEvents: 'none',
                  corners: corners(10),
                  material: new SolidMaterial(mixColor(transparentColor, colorToken('ink'), 0.07)),
                  border: {
                    width: 1,
                    color: mixColor(transparentColor, colorToken('ink'), 0.1),
                  },
                }}
              >
                <Text
                  size={8.5}
                  weight={600}
                  tone="muted"
                  style={{ typography: { lineHeight: 1.1 } }}
                >
                  {sourceBadge}
                </Text>
              </Box>
            )}
          </Row>
        )}
        <Text semantic="strong" style={desktopStyles.name}>
          {name}
        </Text>
        <DeviceTileStateText state={state} stateKey={stateKey} style={desktopStyles.state} />
      </TileBodyAction>
      <DesktopTileActions
        frameId={frame?.id}
        hovered={hovered}
        onMore={onMore}
        onMorePress={onMorePress}
        moreLabel={moreLabel}
        onRestore={onRestore}
        restoreLabel={restoreLabel}
        actions={actions}
      />
      <GlassRim
        preset="card"
        variant="card"
        opacity={isActive ? (activeEffect ? 0.82 : hovered ? 0.86 : 0.76) : hovered ? 0.74 : 0.56}
        tintColor={isActive && !activeEffect ? deviceColor : undefined}
        effectColors={
          activeEffect
            ? [
                parseCssColor(activeEffect.palette[0]) ?? deviceColor,
                parseCssColor(activeEffect.palette[1]),
                parseCssColor(activeEffect.palette[2]),
              ]
            : undefined
        }
        effectMotion={activeEffect?.motion}
      />
    </Box>
  );

  if (details == null) return tile;
  return (
    <Box>
      {tile}
      {opened && <Box style={{ layout: { padding: insets(0, 12, 8, 12) } }}>{details}</Box>}
    </Box>
  );
}

function TileBodyAction({
  id,
  selected,
  opened,
  onOpen,
  style,
  children,
}: {
  readonly id?: string;
  readonly selected?: boolean;
  readonly opened?: boolean;
  readonly onOpen?: () => void;
  readonly style: UiStyleSpec;
  readonly children: ReactNode;
}) {
  if (onOpen) {
    return (
      <Pressable
        id={id}
        className="tile-body"
        ariaPressed={selected}
        ariaExpanded={opened}
        onActivate={onOpen}
        style={style}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <Box className="tile-body" style={style}>
      {children}
    </Box>
  );
}
