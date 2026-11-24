/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ReactNode } from 'react';
import { Box, Heading, Pressable, Text } from '../primitives/index.js';
import { colorToken, insets, px } from '../ir/geometry.js';
import { UiIcon } from './icon.js';

export function Section({
  className,
  title,
  subtitle,
  action,
  onAction,
  portable = false,
  children,
}: {
  className?: string;
  title: string;
  subtitle: string;
  action: string;
  onAction: () => void;
  portable?: boolean;
  children: ReactNode;
}) {
  return (
    <Box
      semantic="section"
      className={`home-section ${className ?? ''}`}
      style={
        portable
          ? {
              layout: { gap: px(11), margin: insets(0, 0, 25, 0) },
            }
          : undefined
      }
    >
      <Box
        className="section-heading"
        style={
          portable
            ? {
                layout: {
                  direction: 'row',
                  alignItems: 'center',
                  justifyContent: 'between',
                  minHeight: px(47),
                },
              }
            : undefined
        }
      >
        <Box>
          <Heading level={2} size={portable ? 20 : undefined}>
            {title}
          </Heading>
          <Text semantic="p" tone={portable ? 'muted' : undefined} size={portable ? 11 : undefined}>
            {subtitle}
          </Text>
        </Box>
        <Pressable
          onActivate={onAction}
          style={
            portable
              ? {
                  layout: { direction: 'row', alignItems: 'center', gap: px(5) },
                  typography: { size: 11, color: colorToken('textMuted') },
                }
              : undefined
          }
        >
          {portable ? (
            <Text tone="muted" size={11}>
              {action}
            </Text>
          ) : (
            action
          )}
          <UiIcon name="chevron-right" size={15} />
        </Pressable>
      </Box>
      {children}
    </Box>
  );
}
