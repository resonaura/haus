/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { insets, pct, px, transparentColor } from '../../../ir/geometry.js';
import { SolidMaterial } from '../../../ir/materials.js';
import { Box, Pressable, Row, Text } from '../../../primitives/index.js';
import { UiIcon } from '../../icon.js';

export type ServicesSortKey = 'usage' | 'name' | 'status' | 'cpu' | 'memory' | 'extra';

export function ServerServicesTableHeader({
  sortKey,
  sortDesc,
  trailingHeader,
  showActionsColumn,
  onToggleSort,
}: {
  readonly sortKey: ServicesSortKey;
  readonly sortDesc: boolean;
  readonly trailingHeader: string;
  readonly showActionsColumn: boolean;
  readonly onToggleSort: (key: ServicesSortKey) => void;
}) {
  const arrow = <UiIcon name={sortDesc ? 'arrow-down' : 'arrow-up'} size={11} />;
  return (
    <Row
      align="center"
      justify="between"
      gapPx={12}
      style={{
        layout: {
          width: pct(100),
          padding: insets(6, 0, 10, 0),
          position: 'relative',
          zIndex: 2,
        },
      }}
    >
      <Row align="center" gapPx={12} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
        <Pressable
          onActivate={() => onToggleSort('usage')}
          style={{
            layout: {
              display: 'flex',
              direction: 'row',
              alignItems: 'center',
              gap: px(3),
              width: px(48),
              flexShrink: 0,
            },
            material: new SolidMaterial(transparentColor),
            border: { width: 0, style: 'none', color: transparentColor },
          }}
        >
          <Text size={11} weight={600} tone={sortKey === 'usage' ? 'primary' : 'muted'}>
            Usage
          </Text>
          {sortKey === 'usage' && arrow}
        </Pressable>

        <Pressable
          onActivate={() => onToggleSort('name')}
          style={{
            layout: {
              display: 'flex',
              direction: 'row',
              alignItems: 'center',
              gap: px(4),
              flexGrow: 1,
            },
            material: new SolidMaterial(transparentColor),
            border: { width: 0, style: 'none', color: transparentColor },
          }}
        >
          <Text size={11} weight={600} tone={sortKey === 'name' ? 'primary' : 'muted'}>
            Name
          </Text>
          {sortKey === 'name' && arrow}
        </Pressable>
      </Row>

      <Row align="center" gapPx={12} style={{ layout: { flexShrink: 0 } }}>
        <Pressable
          onActivate={() => onToggleSort('status')}
          style={{
            layout: {
              display: 'flex',
              direction: 'row',
              alignItems: 'center',
              gap: px(3),
              width: px(96),
            },
            material: new SolidMaterial(transparentColor),
            border: { width: 0, style: 'none', color: transparentColor },
          }}
        >
          <Text size={11} weight={600} tone={sortKey === 'status' ? 'primary' : 'muted'}>
            Status
          </Text>
          {sortKey === 'status' && arrow}
        </Pressable>

        <Pressable
          onActivate={() => onToggleSort('cpu')}
          style={{
            layout: {
              display: 'flex',
              direction: 'row',
              alignItems: 'center',
              justifyContent: 'end',
              gap: px(3),
              width: px(58),
            },
            material: new SolidMaterial(transparentColor),
            border: { width: 0, style: 'none', color: transparentColor },
          }}
        >
          <Text size={11} weight={600} tone={sortKey === 'cpu' ? 'primary' : 'muted'}>
            CPU
          </Text>
          {sortKey === 'cpu' && arrow}
        </Pressable>

        <Pressable
          onActivate={() => onToggleSort('memory')}
          style={{
            layout: {
              display: 'flex',
              direction: 'row',
              alignItems: 'center',
              justifyContent: 'end',
              gap: px(3),
              width: px(70),
            },
            material: new SolidMaterial(transparentColor),
            border: { width: 0, style: 'none', color: transparentColor },
          }}
        >
          <Text size={11} weight={600} tone={sortKey === 'memory' ? 'primary' : 'muted'}>
            Memory
          </Text>
          {sortKey === 'memory' && arrow}
        </Pressable>

        <Pressable
          onActivate={() => onToggleSort('extra')}
          style={{
            layout: {
              display: 'flex',
              direction: 'row',
              alignItems: 'center',
              gap: px(3),
              width: px(124),
            },
            material: new SolidMaterial(transparentColor),
            border: { width: 0, style: 'none', color: transparentColor },
          }}
        >
          <Text size={11} weight={600} tone={sortKey === 'extra' ? 'primary' : 'muted'}>
            {trailingHeader}
          </Text>
          {sortKey === 'extra' && arrow}
        </Pressable>

        {showActionsColumn && <Box style={{ layout: { width: px(158) } }} />}
      </Row>
    </Row>
  );
}
