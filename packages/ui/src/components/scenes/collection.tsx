/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import { insets, pct, px } from '../../ir/geometry.js';
import { useHausUi } from '../../primitives/context.js';
import { Box } from '../../primitives/elements.js';
import { ScrollView } from '../../primitives/media.js';
import { SCROLL_SHADOW_PRESETS } from '../../renderers/scroll-shadow.js';
import { DashboardGrid } from '../home.js';
import { SceneCard } from '../scene.js';

export interface SceneCardCollectionItem {
  readonly entityId: string;
  readonly id?: string;
  readonly name: string;
  readonly title: string;
  readonly room: string;
  readonly icon?: string;
  readonly source?: string;
  readonly colors: readonly string[];
  readonly count: number;
  readonly dark?: boolean;
  readonly active?: boolean;
  readonly match?: boolean;
  readonly applying?: boolean;
  readonly completed?: boolean;
  readonly disabled?: boolean;
  readonly details?: boolean;
  readonly menuOpen?: boolean;
  readonly options?: ReactNode;
  readonly onContextOptions?: () => void;
  readonly onActivate: () => void;
}

/**
 * Unified scene card layout shared 1:1 across Electron and GPUIX:
 * - `horizontal = true`: smooth horizontal-scrolling rail with GPUIX-proportioned cards (`288px` desktop, `244px` compact).
 * - `horizontal = false`: responsive multi-column `DashboardGrid` for the Scenes library and Hidden views.
 */
export function SceneCardCollection({
  items,
  horizontal = false,
  columns = 4,
  showAccessoryCount = true,
  scrollId = 'home-scenes-rail',
}: {
  readonly items: readonly SceneCardCollectionItem[];
  readonly horizontal?: boolean;
  readonly columns?: number;
  readonly showAccessoryCount?: boolean;
  readonly scrollId?: string;
}) {
  const { viewport } = useHausUi();
  const cardWidth = viewport.width <= 760 ? 244 : 288;

  if (horizontal) {
    return (
      <ScrollView
        id={scrollId}
        scrollId={scrollId}
        className="mood-scroll"
        orientation="horizontal"
        shadowSizePx={SCROLL_SHADOW_PRESETS.rail}
        hideScrollBar
        style={{
          layout: {
            display: 'flex',
            direction: 'row',
            alignItems: 'stretch',
            gap: px(12),
            width: pct(100),
            minWidth: px(0),
            padding: insets(2, 1, 6, 1),
          },
        }}
      >
        {items.map((item) => {
          const { entityId, ...cardProps } = item;
          return (
            <Box
              key={entityId}
              style={{
                layout: {
                  width: px(cardWidth),
                  minWidth: px(cardWidth),
                  flexShrink: 0,
                  display: 'flex',
                  direction: 'column',
                },
              }}
            >
              <SceneCard {...cardProps} showAccessoryCount={showAccessoryCount} />
            </Box>
          );
        })}
      </ScrollView>
    );
  }

  return (
    <DashboardGrid columns={columns}>
      {items.map((item) => {
        const { entityId, ...cardProps } = item;
        return <SceneCard key={entityId} {...cardProps} showAccessoryCount={showAccessoryCount} />;
      })}
    </DashboardGrid>
  );
}
