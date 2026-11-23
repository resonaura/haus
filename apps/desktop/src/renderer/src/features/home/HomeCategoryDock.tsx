/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef } from 'react';
import { House, LayoutGrid, Server } from 'lucide-react';
import { Box, HausScrollArea, Pressable, Text, useLiquidGlassSurface } from '@haus/ui';
import { categoryIcons } from '../../components/icons/Icon';
import { useActiveLiquidGlass } from '../../hooks/useAppearance';

export interface HomeCategoryItem {
  id: string;
  name: string;
  summary: string;
}

/** The same navigation surface on Home and every filtered Home view. */
export function HomeCategoryDock({
  categories,
  selected,
  onSelect,
}: {
  categories: HomeCategoryItem[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const activeButton = useRef<HTMLButtonElement>(null);
  const activeGlass = useActiveLiquidGlass();
  const glass = useLiquidGlassSurface<HTMLElement>({
    settings: activeGlass.settings,
    cornerRadiusPx: 32,
    isDark: activeGlass.isDark,
  });

  useEffect(() => {
    const container = rail.current;
    const button = activeButton.current;
    if (!container || !button) return;
    const keepVisible = () => {
      const left =
        button.getBoundingClientRect().left -
        container.getBoundingClientRect().left +
        container.scrollLeft;
      const right = left + button.offsetWidth;
      if (left < container.scrollLeft || right > container.scrollLeft + container.clientWidth) {
        container.scrollTo({
          left: left - (container.clientWidth - button.offsetWidth) / 2,
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        });
      }
    };
    keepVisible();
    const observer = new ResizeObserver(keepVisible);
    observer.observe(container);
    return () => observer.disconnect();
  }, [selected]);

  return (
    <Box
      className="home-category-layer"
      dataAttrs={{ 'data-liquid-glass': glass.enabled || undefined }}
    >
      {glass.filterSvg}
      {!glass.enabled && (
        <Box className="home-category-progressive-blur" ariaHidden>
          <Text semantic="swatch" />
          <Text semantic="swatch" />
          <Text semantic="swatch" />
        </Box>
      )}
      <Box
        semantic="nav"
        boxRef={glass.ref}
        className="home-category-dock"
        ariaLabel="Home categories"
        surfaceTokens={glass.style as Record<string, string | number | undefined>}
      >
        <HausScrollArea
          className="home-category-rail"
          orientation="horizontal"
          hideScrollBar
          size={26}
          scrollRef={rail}
        >
          <Pressable
            className="home-category-filter home-category-all"
            ariaPressed={selected === null}
            onPress={() => onSelect(null)}
            pressableRef={selected === null ? activeButton : undefined}
          >
            <House size={19} strokeWidth={1.8} />
            <Text>
              <Text semantic="strong">All</Text>
              <Text semantic="small">Your home</Text>
            </Text>
          </Pressable>
          <Text className="home-category-divider" ariaHidden />
          {categories.map((category) => {
            const Icon =
              category.id === 'servers' ? Server : (categoryIcons[category.id] ?? LayoutGrid);
            const active = selected === category.id;
            return (
              <Pressable
                key={category.id}
                className="home-category-filter"
                dataAttrs={{ 'data-category': category.id }}
                ariaPressed={active}
                onPress={() => onSelect(active ? null : category.id)}
                pressableRef={active ? activeButton : undefined}
              >
                <Icon size={19} strokeWidth={1.8} />
                <Text>
                  <Text semantic="strong">{category.name}</Text>
                  <Text semantic="small">{category.summary}</Text>
                </Text>
              </Pressable>
            );
          })}
        </HausScrollArea>
      </Box>
    </Box>
  );
}
