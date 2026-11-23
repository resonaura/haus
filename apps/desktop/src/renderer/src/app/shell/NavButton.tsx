/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ReactNode } from 'react';
import { Pressable, Text } from '@haus/ui';

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
    <Pressable
      className={`nav-button ${active ? 'active' : ''}`}
      onPress={onClick}
      ariaCurrent={active ? 'page' : undefined}
    >
      {icon}
      <Text>{children}</Text>
    </Pressable>
  );
}
