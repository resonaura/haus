/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

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
} from '../ir/geometry.js';
import { BackdropMaterial, GradientMaterial, SolidMaterial } from '../ir/materials.js';
import type { UiStyleSpec } from '../ir/node.js';
import { useHausUi } from '../primitives/context.js';
import { Box, Pressable, Text } from '../primitives/elements.js';
import { GlassRim } from '../primitives/glass-rim.js';
import { resolveColorToCss } from '../renderers/contract.js';
import { UiIcon } from './icon.js';

const row = {
  display: 'flex',
  direction: 'row',
  alignItems: 'center',
} as const;

const iconButton: UiStyleSpec = {
  layout: {
    ...row,
    gap: px(6),
    padding: insets(6),
    minWidth: px(31),
    minHeight: px(31),
    justifyContent: 'center',
    position: 'relative',
    flexShrink: 0,
  },
  corners: corners(9),
  states: {
    hover: {
      material: new SolidMaterial(colorToken('surfaceHover')),
      textColor: colorToken('textPrimary'),
    },
  },
};

export function DesktopTopbar({
  homeName,
  heading,
  demo,
  userName,
  notificationCount = 0,
  hasAttention,
  onOpenNavigation,
  onSearch,
  onNotifications,
  onSettings,
  inset,
  showMenu,
}: {
  readonly homeName: string;
  readonly heading: string;
  readonly demo?: boolean;
  readonly userName?: string;
  readonly notificationCount?: number;
  readonly hasAttention?: boolean;
  readonly onOpenNavigation?: () => void;
  readonly onSearch: () => void;
  readonly onNotifications: () => void;
  readonly onSettings: () => void;
  readonly inset?: number;
  readonly showMenu?: boolean;
}) {
  const { theme, viewport } = useHausUi();
  const compact = viewport.width <= 760;
  const padX = inset ?? (compact ? 19 : viewport.width <= 1180 ? 25 : 32);
  const barHeight = compact ? 57 : 61;
  const menuVisible = Boolean(onOpenNavigation && (showMenu ?? compact));
  const mutedInk = resolveColorToCss(colorToken('textMuted'), theme, false);

  return (
    <Box
      semantic="header"
      className="topbar"
      dataAttrs={{ 'data-haus-topbar': 'shared' }}
      style={{
        layout: {
          ...row,
          minHeight: px(barHeight),
          flexShrink: 0,
          padding: { left: px(padX), right: px(padX) },
          justifyContent: 'between',
          position: 'relative',
          zIndex: 20,
        },
        material: new BackdropMaterial(
          {
            blurRadius: 24,
            saturation: 1.25,
            tintColor: colorToken('canvas', 0.78),
            tintOpacity: 0.78,
          },
          { fallbackColor: colorToken('card') },
        ),
      }}
    >
      <Box
        className="breadcrumb"
        style={{ layout: { ...row, gap: px(compact ? 7 : 11), minWidth: px(0) } }}
      >
        {menuVisible && (
          <Pressable
            className="mobile-menu icon-button"
            id="topbar-navigation"
            ariaLabel="Open navigation"
            style={iconButton}
            onActivate={onOpenNavigation}
          >
            <UiIcon name="menu" size={20} color={mutedInk} />
          </Pressable>
        )}
        <UiIcon name="house" size={15} color={mutedInk} />
        {!compact && (
          <>
            <Text
              tone="muted"
              size={11}
              style={{ typography: { maxLines: 1, whiteSpace: 'nowrap' } }}
            >
              {homeName}
            </Text>
            <UiIcon name="chevron-right" size={13} color={mutedInk} />
          </>
        )}
        <Text
          semantic="strong"
          tone="primary"
          size={11}
          weight={600}
          style={{ typography: { maxLines: 1, whiteSpace: 'nowrap' } }}
        >
          {heading}
        </Text>
      </Box>
      <Box
        className="topbar-actions"
        style={{ layout: { ...row, gap: px(compact ? 10 : 15), flexShrink: 0 } }}
      >
        {demo && !compact && (
          <Text
            className="demo-badge"
            tone="muted"
            size={8}
            weight={600}
            style={{
              layout: { padding: insets(5, 9), flexShrink: 0 },
              border: { width: 1, color: colorToken('border') },
              corners: corners(999, 'round'),
              typography: { letterSpacing: 0.12, lineHeight: 1.1, whiteSpace: 'nowrap' },
            }}
          >
            DEMO HOME
          </Text>
        )}
        <Pressable
          className="icon-button"
          id="home-search"
          ariaLabel="Search devices"
          style={iconButton}
          onActivate={onSearch}
        >
          <UiIcon name="search" size={19} color={mutedInk} />
          {!compact && (
            <Box
              className="shortcut"
              style={{
                layout: { ...row, gap: px(2), padding: insets(3, 5) },
                corners: corners(4),
                material: new SolidMaterial(colorToken('soft')),
                pointerEvents: 'none',
              }}
            >
              <UiIcon name="command" size={9.5} color={mutedInk} />
              <Text tone="muted" size={9} style={{ typography: { lineHeight: 1 } }}>
                K
              </Text>
            </Box>
          )}
        </Pressable>
        <Pressable
          className="icon-button notification-button"
          id="home-attention"
          ariaLabel={`Notifications${notificationCount ? `, ${notificationCount}` : ''}`}
          style={iconButton}
          onActivate={onNotifications}
        >
          <UiIcon name="bell" size={19} color={mutedInk} />
          {(notificationCount > 0 || hasAttention) && (
            <Box
              ariaHidden
              style={{
                layout: {
                  width: px(6),
                  height: px(6),
                  position: 'absolute',
                  inset: { top: px(5), right: px(6) },
                },
                corners: corners(999, 'round'),
                border: { width: 1, color: colorToken('canvas') },
                material: new SolidMaterial(colorToken('warning')),
                pointerEvents: 'none',
              }}
            />
          )}
        </Pressable>
        <Box
          className="topbar-divider"
          ariaHidden
          style={{
            layout: { width: px(1), height: px(20), flexShrink: 0 },
            material: new SolidMaterial(colorToken('border')),
          }}
        />
        <Pressable
          className="profile-button"
          id="home-settings"
          ariaLabel="Home settings"
          dataAttrs={{ 'data-haus-topbar-profile': 'shared' }}
          style={{
            layout: {
              ...row,
              width: px(29),
              height: px(29),
              justifyContent: 'center',
              position: 'relative',
              overflow: 'hidden',
              flexShrink: 0,
            },
            corners: corners(999, 'round'),
            border: { width: 1, color: colorToken('materialEdge') },
            material: viewport.reducedTransparency
              ? new SolidMaterial(colorToken('card'))
              : new GradientMaterial(
                  [
                    { offset: 0, color: colorToken('materialTop') },
                    { offset: 1, color: colorToken('materialBottom') },
                  ],
                  155,
                  'linear',
                ),
            shadows: [
              { offsetX: 0, offsetY: 2, blurRadius: 6, color: colorToken('materialShadow') },
            ],
            states: {
              hover: {
                border: { width: 1, color: colorToken('border') },
              },
            },
          }}
          onActivate={onSettings}
        >
          <Text tone="primary" size={12.5} weight={600} style={{ typography: { lineHeight: 1 } }}>
            {userName?.slice(0, 1) ?? 'H'}
          </Text>
          <GlassRim preset="circle" radiusPx={13.5} opacity={0.74} />
        </Pressable>
      </Box>
      <Box
        ariaHidden
        style={{
          layout: {
            position: 'absolute',
            inset: { right: px(0), bottom: px(0), left: px(0) },
            height: px(1),
          },
          material: new SolidMaterial(mixColor(transparentColor, colorToken('border'), 0.7)),
          pointerEvents: 'none',
        }}
      />
    </Box>
  );
}

