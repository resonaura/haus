/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useMemo, type ReactNode } from 'react';
import { restoreFromAppPatch } from '@haus/core/transport';
import type { HassEntity, Snapshot } from '@haus/ha/types';
import type { Preferences } from '@haus/ha/view/preferences';
import {
  HiddenItemsView,
  UiIcon,
  type PortableHiddenCameraItem,
} from '@haus/ui/components';
import { insets, pct, px } from '@haus/ui/ir';
import { HausButton, Heading, Row, Stack, Text } from '@haus/ui/primitives';
import { LiveCameraThumbnail } from '../home/cards.js';
import type { HomeDevice, homeDashboard } from '../home/model.js';

export function GpuiHiddenView({
  snapshot,
  preferences,
  home,
  demo,
  fetchCameraSnapshot,
  renderDevices,
  renderScenes,
  onOpenCamera,
  onPreferencesPatch,
}: {
  readonly snapshot: Snapshot;
  readonly preferences: Preferences;
  readonly home: ReturnType<typeof homeDashboard>;
  readonly demo?: boolean;
  readonly fetchCameraSnapshot?: (id: string) => Promise<string | null>;
  readonly renderDevices: (devices: readonly HomeDevice[]) => ReactNode;
  readonly renderScenes: (scenes: readonly HassEntity[], showAccessoryCount?: boolean) => ReactNode;
  readonly onOpenCamera: (id: string) => void;
  readonly onPreferencesPatch?: (patch: Partial<Preferences>) => void;
}) {
  const restoreEntity = (entityId: string) => {
    const patch = restoreFromAppPatch(entityId, home.allAccessories, preferences);
    onPreferencesPatch?.(patch);
  };

  const groupedAccessories = useMemo(() => {
    const areaName = new Map(snapshot.areas.map((area) => [area.area_id, area.name]));
    const buckets = new Map<string, { readonly id: string; readonly name: string; devices: HomeDevice[] }>();
    for (const device of home.hiddenDevices) {
      const areaId = device.accessory.areaId ?? 'unassigned';
      const existing = buckets.get(areaId);
      if (existing) {
        existing.devices.push(device);
      } else {
        buckets.set(areaId, {
          id: areaId,
          name: areaName.get(areaId) ?? 'Unassigned',
          devices: [device],
        });
      }
    }
    return [...buckets.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [home.hiddenDevices, snapshot.areas]);

  const cameraItems = useMemo<PortableHiddenCameraItem[]>(
    () =>
      home.hiddenCameras.map((camera, index) => ({
        id: camera.id,
        name: camera.name,
        preview: (
          <LiveCameraThumbnail
            cameraId={camera.id}
            name={camera.name}
            demo={demo}
            demoScene={camera.demoScene}
            index={index}
            fetchSnapshot={fetchCameraSnapshot}
          />
        ),
      })),
    [demo, fetchCameraSnapshot, home.hiddenCameras],
  );

  const sceneLabel = (scene: HassEntity) =>
    typeof scene.attributes.friendly_name === 'string' && scene.attributes.friendly_name.trim()
      ? scene.attributes.friendly_name.trim()
      : scene.entity_id;

  const accessoriesContent =
    groupedAccessories.length > 0 ? (
      <Stack gapPx={18} style={{ layout: { width: pct(100) } }}>
        {groupedAccessories.map((group) => (
          <Stack key={group.id} gapPx={10} style={{ layout: { width: pct(100) } }}>
            <Row align="center" gapPx={8} style={{ layout: { padding: insets(2, 0) } }}>
              <Heading level={3} size={15} weight={600}>
                {group.name}
              </Heading>
              <Text size={11} tone="muted">
                {`${group.devices.length} ${group.devices.length === 1 ? 'device' : 'devices'}`}
              </Text>
            </Row>
            {renderDevices(group.devices)}
            <Row align="center" gapPx={8} wrap>
              {group.devices.map((device) => (
                <HausButton
                  key={device.id}
                  id={`restore-device-${device.id}`}
                  size="sm"
                  variant="ghost"
                  onPress={() => restoreEntity(device.id)}
                >
                  <Row align="center" gapPx={6}>
                    <UiIcon name="eye" size={13} />
                    <Text size={11}>{`Restore ${device.name}`}</Text>
                  </Row>
                </HausButton>
              ))}
            </Row>
          </Stack>
        ))}
      </Stack>
    ) : undefined;

  const scenesContent =
    home.hiddenScenes.length > 0 ? (
      <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
        {renderScenes(home.hiddenScenes, false)}
        <Row align="center" gapPx={8} wrap>
          {home.hiddenScenes.map((scene) => (
            <HausButton
              key={scene.entity_id}
              id={`restore-scene-${scene.entity_id}`}
              size="sm"
              variant="ghost"
              onPress={() => restoreEntity(scene.entity_id)}
            >
              <Row align="center" gapPx={6}>
                <UiIcon name="eye" size={13} />
                <Text size={11}>{`Restore ${sceneLabel(scene)}`}</Text>
              </Row>
            </HausButton>
          ))}
        </Row>
      </Stack>
    ) : undefined;

  return (
    <Stack gapPx={12} style={{ layout: { width: pct(100), minWidth: px(0) } }}>
      <HiddenItemsView
        hasAccessories={groupedAccessories.length > 0}
        accessoriesContent={accessoriesContent}
        cameras={cameraItems}
        hasScenes={home.hiddenScenes.length > 0}
        scenesContent={scenesContent}
        onOpenCamera={onOpenCamera}
        onRestoreEntity={restoreEntity}
      />
    </Stack>
  );
}
