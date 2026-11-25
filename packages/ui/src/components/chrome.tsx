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
import { GradientMaterial, SolidMaterial } from '../ir/materials.js';
import type { UiStyleSpec } from '../ir/node.js';
import { Box, Pressable, Text } from '../primitives/elements.js';
import { GlassRim } from '../primitives/glass-rim.js';
import { UiIcon } from './icon.js';

const row = {
  display: 'flex',
  direction: 'row',
  alignItems: 'center',
} as const;

const iconButton: UiStyleSpec = {
  layout: { ...row, gap: px(5), height: px(30), minWidth: px(32), justifyContent: 'center' },
  corners: corners(9),
  states: { hover: { material: new SolidMaterial(colorToken('surfaceHover')) } },
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
  showMenu = true,
}: {
  readonly homeName: string;
  readonly heading: string;
  readonly demo?: boolean;
  readonly userName?: string;
  readonly notificationCount?: number;
  readonly hasAttention?: boolean;
  readonly onOpenNavigation: () => void;
  readonly onSearch: () => void;
  readonly onNotifications: () => void;
  readonly onSettings: () => void;
  readonly inset?: number;
  readonly showMenu?: boolean;
}) {
  const portable = inset !== undefined;
  return (
    <Box
      semantic="header"
      className="topbar"
      style={
        portable
          ? {
              layout: {
                ...row,
                height: px(61),
                flexShrink: 0,
                padding: insets(0, inset),
                justifyContent: 'between',
              },
            }
          : undefined
      }
    >
      <Box
        className="breadcrumb"
        style={portable ? { layout: { ...row, gap: px(11) } } : undefined}
      >
        {showMenu && (
          <Pressable
            className="mobile-menu icon-button"
            id="topbar-navigation"
            ariaLabel="Open navigation"
            style={portable ? iconButton : undefined}
            onActivate={onOpenNavigation}
          >
            <UiIcon name="menu" size={20} />
          </Pressable>
        )}
        <UiIcon name="house" size={15} />
        <Text tone={portable ? 'muted' : undefined} size={portable ? 11 : undefined}>
          {homeName}
        </Text>
        <UiIcon name="chevron-right" size={13} />
        <Text semantic="strong" size={portable ? 11 : undefined}>
          {heading}
        </Text>
      </Box>
      <Box
        className="topbar-actions"
        style={portable ? { layout: { ...row, gap: px(12), flexShrink: 0 } } : undefined}
      >
        {demo && (
          <Text
            className="demo-badge"
            style={
              portable
                ? {
                    layout: { padding: insets(5, 8) },
                    border: { width: 1, color: colorToken('borderSubtle') },
                    corners: corners(18),
                    typography: { size: 8, color: colorToken('textMuted') },
                  }
                : undefined
            }
          >
            DEMO HOME
          </Text>
        )}
        <Pressable
          className="icon-button"
          id="home-search"
          ariaLabel="Search devices"
          style={portable ? iconButton : undefined}
          onActivate={onSearch}
        >
          <UiIcon name="search" size={19} />
          {portable ? (
            <Box
              style={{
                layout: { ...row, gap: px(2), padding: insets(2, 3) },
                corners: corners(3),
                material: new SolidMaterial(colorToken('soft')),
                pointerEvents: 'none',
              }}
            >
              <UiIcon name="command" size={9} />
              <Text tone="muted" size={9}>
                K
              </Text>
            </Box>
          ) : (
            <Text className="shortcut">
              <UiIcon name="command" size={10} /> K
            </Text>
          )}
        </Pressable>
        <Pressable
          className="icon-button notification-button"
          id="home-attention"
          ariaLabel={`Notifications${notificationCount ? `, ${notificationCount}` : ''}`}
          style={portable ? iconButton : undefined}
          onActivate={onNotifications}
        >
          <UiIcon name="bell" size={19} />
          {(notificationCount > 0 || hasAttention) && (
            <Text
              semantic="swatch"
              style={
                portable
                  ? {
                      layout: {
                        width: px(4),
                        height: px(4),
                        position: 'absolute',
                        inset: insets(5, 5, 0, 0),
                      },
                      corners: corners(3),
                      material: new SolidMaterial(colorToken('warning')),
                      pointerEvents: 'none',
                    }
                  : undefined
              }
            />
          )}
        </Pressable>
        <Text className="topbar-divider" />
        <Pressable
          className="profile-button"
          id="home-settings"
          ariaLabel="Home settings"
          style={
            portable
              ? {
                  ...iconButton,
                  corners: corners(15),
                  layout: { ...row, width: px(30), height: px(30), justifyContent: 'center' },
                  border: { width: 1, color: colorToken('borderSubtle') },
                  material: new SolidMaterial(colorToken('soft')),
                }
              : undefined
          }
          onActivate={onSettings}
        >
          {userName?.slice(0, 1) ?? 'H'}
        </Pressable>
      </Box>
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
  collapsed,
  badge,
  children,
}: {
  readonly id?: string;
  readonly label?: string;
  readonly icon: ReactNode;
  readonly active: boolean;
  readonly onSelect: () => void;
  readonly portable?: boolean;
  readonly collapsed?: boolean;
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
      {!collapsed && (
        <>
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
        </>
      )}
      {portable && active && <GlassRim preset="control" radiusPx={13} opacity={0.7} />}
    </Pressable>
  );
}
