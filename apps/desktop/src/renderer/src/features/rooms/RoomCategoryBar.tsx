/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ScrollShadow } from '@heroui/react';
import { LayoutGrid } from 'lucide-react';
import { categoryIcons } from '../../components/icons/Icon';
import { isEntityActive } from '../../model/device-appearance';
import type { HausAccessory } from '../../model';

export function RoomCategoryBar({
  roomCategories,
  filtered,
  effectiveRoomCategory,
  roomTemperatureLabel,
  onSelect,
}: {
  roomCategories: ReadonlyArray<{ id: string; name: string }>;
  filtered: HausAccessory[];
  effectiveRoomCategory: string;
  roomTemperatureLabel?: string;
  onSelect: (category: string) => void;
}) {
  if (!roomCategories.length) return null;
  return (
    <div className="room-category-bar">
      <ScrollShadow
        className="category-badges-scroll"
        orientation="horizontal"
        hideScrollBar
        size={28}
      >
        <div className="room-category-badges">
          <button
            className={`category-badge category-badge--all ${effectiveRoomCategory === 'all' ? 'active' : ''}`}
            data-category="all"
            onClick={() => onSelect('all')}
          >
            <span className="badge-icon">
              <LayoutGrid size={15} />
            </span>
            <span className="badge-name">All</span>
            <span className="badge-pill">{filtered.length}</span>
          </button>
          {roomCategories.map((category) => {
            const Icon = categoryIcons[category.id] ?? LayoutGrid;
            const items = filtered.filter((a) => a.category === category.id);
            const activeCount = items.filter((a) => isEntityActive(a.state)).length;
            const isSelected = effectiveRoomCategory === category.id;
            let pillText = `${items.length}`;
            if (category.id === 'climate' && roomTemperatureLabel && roomTemperatureLabel !== '—') {
              pillText = roomTemperatureLabel;
            } else if (activeCount > 0) {
              pillText = `${activeCount} on`;
            }

            return (
              <button
                key={category.id}
                data-category={category.id}
                className={`category-badge category-badge--${category.id} ${isSelected ? 'active' : ''} ${activeCount > 0 ? 'has-active' : ''}`}
                onClick={() => onSelect(isSelected ? 'all' : category.id)}
              >
                <span className="badge-icon">
                  <Icon size={15} strokeWidth={1.8} />
                </span>
                <span className="badge-name">{category.name}</span>
                <span className={`badge-pill ${activeCount > 0 ? 'is-active' : ''}`}>
                  {pillText}
                </span>
              </button>
            );
          })}
        </div>
      </ScrollShadow>
    </div>
  );
}