export function SidebarNavButton({
  id,
  label,
  icon,
  active,
  onSelect,
  portable = false,
  badge,
  children,
}: {
  readonly id?: string;
  readonly label?: string;
  readonly icon: ReactNode;
  readonly active: boolean;
  readonly onSelect: () => void;
  readonly portable?: boolean;
  readonly badge?: string | number;
  readonly children?: ReactNode;
}) {
  return (
    <Pressable
      id={id}
      className={`nav-button ${active ? 'active' : ''}`}
      ariaLabel={label}
      ariaCurrent={active ? 'page' : undefined}
      ariaPressed={portable ? active : undefined}
      selected={active}
      onActivate={onSelect}
      style={
        portable
          ? {
              layout: {
                ...row,
                gap: px(11),
                width: pct(100),
                minHeight: px(35),
                padding: insets(7, 11),
                position: 'relative',
                overflow: 'hidden',
              },
              corners: corners(14),
              material: active
                ? new GradientMaterial(
                    [
                      { offset: 0, color: mixColor(transparentColor, colorToken('ink'), 0.15) },
                      { offset: 1, color: mixColor(transparentColor, colorToken('ink'), 0.07) },
                    ],
                    165,
                    'linear',
                  )
                : undefined,
              border: {
                width: 1,
                color: active ? colorToken('materialEdge') : transparentColor,
              },
              shadows: active
                ? [{ offsetX: 0, offsetY: 1, blurRadius: 3, color: rgba(0, 0, 0, 0.08) }]
                : undefined,
              states: active
                ? undefined
                : {
                    hover: {
                      material: new SolidMaterial(
                        mixColor(transparentColor, colorToken('ink'), 0.045),
                      ),
                    },
                  },
            }
          : undefined
      }
    >
      {icon}
      <Text
        size={portable ? 12 : undefined}
        weight={portable ? (active ? 600 : 500) : undefined}
        tone={portable ? (active ? 'primary' : 'muted') : undefined}
        style={
          portable && badge !== undefined
            ? { layout: { flexGrow: 1, minWidth: px(0) }, typography: { maxLines: 1 } }
            : portable
              ? { typography: { maxLines: 1 } }
              : undefined
        }
      >
        {children ?? label}
      </Text>
      {portable && badge !== undefined && (
        <Box
          style={{
            layout: {
              ...row,
              justifyContent: 'center',
              minWidth: px(22),
              padding: insets(2, 7),
              flexShrink: 0,
            },
            material: new SolidMaterial(mixColor(transparentColor, colorToken('ink'), 0.08)),
            corners: corners(999, 'round'),
          }}
        >
          <Text
            size={9.5}
            weight={500}
            tone="muted"
            style={{ typography: { tabularNums: true, lineHeight: 1.2 } }}
          >
            {String(badge)}
          </Text>
        </Box>
      )}
      {portable && active && <GlassRim preset="control" radiusPx={13} opacity={0.7} />}
    </Pressable>
  );
}
