/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  SidebarLayout,
  sidebarWidths,
  type SidebarContextualNav,
  type SidebarGroup,
  type SidebarItem,
} from '@haus/ui/components';
import type { SidebarBackdrop } from '../platform/sidebar.js';

export type HomeRoute =
  | 'home'
  | 'cameras'
  | 'scenes'
  | 'favorites'
  | 'automations'
  | 'rooms'
  | 'devices'
  | 'integrations'
  | 'addons'
  | 'servers'
  | 'hidden'
  | 'settings'
  | 'attention'
  | 'statistics'
  | `room:${string}`
  | `category:${string}`;
const items: readonly SidebarItem<HomeRoute>[] = [
  { id: 'home', label: 'Home', icon: 'house' },
  { id: 'cameras', label: 'Cameras', icon: 'clapperboard' },
];
const subscribeFallback = () => () => {};
const opaque = () => false;

export function DesktopShell({
  sidebar,
  route,
  onSelect,
  dark = true,
  groups,
  footer,
  contextual,
  expandedWidth = sidebarWidths.expanded,
  children,
}: {
  sidebar?: SidebarBackdrop;
  route: HomeRoute;
  onSelect: (route: HomeRoute) => void;
  dark?: boolean;
  groups?: readonly SidebarGroup<HomeRoute>[];
  footer?: SidebarItem<HomeRoute>;
  contextual?: SidebarContextualNav;
  expandedWidth?: number;
  children: ReactNode | ((toggleSidebar: () => void, collapsed: boolean) => ReactNode);
}) {
  const [collapsed, setCollapsed] = useState(false);
  const toggle = () => setCollapsed((previous) => !previous);
  const backedByWindow = useSyncExternalStore(
    sidebar?.subscribe ?? subscribeFallback,
    sidebar?.getSnapshot ?? opaque,
  );

  useLayoutEffect(() => () => sidebar?.dispose(), [sidebar]);
  useLayoutEffect(() => {
    sidebar?.update(collapsed ? sidebarWidths.compact : expandedWidth, dark);
  }, [sidebar, collapsed, dark, expandedWidth]);

  return (
    <SidebarLayout
      items={items}
      groups={groups}
      footer={footer}
      contextual={contextual}
      expandedWidth={expandedWidth}
      selected={route}
      onSelect={onSelect}
      collapsed={collapsed}
      onToggle={toggle}
      backedByWindow={backedByWindow}
    >
      {typeof children === 'function' ? children(toggle, collapsed) : children}
    </SidebarLayout>
  );
}
