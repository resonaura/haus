/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { Dialog } from '../dialog.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';

export interface SpotlightResultItem {
  readonly id: string;
  readonly group: string;
  readonly title: string;
  readonly subtitle: string;
  readonly icon: UiIconName;
  readonly onSelect: () => void;
}

export function SpotlightDialog({
  query,
  onQueryChange,
  items,
  onClose,
}: {
  readonly query: string;
  readonly onQueryChange: (next: string) => void;
  readonly items: readonly SpotlightResultItem[];
  readonly onClose: () => void;
}) {
  const sections: Array<{ title: string; entries: SpotlightResultItem[] }> = [];
  for (const item of items) {
    const existing = sections.find((entry) => entry.title === item.group);
    if (existing) existing.entries.push(item);
    else sections.push({ title: item.group, entries: [item] });
  }

  return (
    <Dialog title="Search Haus" onClose={onClose}>
      <Stack gapPx={12}>
        <Row
          align="center"
          gapPx={8}
          style={{
            layout: { padding: insets(6, 10) },
            material: new SolidMaterial(colorToken('surface')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(12),
          }}
        >
          <UiIcon name="search" size={16} />
          <Box style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <TextInput
              id="search-query"
              ariaLabel="Search devices, rooms, and scenes"
              autoFocus
              value={query}
              onChange={onQueryChange}
              placeholder="Search devices, rooms, cameras, scenes"
              onSubmit={() => {
                const first = items[0];
                if (!first) return;
                first.onSelect();
                onClose();
              }}
              style={{
                layout: { height: px(32), width: pct(100) },
              }}
            />
          </Box>
          {query.length > 0 && (
            <HausButton id="spotlight-clear" size="sm" variant="ghost" onPress={() => onQueryChange('')}>
              <UiIcon name="x" size={14} />
            </HausButton>
          )}
        </Row>

        {sections.length === 0 ? (
          <Box style={{ layout: { padding: insets(20, 12) } }}>
            <Text tone="muted" size={13}>
              {query.trim()
                ? `No matches for "${query.trim()}".`
                : 'Type to search devices, rooms, cameras, and scenes.'}
            </Text>
          </Box>
        ) : (
          <Stack
            gapPx={10}
            style={{ layout: { maxHeight: px(380), minHeight: px(0), overflowY: 'scroll' } }}
          >
            {sections.map((section) => (
              <Stack key={section.title} gapPx={4}>
                <Text tone="muted" size={10} weight={600} style={{ typography: { letterSpacing: 1 } }}>
                  {section.title.toUpperCase()}
                </Text>
                {section.entries.map((entry) => (
                  <Pressable
                    key={entry.id}
                    id={`spotlight-${entry.id}`}
                    onActivate={() => {
                      entry.onSelect();
                      onClose();
                    }}
                    style={{
                      layout: {
                        display: 'flex',
                        direction: 'row',
                        alignItems: 'center',
                        justifyContent: 'between',
                        gap: px(10),
                        width: pct(100),
                        padding: insets(8, 10),
                      },
                      material: new SolidMaterial(colorToken('surface')),
                      border: { width: 1, color: colorToken('border') },
                      corners: corners(10),
                      states: {
                        hover: { material: new SolidMaterial(colorToken('surfaceHover')) },
                      },
                    }}
                  >
                    <Row align="center" gapPx={10} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                      <UiIcon name={entry.icon} size={16} />
                      <Stack gapPx={1} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                        <Text size={13} weight={600}>
                          {entry.title}
                        </Text>
                        <Text tone="muted" size={11}>
                          {entry.subtitle}
                        </Text>
                      </Stack>
                    </Row>
                    <UiIcon name="chevron-right" size={14} />
                  </Pressable>
                ))}
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>
    </Dialog>
  );
}
