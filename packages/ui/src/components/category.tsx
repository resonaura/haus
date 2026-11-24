/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode, Ref } from 'react';
import { colorToken, corners, insets, pct, px } from '../ir/geometry.js';
import { SolidMaterial } from '../ir/materials.js';
import { Box, Pressable, Text } from '../primitives/elements.js';
import { ScrollView } from '../primitives/media.js';

export function CategoryFilter({
  id,
  name,
  summary,
  icon,
  selected,
  onSelect,
  buttonRef,
  portable = false,
}: {
  readonly id?: string;
  readonly name: string;
  readonly summary: string;
  readonly icon: ReactNode;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly buttonRef?: Ref<unknown>;
  readonly portable?: boolean;
}) {
  return (
    <Pressable
      id={id ? `category-${id}` : 'category-all'}
      className={`home-category-filter ${id ? '' : 'home-category-all'}`.trim()}
      dataAttrs={{ 'data-category': id }}
      ariaPressed={selected}
      onActivate={onSelect}
      pressableRef={buttonRef}
      style={
        portable
          ? {
              layout: {
                direction: 'row',
                alignItems: 'center',
                gap: px(7),
                padding: insets(6, 10),
                height: px(44),
                flexShrink: 0,
              },
              corners: corners(20),
              material: selected ? new SolidMaterial(colorToken('surfaceActive')) : undefined,
            }
          : undefined
      }
    >
      {icon}
      {portable ? (
        <Box>
          <Text size={11} weight={600}>
            {name}
          </Text>
          <Text tone="muted" size={9}>
            {summary}
          </Text>
        </Box>
      ) : (
        <Text>
          <Text semantic="strong">{name}</Text>
          <Text semantic="small">{summary}</Text>
        </Text>
      )}
    </Pressable>
  );
}

export function CategoryRail({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      orientation="horizontal"
      role="navigation"
      ariaLabel="Home categories"
      style={{
        layout: {
          direction: 'row',
          alignItems: 'center',
          gap: px(2),
          width: pct(100),
          minWidth: px(0),
          padding: insets(5),
          margin: insets(0, 0, 17, 0),
        },
        material: new SolidMaterial(colorToken('card')),
        border: { width: 1, color: colorToken('border') },
        corners: corners(25),
      }}
    >
      {children}
    </ScrollView>
  );
}
