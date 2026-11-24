/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ReactNode } from 'react';
import { SidebarNavButton } from '@haus/ui/components';

export function NavButton({
  children,
  icon,
  active,
  onClick,
}: {
  children: ReactNode;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <SidebarNavButton icon={icon} active={active} onSelect={onClick}>
      {children}
    </SidebarNavButton>
  );
}
