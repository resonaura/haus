/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useMemo, useState, type ReactNode } from 'react';
import type { HassEntity, Snapshot } from '@haus/ha/types';
import { accessoriesForCategory, categories } from '@haus/ha/view/categories';
import { isEntityActive } from '@haus/ha/view/device-state';
import {
  DEVICE_ICONS,
  RoomCategoryBarView,
  UiIcon,
  type PortableRoomCategoryPill,
  type UiIconName,
} from '@haus/ui/components';
import { colorToken, corners, insets, pct, px, SolidMaterial } from '@haus/ui/ir';
import { Box, HausButton, Heading, Row, Stack, Text } from '@haus/ui/primitives';
import type { HomeRoute } from '../shell.js';
import type { HomeDevice, homeDashboard } from '../home/model.js';

function categoryIconName(categoryId: string): UiIconName {
  return Object.hasOwn(DEVICE_ICONS, categoryId)
    ? DEVICE_ICONS[categoryId as keyof typeof DEVICE_ICONS]
    : 'layout-grid';
}

export function GpuiRoomDetailView({
  roomId,
  snapshot,
  home,
  renderDevices,
  renderCameras,
  renderScenes,
  onGo,
}: {
  readonly roomId: string;
  readonly snapshot: Snapshot;
  readonly home: ReturnType<typeof homeDashboard>;
  readonly renderDevices: (devices: readonly HomeDevice[]) => ReactNode;
  readonly renderCameras: (cameras: typeof home.cameras) => ReactNode;
  readonly renderScenes: (scenes: readonly HassEntity[], showAccessoryCount?: boolean) => ReactNode;
  readonly onGo: (route: HomeRoute) => void;
}) {
  const [selectedCategory, setSelectedCategory] = useState('all');

  const allDevices = useMemo(() => home.roomDevices(roomId), [home, roomId]);
  const roomCameras = useMemo(() => home.roomCameras(roomId), [home, roomId]);
  const roomScenes = useMemo(() => home.roomScenes(roomId), [home, roomId]);
  const roomRaw = useMemo(() => home.roomRawAccessories(roomId), [home, roomId]);
  const roomTemp = useMemo(() => home.roomTemperature(roomId), [home, roomId]);

  const categoryBuckets = useMemo(() => {
    const entries: { readonly pill: PortableRoomCategoryPill; readonly devices: HomeDevice[] }[] = [];
    for (const cat of categories) {
      const matched = accessoriesForCategory(roomRaw, cat.id, {
        services: snapshot.services,
        excludeCameras: true,
      });
      if (!matched.length) continue;
      const activeCount = matched.filter((item) => isEntityActive(item.state)).length;
      let pillText = `${matched.length}`;
      if (cat.id === 'climate' && roomTemp !== '—') {
        pillText = roomTemp;
      } else if (activeCount > 0) {
        pillText = `${activeCount} on`;
      }
      entries.push({
        pill: {
          id: cat.id,
          name: cat.name,
          icon: categoryIconName(cat.id),
          pillText,
          activeCount,
        },
        devices: home.roomDevicesForCategory(roomId, cat.id),
      });
    }
    return entries;
  }, [home, roomId, roomRaw, roomTemp, snapshot.services]);

  const effectiveCategory =
    selectedCategory === 'all' || categoryBuckets.some((entry) => entry.pill.id === selectedCategory)
      ? selectedCategory
      : 'all';

  const activeBucket =
    effectiveCategory === 'all'
      ? undefined
      : categoryBuckets.find((entry) => entry.pill.id === effectiveCategory);

  const isEmpty = !allDevices.length && !roomCameras.length && !roomScenes.length;

  return (
    <Stack gapPx={18} style={{ layout: { width: pct(100) } }}>
      {roomCameras.length > 0 && renderCameras(roomCameras)}

      {roomScenes.length > 0 && (
        <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
          <Row align="end" justify="between" gapPx={10}>
            <Stack gapPx={2}>
              <Heading level={2} size={17} weight={600}>
                Scenes for this room
              </Heading>
              <Text size={12} tone="muted">
                Run a scene without leaving the room.
              </Text>
            </Stack>
            <HausButton variant="ghost" size="sm" onPress={() => onGo('scenes')}>
              All scenes
            </HausButton>
          </Row>
          {renderScenes(roomScenes)}
        </Stack>
      )}

      {categoryBuckets.length > 0 && (
        <RoomCategoryBarView
          totalCount={allDevices.length}
          categories={categoryBuckets.map((entry) => entry.pill)}
          selectedCategory={effectiveCategory}
          onSelect={setSelectedCategory}
        />
      )}

      {isEmpty ? (
        <Stack
          align="center"
          gapPx={8}
          style={{
            layout: { width: pct(100), padding: insets(38, 20) },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(16),
          }}
        >
          <UiIcon name="search" size={26} />
          <Heading level={3} size={16} weight={600}>
            Make this space yours
          </Heading>
          <Text size={12} tone="muted" style={{ typography: { align: 'center' } }}>
            Accessories appear here as you add them to your home.
          </Text>
          <HausButton variant="outline" onPress={() => onGo('rooms')}>
            Manage rooms
          </HausButton>
        </Stack>
      ) : activeBucket ? (
        renderDevices(activeBucket.devices)
      ) : categoryBuckets.length > 1 ? (
        <Stack gapPx={18} style={{ layout: { width: pct(100) } }}>
          {categoryBuckets.map((bucket) => (
            <Stack key={bucket.pill.id} gapPx={10} style={{ layout: { width: pct(100) } }}>
              <Row align="center" gapPx={8} style={{ layout: { width: pct(100) } }}>
                <UiIcon name={bucket.pill.icon} size={16} />
                <Heading level={3} size={15} weight={600}>
                  {bucket.pill.name}
                </Heading>
                <Text size={11} tone="muted">
                  {String(bucket.devices.length)}
                </Text>
                <Box
                  style={{
                    layout: { flexGrow: 1, height: px(1) },
                    material: new SolidMaterial(colorToken('border')),
                  }}
                />
              </Row>
              {renderDevices(bucket.devices)}
            </Stack>
          ))}
        </Stack>
      ) : (
        renderDevices(allDevices)
      )}
    </Stack>
  );
}
