/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState } from 'react';
import type { HassEntity, Snapshot } from '@haus/ha/types';
import { resolveDeviceAppearance } from '@haus/ha/view/device-state';
import { lightStateDescription } from '@haus/ha/light-profile';
import type { RegistryController } from '@haus/ha/ui/registry';
import type { Preferences } from '@haus/ha/view/preferences';
import type { HausAccessory } from '@haus/ha/view/types';
import { getCategoryMetadata } from '@haus/ui/categories';
import {
  CameraPreviewTile,
  cameraPreviewMediaStyle,
  DashboardGrid,
  DeviceTile,
  parseCssColor,
  SceneCard,
  UiIcon,
} from '@haus/ui/components';
import { Box, Image } from '@haus/ui/primitives';
import { pct } from '@haus/ui/ir';
import { resolveAccessoryIconName } from './device-icon.js';
import { demoCameraPreviewSrc } from '../camera/preview-image.js';
import { DeviceDetailsModal } from './device-modal.js';
import type { StatisticsRequest } from './history.js';
import {
  availableAction,
  availableDeviceActions,
  type DeviceIntent,
  type DeviceTarget,
  type HomeDevice,
  type homeDashboard,
} from './model.js';

export type DeviceControl = (target: DeviceTarget, intent: DeviceIntent, value?: unknown) => void;

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
      const appearance = resolveDeviceAppearance(member.state);
      const stateText = lightStateDescription(member.state);
      return {
        id: member.primaryEntityId,
        accessory: member,
        name: member.name,
        category: member.category,
        categoryLabel: getCategoryMetadata(member.category).label,
        state: stateText,
        available: member.availability === 'available',
        active: member.availability === 'available' && appearance.active,
        favorite: Boolean(preferences?.favorites.some((fav) => member.entityIds.includes(fav))),
        accent: appearance.actualColor,
        colorSwatch:
          member.availability === 'available' && appearance.active
            ? appearance.actualColor
            : undefined,
        lightEffect: appearance.effect,
        iconName: resolveAccessoryIconName(member),
        stateKey: `${member.state.state}:${stateText}`,
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
          const target =
            accessory.lightGroup?.members.map((member) => member.primaryEntityId) ?? device.id;
          const action = managementUrl
            ? onManage && (() => onManage(managementUrl))
            : quick &&
                !accessory.powerStrip &&
                availableDeviceActions(snapshot, target, quick).length
              ? () => onControl(target, quick)
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
              stateKey={device.stateKey}
              subtitle={room?.name ?? 'Other'}
              available={device.available}
              active={device.active}
              favorite={device.favorite}
              accent={parseCssColor(device.accent)}
              colorSwatch={parseCssColor(device.colorSwatch)}
              lightEffect={device.lightEffect}
              groupCount={device.groupCount}
              battery={device.battery}
              sourceBadge={device.sourceBadge}
              iconName={device.iconName}
              desktop
              onQuick={action}
              quickDisabled={disabled || (!managementUrl && !device.available)}
              quickLabel={managementUrl ? `Open ${device.name} in browser` : undefined}
              opened={selected === device.id}
              onOpen={() => setSelected(selected === device.id ? '' : device.id)}
              onMore={() =>
                onContextMenu
                  ? onContextMenu(device)
                  : setSelected(selected === device.id ? '' : device.id)
              }
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
  available = true,
  fetchSnapshot,
  onSnapshotLoaded,
  onOfflineChange,
  onRecoveryChange,
}: {
  cameraId: string;
  name: string;
  demo?: boolean;
  demoScene?: string;
  index: number;
  available?: boolean;
  fetchSnapshot?: (id: string) => Promise<string | null>;
  onSnapshotLoaded?: (timestamp: number) => void;
  onOfflineChange?: (offline: boolean) => void;
  onRecoveryChange?: (recovering: boolean) => void;
}) {
  const [liveSrc, setLiveSrc] = useState<string | null>(null);

  useEffect(() => {
    if (demo) {
      onOfflineChange?.(false);
      onRecoveryChange?.(false);
      return;
    }
    if (!available) {
      onOfflineChange?.(true);
      onRecoveryChange?.(false);
      return;
    }
    if (!fetchSnapshot) return;
    let alive = true;
    let isOffline = false;
    let offlineTimer: ReturnType<typeof setTimeout> | undefined;
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;

    const armOfflineTimer = () => {
      if (offlineTimer) clearTimeout(offlineTimer);
      offlineTimer = setTimeout(() => {
        if (!alive) return;
        isOffline = true;
        onOfflineChange?.(true);
      }, 30_000);
    };

    armOfflineTimer();
    const poll = () => {
      void fetchSnapshot(cameraId)
        .then((next) => {
          if (!alive || !next) return;
          const now = Date.now();
          armOfflineTimer();
          if (isOffline) {
            isOffline = false;
            onOfflineChange?.(false);
            onRecoveryChange?.(true);
            if (recoveryTimer) clearTimeout(recoveryTimer);
            recoveryTimer = setTimeout(() => {
              if (alive) onRecoveryChange?.(false);
            }, 1200);
          }
          setLiveSrc(next);
          onSnapshotLoaded?.(now);
        })
        .catch(() => undefined);
    };
    poll();
    const timer = setInterval(poll, 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
      if (offlineTimer) clearTimeout(offlineTimer);
      if (recoveryTimer) clearTimeout(recoveryTimer);
    };
  }, [
    available,
    cameraId,
    demo,
    fetchSnapshot,
    onOfflineChange,
    onRecoveryChange,
    onSnapshotLoaded,
  ]);

  const src = demo ? demoCameraPreviewSrc(demoScene, index) : liveSrc;
  if (!src) {
    if (!demo && !available) return null;
    return (
      <Box
        style={{
          layout: {
            width: pct(100),
            height: pct(100),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          },
        }}
      >
        <UiIcon name="camera" size={27} />
      </Box>
    );
  }
  return (
    <Image
      src={src}
      alt={name}
      ariaHidden
      objectFit="cover"
      transitionMs={demo ? undefined : 220}
      style={cameraPreviewMediaStyle}
    />
  );
}

