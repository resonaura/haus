/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Divider, HausButton, Pressable, Row, Stack, Text } from '../../primitives/index.js';
import { Dialog } from '../dialog.js';
import { UiIcon } from '../icon.js';

export interface PortableContextMenuItem {
  readonly id: string;
  readonly label: string;
  readonly type?: 'normal' | 'separator' | 'submenu';
  readonly enabled?: boolean;
  readonly items?: readonly PortableContextMenuItem[];
}

export function ActionMenuDialog({
  title,
  items,
  onSelect,
  onClose,
}: {
  readonly title: string;
  readonly items: readonly PortableContextMenuItem[];
  readonly onSelect: (id: string) => void;
  readonly onClose: () => void;
}) {
  const [submenuId, setSubmenuId] = useState<string | null>(null);
  const activeSubmenu = items.find((item) => item.id === submenuId && item.type === 'submenu');
  const visibleItems = activeSubmenu?.items ?? items;

  return (
    <Dialog title={activeSubmenu ? activeSubmenu.label : title} onClose={onClose}>
      <Stack gapPx={4}>
        {activeSubmenu && (
          <Row justify="start" style={{ layout: { padding: insets(0, 0, 6, 0) } }}>
            <HausButton id="menu-back" size="sm" variant="ghost" onPress={() => setSubmenuId(null)}>
              <Row align="center" gapPx={6}>
                <UiIcon name="chevron-left" size={14} />
                Back
              </Row>
            </HausButton>
          </Row>
        )}
        {visibleItems.map((item) => {
          if (item.type === 'separator') {
            return <Divider key={item.id} />;
          }
          const disabled = item.enabled === false;
          const isSubmenu = item.type === 'submenu' && Boolean(item.items?.length);
          return (
            <Pressable
              key={item.id}
              id={`menu-item-${item.id}`}
              disabled={disabled}
              onActivate={() => {
                if (isSubmenu) {
                  setSubmenuId(item.id);
                  return;
                }
                onSelect(item.id);
              }}
              style={{
                layout: {
                  display: 'flex',
                  direction: 'row',
                  alignItems: 'center',
                  justifyContent: 'between',
                  width: pct(100),
                  minHeight: px(36),
                  padding: insets(8, 12),
                },
                material: new SolidMaterial(colorToken('surface')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(10),
                opacity: disabled ? 0.45 : 1,
                states: {
                  hover: { material: new SolidMaterial(colorToken('surfaceHover')) },
                },
              }}
            >
              <Text size={13} weight={500} tone={disabled ? 'muted' : 'primary'}>
                {item.label}
              </Text>
              {isSubmenu && <UiIcon name="chevron-right" size={14} />}
            </Pressable>
          );
        })}
      </Stack>
    </Dialog>
  );
}
