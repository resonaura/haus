/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Pressable, Row, ScrollView, Text } from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';

export interface PortableRoomCategoryPill {
  readonly id: string;
  readonly name: string;
  readonly icon: UiIconName;
  readonly pillText: string;
  readonly activeCount: number;
}

export function RoomCategoryBarView({
  totalCount,
  categories,
  selectedCategory,
  onSelect,
}: {
  readonly totalCount: number;
  readonly categories: readonly PortableRoomCategoryPill[];
  readonly selectedCategory: string;
  readonly onSelect: (categoryId: string) => void;
}) {
  if (!categories.length) return null;

  return (
    <ScrollView orientation="horizontal" hideScrollBar style={{ layout: { width: pct(100) } }}>
      <Row align="center" gapPx={8} style={{ layout: { padding: insets(2, 0) } }}>
        <Pressable
          id="room-cat-all"
          ariaPressed={selectedCategory === 'all'}
          onActivate={() => onSelect('all')}
          style={{
            layout: { direction: 'row', alignItems: 'center', gap: px(7), padding: insets(7, 12) },
            material: new SolidMaterial(
              selectedCategory === 'all' ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
            ),
            border: { width: 1, color: selectedCategory === 'all' ? colorToken('accent') : colorToken('border') },
            corners: corners(999),
          }}
        >
          <UiIcon name="layout-grid" size={14} />
          <Text size={12} weight={600}>
            All
          </Text>
          <Text size={11} tone="muted">
            {String(totalCount)}
          </Text>
        </Pressable>

        {categories.map((cat) => {
          const selected = selectedCategory === cat.id;
          return (
            <Pressable
              key={cat.id}
              id={`room-cat-${cat.id}`}
              ariaPressed={selected}
              onActivate={() => onSelect(selected ? 'all' : cat.id)}
              style={{
                layout: { direction: 'row', alignItems: 'center', gap: px(7), padding: insets(7, 12) },
                material: new SolidMaterial(
                  selected ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
                ),
                border: { width: 1, color: selected ? colorToken('accent') : colorToken('border') },
                corners: corners(999),
              }}
            >
              <UiIcon name={cat.icon} size={14} />
              <Text size={12} weight={selected ? 600 : 500}>
                {cat.name}
              </Text>
              <Text size={11} tone={cat.activeCount > 0 ? 'accent' : 'muted'}>
                {cat.pillText}
              </Text>
            </Pressable>
          );
        })}
      </Row>
    </ScrollView>
  );
}