function GpuiCameraPreviewItem({
  camera,
  index,
  demo,
  fetchSnapshot,
  onOpen,
  onContextMenu,
}: {
  readonly camera: {
    id: string;
    name: string;
    room?: string;
    label?: string;
    demoScene?: string;
    available?: boolean;
  };
  readonly index: number;
  readonly demo?: boolean;
  readonly fetchSnapshot?: (id: string) => Promise<string | null>;
  readonly onOpen: (id: string) => void;
  readonly onContextMenu?: (id: string) => void;
}) {
  const sourceOffline = !demo && camera.available === false;
  const [updatedAt, setUpdatedAt] = useState(0);
  const [offline, setOffline] = useState(sourceOffline);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    setOffline(sourceOffline);
  }, [sourceOffline]);

  const isOffline = !demo && (offline || sourceOffline);
  return (
    <CameraPreviewTile
      id={`preview-${camera.id}`}
      name={camera.name}
      label={camera.label ?? camera.name}
      room={camera.room}
      demo={Boolean(demo)}
      updatedAt={updatedAt}
      offline={isOffline}
      recovering={recovering}
      preview={
        <LiveCameraThumbnail
          cameraId={camera.id}
          name={camera.name}
          demo={demo}
          demoScene={camera.demoScene}
          index={index}
          available={camera.available !== false}
          fetchSnapshot={fetchSnapshot}
          onSnapshotLoaded={setUpdatedAt}
          onOfflineChange={setOffline}
          onRecoveryChange={setRecovering}
        />
      }
      onSecondaryPress={onContextMenu ? () => onContextMenu(camera.id) : undefined}
      onOpen={() => onOpen(camera.id)}
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
        <GpuiCameraPreviewItem
          key={camera.id}
          camera={camera}
          index={index}
          demo={demo}
          fetchSnapshot={fetchSnapshot}
          onOpen={onOpen}
          onContextMenu={onContextMenu}
        />
      ))}
    </DashboardGrid>
  );
}
