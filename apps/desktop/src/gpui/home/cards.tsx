/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState } from 'react';
import type { HassEntity, Snapshot } from '@haus/ha/types';
import { lightColor } from '@haus/ha/light-color';
import { lightStateDescription } from '@haus/ha/light-profile';
import type { RegistryController } from '@haus/ha/ui/registry';
import { isEntityActive } from '@haus/ha/view/device-state';
import type { Preferences } from '@haus/ha/view/preferences';
import type { HausAccessory } from '@haus/ha/view/types';
import { getCategoryMetadata } from '@haus/ui/categories';
import {
  CameraPreviewTile,
  DashboardGrid,
  DeviceTile,
  SceneCard,
} from '@haus/ui/components';
import { Image } from '@haus/ui/primitives';
import { pct, rgba, type ColorValue } from '@haus/ui/ir';
import { demoCameraPreviewSrc } from '../camera/preview-image.js';
import { DeviceDetailsModal } from './device-modal.js';
import type { StatisticsRequest } from './history.js';
import {
  availableAction,
  type DeviceIntent,
  type HomeDevice,
  type homeDashboard,
} from './model.js';

export type DeviceControl = (id: string, intent: DeviceIntent, value?: unknown) => void;

function accent(value: string | undefined): ColorValue | undefined {
  const rgb = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value ?? '');
  return rgb ? rgba(Number(rgb[1]), Number(rgb[2]), Number(rgb[3])) : undefined;
}

function resolveModalDevice(
  cards: readonly HomeDevice[],
  selected: string,
  preferences?: Preferences,
): HomeDevice | undefined {
  if (!selected) return undefined;
  const direct = cards.find((item) => item.id === selected);
  if (direct) return direct;
  for (const card of cards) {
    const member = card.accessory.lightGroup?.members.find(
      (item) => item.primaryEntityId === selected,
    );
    if (member) {
      return {
        id: member.primaryEntityId,
        accessory: member,
        name: member.name,
        category: member.category,
        categoryLabel: getCategoryMetadata(member.category).label,
        state: lightStateDescription(member.state),
        available: member.availability === 'available',
        favorite: Boolean(preferences?.favorites.some((fav) => member.entityIds.includes(fav))),
        accent: isEntityActive(member.state) ? lightColor(member.state) : undefined,
      };
    }
  }
  return undefined;
}

export function DeviceCards({
  cards,
  columns,
  snapshot,
  preferences,
  allAccessories,
  demo,
  disabled,
  canFavorite,
  selectedId,
  statistics,
  registry,
  onSelectId,
  onControl,
  onFavorite,
  onPreferencesPatch,
  onManage,
  onContextMenu,
}: {
  cards: readonly HomeDevice[];
  columns: number;
  snapshot: Snapshot;
  preferences?: Preferences;
  allAccessories?: readonly HausAccessory[];
  demo?: boolean;
  disabled: boolean;
  canFavorite: boolean;
  selectedId?: string;
  statistics?: StatisticsRequest;
  registry?: Pick<RegistryController, 'saveRoom' | 'updateEntity'>;
  onSelectId?: (id: string) => void;
  onControl: DeviceControl;
  onFavorite: (id: string, favorite: boolean) => void;
  onPreferencesPatch?: (patch: Partial<Preferences>) => void;
  onManage?: (url: string) => void;
  onContextMenu?: (device: HomeDevice) => void;
}) {
  const [internalSelected, setInternalSelected] = useState('');
  const selected = onSelectId ? (selectedId ?? '') : internalSelected;
  const setSelected = onSelectId ?? setInternalSelected;
  const details = resolveModalDevice(cards, selected, preferences);
  return (
    <>
      <DashboardGrid columns={columns}>
        {cards.map((device) => {
          const { accessory } = device;
          const quick: DeviceIntent | undefined = accessory.capabilities.includes('toggle')
            ? 'toggle'
            : accessory.capabilities.includes('press')
              ? 'press'
              : undefined;
          const managementUrl = accessory.managementUrl;
          const action = managementUrl
            ? onManage && (() => onManage(managementUrl))
            : quick &&
                !accessory.lightGroup &&
                !accessory.powerStrip &&
                availableAction(snapshot, device.id, quick)
              ? () => onControl(device.id, quick)
              : undefined;
          const room = snapshot.areas.find((area) => area.area_id === accessory.areaId);
          return (
            <DeviceTile
              key={device.id}
              frame={{
                id: `device-${device.id}`,
                onSecondaryPress: onContextMenu ? () => onContextMenu(device) : undefined,
              }}
              name={device.name}
              category={device.category}
              state={device.state}
              subtitle={room?.name ?? 'Other'}
              available={device.available}
              favorite={device.favorite}
              accent={accent(device.accent)}
              desktop
              onQuick={action}
              quickDisabled={disabled || (!managementUrl && !device.available)}
              quickLabel={managementUrl ? `Open ${device.name} in browser` : undefined}
              opened={selected === device.id}
              onOpen={() => setSelected(selected === device.id ? '' : device.id)}
            />
          );
        })}
      </DashboardGrid>
      {details && (
        <DeviceDetailsModal
          key={details.id}
          device={details}
          snapshot={snapshot}
          preferences={preferences}
          allAccessories={allAccessories}
          demo={demo}
          disabled={disabled}
          canFavorite={canFavorite}
          statistics={statistics}
          registry={registry}
          onClose={() => setSelected('')}
          onSelectDevice={setSelected}
          onControl={onControl}
          onFavorite={onFavorite}
          onPreferencesPatch={onPreferencesPatch}
          onManage={onManage}
        />
      )}
    </>
  );
}

