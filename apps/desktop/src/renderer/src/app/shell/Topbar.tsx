/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, Pressable, Text } from '@haus/ui';
import { House, ChevronRight, Menu, Search, Command, Bell } from 'lucide-react';
import type { Route } from '../navigation';
type Props = {
  route: Route;
  heading: string;
  homeName: string;
  mode: 'live' | 'demo';
  notificationCount: number;
  attentionCount: number;
  userName?: string;
  onOpenNavigation: () => void;
  onSearch: () => void;
  go: (route: Route) => void;
};
export function Topbar({
  route,
  heading,
  homeName,
  mode,
  notificationCount,
  attentionCount,
  userName,
  onOpenNavigation,
  onSearch,
  go,
}: Props) {
  return (
    <Box semantic="header" className="topbar">
      <Box className="breadcrumb">
        <Pressable
          className="mobile-menu icon-button"
          ariaLabel="Open navigation"
          onPress={() => onOpenNavigation()}
        >
          <Menu size={20} />
        </Pressable>
        <House size={15} />
        <Text>{homeName}</Text>
        <ChevronRight size={13} />
        <Text semantic="strong">{route.kind === 'home' ? 'Overview' : heading}</Text>
      </Box>
      <Box className="topbar-actions">
        {mode === 'demo' && <Text className="demo-badge">DEMO HOME</Text>}
        <Pressable className="icon-button" ariaLabel="Search devices" onPress={onSearch}>
          <Search size={19} />
          <Text className="shortcut">
            <Command size={10} /> K
          </Text>
        </Pressable>
        <Pressable
          className="icon-button notification-button"
          ariaLabel={`Notifications${notificationCount ? `, ${notificationCount}` : ''}`}
          onPress={() => go({ kind: 'attention' })}
        >
          <Bell size={19} />
          {(notificationCount > 0 || attentionCount > 0) && <Text semantic="swatch" />}
        </Pressable>
        <Text className="topbar-divider" />
        <Pressable
          className="profile-button"
          ariaLabel="Home settings"
          onPress={() => go({ kind: 'settings' })}
        >
          {userName?.slice(0, 1) ?? 'H'}
        </Pressable>
      </Box>
    </Box>
  );
}
