/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ReactNode, RefObject } from 'react';
import { Box, Heading, Pressable, Text } from '@haus/ui';
import { ChevronRight, LayoutGrid } from 'lucide-react';
import type { HausAccessory, HausModel, HausRoom } from '../../model';
import type { Preferences } from '../../model/preferences';
import type { Route } from '../../app/navigation';
import { categories } from '../../model/categories';
import { titleCase } from '../../model/presentation';
import { groupNumberedLights, roomDevicePriority } from '../../model/room-devices';
import { categoryIcons, roomIconFor } from '../../components/icons/Icon';
import { VirtualSections } from '../../components/ui/VirtualSections';
import { useOnNow } from './useOnNow';
type Props = {
  items: HausAccessory[];
  grouping: 'category' | 'room';
  hiddenView?: boolean;
  preferences: Preferences;
  search: string;
  orderedRooms: HausRoom[];
  model: HausModel;
  scrollRef: RefObject<HTMLDivElement | null>;
  route: Route;
  go: (route: Route) => void;
  userLightOffRef?: RefObject<Map<string, number>>;
  renderGrid: (
    items: HausAccessory[],
    hidden?: boolean,
    className?: string,
    scope?: string,
  ) => ReactNode;
};
export function DeviceGroups({
  items,
  grouping,
  hiddenView = false,
  preferences,
  search,
  orderedRooms,
  model,
  scrollRef,
  route,
  go,
  userLightOffRef,
  renderGrid,
}: Props) {
  const activeKey = 'active-lights';
  const onNowEnabled =
    !hiddenView && grouping === 'room' && route.kind === 'category' && route.id === 'lights';
  const onNow = useOnNow(items, onNowEnabled, userLightOffRef);
  const active = onNowEnabled ? onNow.items : [];
  const activeIds = onNowEnabled ? onNow.retained : new Set<string>();
  const groups = new Map<string, HausAccessory[]>();
  for (const item of items) {
    if (activeIds.has(item.id)) continue;
    const key = grouping === 'category' ? item.category : item.areaId || 'unassigned';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const orderedKeys =
    grouping === 'category'
      ? categories
          .map((category) => category.id)
          .filter((id) => groups.has(id))
          .sort(
            (a, b) =>
              Math.min(
                ...groups.get(a)!.map((item) => roomDevicePriority(item, preferences.favorites)),
              ) -
              Math.min(
                ...groups.get(b)!.map((item) => roomDevicePriority(item, preferences.favorites)),
              ),
          )
      : [
          ...orderedRooms.map((item) => item.id).filter((id) => groups.has(id)),
          ...[...groups.keys()].filter(
            (id) => id !== activeKey && !model.rooms.some((item) => item.id === id),
          ),
        ];

  const renderSection = (key: string) => {
    const groupItems = key === activeKey ? active : (groups.get(key) ?? []);
    const category = categories.find((item) => item.id === key);
    const room = model.rooms.find((item) => item.id === key);
    const Icon =
      key === activeKey
        ? categoryIcons.lights
        : grouping === 'category'
          ? categoryIcons[key]
          : room
            ? roomIconFor(room.name, preferences.roomIcons?.[room.id])
            : undefined;
    const label =
      key === activeKey
        ? 'On Now'
        : grouping === 'category'
          ? (category?.name ?? titleCase(key))
          : (room?.name ?? 'Unassigned');

    return (
      <Box
        semantic="section"
        className={`device-group ${grouping === 'category' ? `device-group--${key}` : ''}`}
        dataAttrs={{ 'data-category': grouping === 'category' ? key : undefined }}
        key={key}
      >
        <Box className="device-group-heading">
          <Text
            className={`device-group-icon ${grouping === 'category' ? `device-group-icon--${key}` : ''}`}
          >
            {Icon ? <Icon size={16} strokeWidth={1.7} /> : <LayoutGrid size={16} />}
          </Text>
          <Heading level={2}>
            {route.kind === 'category' && grouping === 'room' && room ? (
              <Pressable className="group-room-link" onPress={() => go({ kind: 'room', id: key })}>
                {label}
                <ChevronRight size={14} />
              </Pressable>
            ) : (
              label
            )}
          </Heading>
          <Text className="device-group-count">
            {groupItems.length} {groupItems.length === 1 ? 'device' : 'devices'}
          </Text>
          <Text className="device-group-rule" />
        </Box>
        {renderGrid(
          groupItems,
          hiddenView,
          'accessory-grid',
          key === activeKey
            ? 'category:lights:active'
            : grouping === 'category'
              ? `category:${key}:${route.kind === 'room' ? route.id : 'global'}`
              : `room:${key}:${route.kind === 'category' ? route.id : 'global'}`,
        )}
      </Box>
    );
  };
  return (
    <>
      {onNowEnabled && (
        <Box
          className="presence-section"
          dataAttrs={{ 'data-open': active.length > 0 || undefined }}
          ariaHidden={!active.length}
          inert={!active.length}
        >
          <Box>{renderSection(activeKey)}</Box>
        </Box>
      )}
      <VirtualSections
        items={orderedKeys}
        getKey={(key) => key}
        scrollRef={scrollRef}
        estimateHeight={(key, columns) =>
          74 +
          Math.ceil(
            groupNumberedLights(
              groups.get(key) ?? [],
              !hiddenView && !search && preferences.autoGroupLights !== false,
              preferences.disabledLightGroups,
            ).length / columns,
          ) *
            (hiddenView ? 196 : 137)
        }
        renderSection={renderSection}
      />
    </>
  );
}
