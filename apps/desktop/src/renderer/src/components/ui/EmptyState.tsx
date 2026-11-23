/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ReactNode } from 'react';
import { Box, Heading, Text } from '@haus/ui';

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Box className="empty-state">
      <Text>{icon}</Text>
      <Heading level={3}>{title}</Heading>
      <Text semantic="p">{description}</Text>
      {action}
    </Box>
  );
}
