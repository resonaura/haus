/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ReactNode } from 'react';
import { Box, Heading, Pressable, Text } from '@haus/ui';
import { ChevronRight } from 'lucide-react';

export function Section({
  className,
  title,
  subtitle,
  action,
  onAction,
  children,
}: {
  className?: string;
  title: string;
  subtitle: string;
  action: string;
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <Box semantic="section" className={`home-section ${className ?? ''}`}>
      <Box className="section-heading">
        <Box>
          <Heading level={2}>{title}</Heading>
          <Text semantic="p">{subtitle}</Text>
        </Box>
        <Pressable onPress={onAction}>
          {action}
          <ChevronRight size={15} />
        </Pressable>
      </Box>
      {children}
    </Box>
  );
}
