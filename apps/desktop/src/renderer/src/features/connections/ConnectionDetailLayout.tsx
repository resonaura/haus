/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Box, HausButton, Heading, Text } from '@haus/ui';
import { ArrowLeft } from 'lucide-react';

/** Management stays in the workspace; only focused setup and confirmation use dialogs. */
export function ConnectionDetailLayout({
  title,
  icon,
  subtitle,
  children,
  actions,
  onBack,
  className = '',
}: {
  title: string;
  icon: ReactNode;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  onBack: () => void;
  className?: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.closest('.main-scroll')?.scrollTo({ top: 0, behavior: 'instant' });
    heading.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <Box
      semantic="section"
      className={`connection-detail-page${className ? ` ${className}` : ''}`}
      ariaLabel={title}
    >
      <HausButton variant="ghost" className="connection-back" onPress={onBack}>
        <ArrowLeft size={17} />
        Back
      </HausButton>
      <Box semantic="header" className="connection-page-heading">
        <Text className="integration-logo">{icon}</Text>
        <Box>
          <Heading level={2} headingRef={heading} tabIndex={-1}>
            {title}
          </Heading>
          {subtitle && <Text semantic="p">{subtitle}</Text>}
        </Box>
        {actions && <Box className="connection-page-actions">{actions}</Box>}
      </Box>
      <Box className="connection-page-content">{children}</Box>
    </Box>
  );
}