export function SceneCards({
  scenes,
  present,
  snapshot,
  columns,
  disabled,
  showAccessoryCount,
  onControl,
  onContextMenu,
}: {
  scenes: readonly HassEntity[];
  present: ReturnType<typeof homeDashboard>['sceneCard'];
  snapshot: Snapshot;
  columns: number;
  disabled: boolean;
  showAccessoryCount: boolean;
  onControl: DeviceControl;
  onContextMenu?: (scene: HassEntity) => void;
}) {
  return (
    <DashboardGrid columns={columns}>
      {scenes.map((scene) => (
        <SceneCard
          key={scene.entity_id}
          {...present(scene)}
          id={`scene-${scene.entity_id}`}
          applying={snapshot.pendingEntityIds?.includes(scene.entity_id)}
          showAccessoryCount={showAccessoryCount}
          disabled={
            disabled ||
            scene.state === 'unavailable' ||
            snapshot.pendingEntityIds?.includes(scene.entity_id) ||
            !availableAction(snapshot, scene.entity_id, 'run')
          }
          onContextOptions={onContextMenu ? () => onContextMenu(scene) : undefined}
          onActivate={() => onControl(scene.entity_id, 'run')}
        />
      ))}
    </DashboardGrid>
  );
}

export function LiveCameraThumbnail({
  cameraId,
  name,
  demo,
  demoScene,
  index,
  fetchSnapshot,
}: {
  cameraId: string;
  name: string;
  demo?: boolean;
  demoScene?: string;
  index: number;
  fetchSnapshot?: (id: string) => Promise<string | null>;
}) {
  const [liveSrc, setLiveSrc] = useState<string | null>(null);
  useEffect(() => {
    if (demo || !fetchSnapshot) return;
    let alive = true;
    const poll = () => {
      void fetchSnapshot(cameraId)
        .then((next) => {
          if (alive && next) setLiveSrc(next);
        })
        .catch(() => undefined);
    };
    poll();
    const timer = setInterval(poll, 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [cameraId, demo, fetchSnapshot]);

  const src = demo ? demoCameraPreviewSrc(demoScene, index) : liveSrc;
  if (!src) return null;
  return (
    <Image
      src={src}
      alt={name}
      ariaHidden
      objectFit="cover"
      style={{ layout: { width: pct(100), height: pct(100) } }}
    />
  );
}

export function CameraPreviews({
  cameras,
  columns,
  demo,
  fetchSnapshot,
  onOpen,
  onContextMenu,
}: {
  cameras: readonly {
    id: string;
    name: string;
    room?: string;
    label?: string;
    demoScene?: string;
    available?: boolean;
  }[];
  columns: number;
  demo?: boolean;
  fetchSnapshot?: (id: string) => Promise<string | null>;
  onOpen: (id: string) => void;
  onContextMenu?: (id: string) => void;
}) {
  return (
    <DashboardGrid columns={columns}>
      {cameras.map((camera, index) => (
        <CameraPreviewTile
          key={camera.id}
          id={`preview-${camera.id}`}
          name={camera.name}
          label={camera.label ?? camera.name}
          room={camera.room}
          status={demo ? 'Preview' : camera.available === false ? 'Offline' : 'Live'}
          preview={
            <LiveCameraThumbnail
              cameraId={camera.id}
              name={camera.name}
              demo={demo}
              demoScene={camera.demoScene}
              index={index}
              fetchSnapshot={fetchSnapshot}
            />
          }
          onSecondaryPress={onContextMenu ? () => onContextMenu(camera.id) : undefined}
          onOpen={() => onOpen(camera.id)}
        />
      ))}
    </DashboardGrid>
  );
}
