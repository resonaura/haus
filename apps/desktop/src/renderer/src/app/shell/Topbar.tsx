/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { DesktopTopbar } from '@haus/ui/components';
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
    <DesktopTopbar
      homeName={homeName}
      heading={route.kind === 'home' ? 'Overview' : heading}
      demo={mode === 'demo'}
      userName={userName}
      notificationCount={notificationCount}
      hasAttention={attentionCount > 0}
      onOpenNavigation={onOpenNavigation}
      onSearch={onSearch}
      onNotifications={() => go({ kind: 'attention' })}
      onSettings={() => go({ kind: 'settings' })}
    />
  );
}
