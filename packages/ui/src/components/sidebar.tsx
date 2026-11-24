/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import { colorToken, corners, insets, pct, px } from '../ir/geometry.js';
import { SolidMaterial } from '../ir/materials.js';
import type { UiStyleSpec } from '../ir/node.js';
import { Box, Pressable, Row, Stack, Text } from '../primitives/elements.js';
import { UiIcon } from './icon.js';
import type { UiIconName } from './icons.js';
import { SidebarNavButton } from './chrome.js';

export interface SidebarItem<Route extends string> {
  readonly id: Route;
  readonly label: string;
  readonly icon: UiIconName;
  readonly badge?: string | number;
}

export interface SidebarGroup<Route extends string> {
  readonly title?: string;
  readonly count?: number;
  readonly items: readonly SidebarItem<Route>[];
}

export const sidebarWidths = { compact: 56, expanded: 232 };

const navigationStyle: UiStyleSpec = {
  layout: { width: pct(100), minHeight: px(36), padding: insets(7, 10) },
  corners: corners(8),
  states: {
    hover: { material: new SolidMaterial(colorToken('surfaceHover')) },
    selected: { material: new SolidMaterial(colorToken('surfaceActive')) },
  },
};

export function SidebarLayout<Route extends string>({
  items,
  groups,
  footer,
  expandedWidth = sidebarWidths.expanded,
  selected,
  onSelect,
  collapsed,
  onToggle,
  backedByWindow = false,
  children,
}: {
  readonly items?: readonly SidebarItem<Route>[];
  readonly groups?: readonly SidebarGroup<Route>[];
  readonly footer?: SidebarItem<Route>;
  readonly expandedWidth?: number;
  readonly selected: Route;
  readonly onSelect: (route: Route) => void;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly backedByWindow?: boolean;
  readonly children: ReactNode;
}) {
  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  const renderItem = (item: SidebarItem<Route>) => (
    <SidebarNavButton
      key={item.id}
      id={`sidebar-${item.id}`}
      label={item.label}
      icon={<UiIcon name={item.icon} size={18} />}
      active={selected === item.id}
      onSelect={() => onSelect(item.id)}
      collapsed={collapsed}
      badge={item.badge}
      portable
    />
  );
  return (
    <Row gapPx={0} align="stretch" style={{ layout: { width: pct(100), height: pct(100) } }}>
      <Stack
        id="sidebar"
        semantic="nav"
        role="navigation"
        ariaLabel="Haus"
        gapPx={0}
        style={{
          layout: {
            width: px(collapsed ? sidebarWidths.compact : expandedWidth),
            flexShrink: 0,
            padding: insets(0, collapsed ? 6 : 14),
          },
          material: backedByWindow ? undefined : new SolidMaterial(colorToken('surfaceSecondary')),
        }}
      >
        <Pressable
          id="sidebar-toggle"
          title={toggleLabel}
          ariaLabel={toggleLabel}
          ariaExpanded={!collapsed}
          onActivate={onToggle}
          style={{
            ...navigationStyle,
            layout: {
              ...navigationStyle.layout,
              height: px(45),
              flexShrink: 0,
              alignItems: 'end',
              justifyContent: 'center',
            },
          }}
        >
          <Row gapPx={10}>
            <UiIcon name={collapsed ? 'panel-left-open' : 'panel-left-close'} size={18} />
          </Row>
        </Pressable>
        <Stack
          gapPx={14}
          style={{
            layout: {
              flexGrow: 1,
              minHeight: px(0),
              overflowY: 'scroll',
              padding: insets(0, 0, 12, 0),
            },
          }}
        >
          {(groups ?? [{ items: items ?? [] }]).map((group) => (
            <Stack key={group.title ?? group.items[0]?.id} gapPx={3}>
              {group.title && !collapsed && (
                <Text
                  tone="muted"
                  size={9}
                  weight={600}
                  style={{
                    layout: { padding: insets(12, 11, 7, 11) },
                    typography: { letterSpacing: 0.11, lineHeight: 1.5 },
                  }}
                >
                  {group.count !== undefined ? `${group.title} ${group.count}` : group.title}
                </Text>
              )}
              {group.items.map(renderItem)}
            </Stack>
          ))}
        </Stack>
        {footer && (
          <>
            <Box
              style={{
                layout: { height: px(1), flexShrink: 0 },
                material: new SolidMaterial(colorToken('borderSubtle')),
              }}
            />
            <Box style={{ layout: { padding: insets(10, 0, 10, 0), flexShrink: 0 } }}>
              {renderItem(footer)}
            </Box>
          </>
        )}
      </Stack>
      <Box
        semantic="main"
        style={{
          layout: { flexGrow: 1, width: px(0), minWidth: px(0) },
          material: new SolidMaterial(colorToken('canvas')),
        }}
      >
        {children}
      </Box>
    </Row>
  );
}
