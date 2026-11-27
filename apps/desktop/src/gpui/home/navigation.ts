/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  resolveRoomIconName,
  type ServerDetailTabId,
  type ServerSummaryRecord,
} from '@haus/core/transport';
import {
  DEVICE_ICONS,
  resolveServerGlyphName,
  UI_ICONS,
  type SidebarContextualItem,
  type SidebarContextualNav,
  type SidebarGroup,
  type SidebarItem,
  type UiIconName,
} from '@haus/ui/components';
import type { HomeRoute } from '../shell.js';
import type { homeDashboard } from './model.js';

function isUiIconName(value: string): value is UiIconName {
  return Object.hasOwn(UI_ICONS, value);
}

export function roomIcon(name: string, customIconId?: string): UiIconName {
  const resolved = resolveRoomIconName(name, customIconId);
  return isUiIconName(resolved) ? resolved : 'house';
}

export const WORKSPACE_ROUTE_LABELS: Readonly<Record<string, string>> = {
  home: 'Welcome home.',
  cameras: 'Cameras',
  scenes: 'Scenes',
  favorites: 'Favorites',
  automations: 'Automations',
  settings: 'Settings',
  attention: 'Attention',
  rooms: 'Rooms',
  devices: 'Devices',
  integrations: 'Integrations',
  addons: 'Apps',
  servers: 'Servers',
  hidden: 'Hidden',
  statistics: 'Statistics',
};

export const settingsLink: SidebarItem<HomeRoute> = {
  id: 'settings',
  label: 'Settings',
  icon: 'settings-2',
};

export function navigation(
  home: ReturnType<typeof homeDashboard>,
  roomIcons?: Readonly<Record<string, string>>,
): SidebarGroup<HomeRoute>[] {
  return [
    {
      items: [
        { id: 'home', label: 'Home', icon: 'house' },
        { id: 'scenes', label: 'Scenes', icon: 'sparkles' },
        { id: 'favorites', label: 'Favorites', icon: 'heart' },
        { id: 'automations', label: 'Automations', icon: 'zap' },
      ],
    },
    {
      title: 'YOUR HOME',
      items: [
        ...home.categories.map((category) => ({
          id: `category:${category.id}` as const,
          label: category.name,
          icon: DEVICE_ICONS[category.id],
        })),
        { id: 'servers', label: 'Servers', icon: 'server' },
      ],
    },
    {
      title: 'ROOMS',
      count: home.navigationRooms.length,
      items: home.navigationRooms.map((room) => ({
        id: `room:${room.id}`,
        label: room.name,
        icon: roomIcon(room.name, roomIcons?.[room.id]),
      })),
    },
    {
      title: 'MANAGE HOME',
      items: [
        { id: 'rooms', label: 'Rooms', icon: 'house' },
        { id: 'devices', label: 'Devices', icon: 'layout-grid', badge: home.registeredDeviceCount },
        { id: 'integrations', label: 'Integrations', icon: 'cable' },
        { id: 'addons', label: 'Apps', icon: 'box' },
        { id: 'statistics', label: 'Statistics', icon: 'activity' },
        { id: 'hidden', label: 'Hidden', icon: 'archive', badge: home.hiddenCount },
      ],
    },
  ];
}

export function buildServerSidebarNav({
  name,
  kind,
  managed,
  hasNvr,
  canManage = true,
  status,
  activeTab,
  onSelectTab,
  onBack,
}: {
  readonly name: string;
  readonly kind: ServerSummaryRecord['kind'];
  readonly managed: boolean;
  readonly hasNvr: boolean;
  readonly canManage?: boolean;
  readonly status?: 'online' | 'offline' | 'paused' | 'unknown';
  readonly activeTab: ServerDetailTabId;
  readonly onSelectTab: (tab: ServerDetailTabId) => void;
  readonly onBack: () => void;
}): SidebarContextualNav {
  const isHubServer = kind === 'hub' || kind === 'nvr' || managed;
  const items: readonly SidebarContextualItem[] = [
    { id: 'overview', testId: 'server-tab-overview', label: 'Overview', icon: 'gauge' },
    { id: 'storage', testId: 'server-tab-storage', label: 'Disks', icon: 'hard-drive' },
    { id: 'services', testId: 'server-tab-services', label: 'Services', icon: 'boxes' },
    { id: 'terminal', testId: 'server-tab-terminal', label: 'Terminal', icon: 'terminal-square' },
    ...(isHubServer
      ? ([{ id: 'logs', testId: 'server-tab-logs', label: 'Logs', icon: 'scroll-text' }] as const)
      : []),
    ...(hasNvr
      ? ([{ id: 'nvr', testId: 'server-tab-nvr', label: 'NVR', icon: 'video' }] as const)
      : []),
    ...(canManage
      ? ([
          { id: 'settings', testId: 'server-tab-settings', label: 'Settings', icon: 'settings-2' },
        ] as const)
      : []),
  ];
  return {
    backId: 'server-detail-back',
    backLabel: 'Servers',
    eyebrow: 'HOME SERVER',
    title: name,
    iconName: resolveServerGlyphName({ kind, nvr: hasNvr ? { hasNvr: true } : undefined }),
    status,
    activeId: activeTab,
    items,
    onSelect: (id) => onSelectTab(id as ServerDetailTabId),
    onBack,
  };
}
