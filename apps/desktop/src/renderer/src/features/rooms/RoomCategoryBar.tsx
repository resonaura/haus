/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, HausScrollArea, Pressable, Text } from '@haus/ui';
import { LayoutGrid } from 'lucide-react';
import { categoryIcons } from '../../components/icons/Icon';
import { accessoriesForCategory } from '../../model/categories';
import { isEntityActive } from '../../model/device-appearance';
import type { HausAccessory, Snapshot } from '../../model';

export function RoomCategoryBar({
  roomCategories,
  filtered,
  allItems,
  services,
  effectiveRoomCategory,
  roomTemperatureLabel,
  onSelect,
}: {
  roomCategories: ReadonlyArray<{ id: string; name: string }>;
  filtered: HausAccessory[];
  allItems?: HausAccessory[];
  services?: Snapshot['services'];
  effectiveRoomCategory: string;
  roomTemperatureLabel?: string;
  onSelect: (category: string) => void;
}) {
  if (!roomCategories.length) return null;
  const sourceItems = allItems ?? filtered;
  return (
    <Box className="room-category-bar">
      <HausScrollArea
        className="category-badges-scroll"
        orientation="horizontal"
        hideScrollBar
        size={28}
      >
        <Box className="room-category-badges">
          <Pressable
            className={`category-badge category-badge--all ${effectiveRoomCategory === 'all' ? 'active' : ''}`}
            dataAttrs={{ 'data-category': 'all' }}
            onPress={() => onSelect('all')}
          >
            <Text className="badge-icon">
              <LayoutGrid size={15} />
            </Text>
            <Text className="badge-name">All</Text>
            <Text className="badge-pill">{filtered.length}</Text>
          </Pressable>
          {roomCategories.map((category) => {
            const Icon = categoryIcons[category.id] ?? LayoutGrid;
            const items = accessoriesForCategory(sourceItems, category.id, {
              services,
              excludeCameras: true,
            });
            const activeCount = items.filter((a) => isEntityActive(a.state)).length;
            const isSelected = effectiveRoomCategory === category.id;
            let pillText = `${items.length}`;
            if (category.id === 'climate' && roomTemperatureLabel && roomTemperatureLabel !== '—') {
              pillText = roomTemperatureLabel;
            } else if (activeCount > 0) {
              pillText = `${activeCount} on`;
            }

            return (
              <Pressable
                key={category.id}
                dataAttrs={{ 'data-category': category.id }}
                className={`category-badge category-badge--${category.id} ${isSelected ? 'active' : ''} ${activeCount > 0 ? 'has-active' : ''}`}
                onPress={() => onSelect(isSelected ? 'all' : category.id)}
              >
                <Text className="badge-icon">
                  <Icon size={15} strokeWidth={1.8} />
                </Text>
                <Text className="badge-name">{category.name}</Text>
                <Text className={`badge-pill ${activeCount > 0 ? 'is-active' : ''}`}>
                  {pillText}
                </Text>
              </Pressable>
            );
          })}
        </Box>
      </HausScrollArea>
    </Box>
  );
}
