/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { createElement } from 'react';
import {
  buildCameraMenuOptions,
  buildDeviceMenuOptions,
  buildSceneMenuOptions,
  resolveMoveRoomAreaId,
  searchHomeCatalog,
  separateLightGroupPatch,
  toggleAppVisibilityPatch,
  toggleHomeVisibilityPatch,
  type ContextMenuOption,
} from '@haus/core/transport';
import type { HassEntity, Snapshot } from '@haus/ha/types';
import type { RegistryController } from '@haus/ha/ui/registry';
import { isEntityActive } from '@haus/ha/view/device-state';
import { buildCameraMovePreferencePatch, type Preferences } from '@haus/core/preferences';
import type { Category } from '@haus/ha/view/types';
import {
  DEVICE_ICONS,
  DeviceBrandIcon,
  type PortableContextMenuItem,
  type SpotlightResultItem,
} from '@haus/ui/components';
import type { ContextMenuItem } from '../../shared/native.js';
import type { GpuiPlatform } from '../platform.js';
import type { HomeRoute } from '../shell.js';
import { roomIcon } from './navigation.js';
import type { availableAction, DeviceIntent, HomeDevice, homeDashboard } from './model.js';

export interface ActiveFallbackMenu {
  readonly title: string;
  readonly items: readonly PortableContextMenuItem[];
  readonly onSelect: (id: string) => void;
}

function toNativeItems(items: readonly ContextMenuOption[]): ContextMenuItem[] {
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    type: item.type,
    enabled: item.enabled,
    items: item.items ? toNativeItems(item.items) : undefined,
  }));
}

export async function dispatchContextMenu({
  platform,
  title,
  items,
  onSelect,
  onFallback,
}: {
  readonly platform?: Pick<GpuiPlatform, 'showContextMenu'>;
  readonly title: string;
  readonly items: readonly ContextMenuOption[];
  readonly onSelect: (id: string) => void;
  readonly onFallback: (menu: ActiveFallbackMenu) => void;
}): Promise<void> {
  if (platform?.showContextMenu && process.platform === 'darwin') {
    const selected = await platform.showContextMenu(toNativeItems(items));
    if (selected) onSelect(selected);
    return;
  }
  onFallback({ title, items, onSelect });
}

export function buildWorkspaceSpotlightItems({
  query,
  home,
  snapshot,
  preferences,
  onGo,
  onOpenDevice,
  onOpenCamera,
  onControl,
}: {
  readonly query: string;
  readonly home: ReturnType<typeof homeDashboard>;
  readonly snapshot: Snapshot;
  readonly preferences: Preferences;
  readonly onGo: (route: HomeRoute) => void;
  readonly onOpenDevice: (id: string) => void;
  readonly onOpenCamera: (id: string) => void;
  readonly onControl: (id: string, intent: DeviceIntent, value?: unknown) => void;
}): SpotlightResultItem[] {
  const entries = searchHomeCatalog({
    query,
    rooms: home.navigationRooms.map((item) => ({
      id: item.id,
      name: item.name,
      deviceCount: home.roomDevices(item.id).length,
    })),
    categories: home.categories.map((item) => ({ id: item.id, name: item.name })),
    accessories: home.devices.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.accessory.category,
      areaId: item.accessory.areaId,
      primaryEntityId: item.accessory.primaryEntityId,
    })),
    cameras: home.allCameras.map((cam) => ({
      id: cam.id,
      name: cam.name,
      available: cam.available,
    })),
    scenes: snapshot.states
      .filter((state) => state.entity_id.startsWith('scene.'))
      .map((scene) => ({
        id: scene.entity_id,
        name:
          typeof scene.attributes.friendly_name === 'string'
            ? scene.attributes.friendly_name
            : scene.entity_id,
      })),
    favoriteIds: new Set(preferences.favorites),
  });

  return entries.map((entry) => {
    const { target } = entry;
    const matchedDevice =
      target.kind === 'device' ? home.devices.find((d) => d.id === target.id) : undefined;
    const icon =
      target.kind === 'category'
        ? (DEVICE_ICONS[target.id as Category] ?? 'layout-grid')
        : target.kind === 'room'
          ? roomIcon(target.name)
          : target.kind === 'camera'
            ? 'camera'
            : target.kind === 'scene'
              ? 'sparkles'
              : (matchedDevice?.iconName ??
                DEVICE_ICONS[(matchedDevice?.category ?? 'other') as Category]);

    return {
      id: entry.key,
      group: entry.group,
      title: entry.title,
      subtitle: entry.subtitle,
      icon,
      customIcon: matchedDevice
        ? createElement(DeviceBrandIcon, {
            device: matchedDevice.deviceIcon,
            size: 16,
            fallbackIconName: matchedDevice.iconName,
          })
        : undefined,
      onSelect: () => {
        if (target.kind === 'category') onGo(`category:${target.id}`);
        else if (target.kind === 'room') onGo(`room:${target.id}`);
        else if (target.kind === 'camera') onOpenCamera(target.id);
        else if (target.kind === 'scene') onControl(target.id, 'run');
        else onOpenDevice(target.id);
      },
    };
  });
}

export function handleDeviceMenuAction({
  actionId,
  device,
  accessories,
  preferences,
  onControl,
  onFavorite,
  onManage,
  onPreferencesPatch,
  onOpenDetails,
  registry,
  onMoveRoom,
}: {
  readonly actionId: string;
  readonly device: HomeDevice;
  readonly accessories: ReturnType<typeof homeDashboard>['devices'][number]['accessory'][];
  readonly preferences: Preferences;
  readonly available?: typeof availableAction;
  readonly onControl: (id: string, intent: DeviceIntent) => void;
  readonly onFavorite: (id: string, favorite: boolean) => void;
  readonly onManage?: (url: string) => void;
  readonly onPreferencesPatch?: (patch: Partial<Preferences>) => void;
  readonly onOpenDetails: (id: string) => void;
  readonly registry?: Pick<RegistryController, 'updateEntity'>;
  readonly onMoveRoom?: (device: HomeDevice, areaId: string | null) => void;
}): void {
  const { accessory } = device;
  const nextAreaId = resolveMoveRoomAreaId(actionId);
  if (nextAreaId !== undefined) {
    if (onMoveRoom) {
      onMoveRoom(device, nextAreaId);
    } else if (registry) {
      const targets = accessory.lightGroup?.members ?? [accessory];
      void Promise.all(
        targets.map((member) =>
          registry.updateEntity(member.primaryEntityId, { area_id: nextAreaId }),
        ),
      ).catch(() => undefined);
    }
    return;
  }
  switch (actionId) {
    case 'open-browser':
      if (accessory.managementUrl) onManage?.(accessory.managementUrl);
      break;
    case 'quick': {
      const domain = accessory.primaryEntityId.split('.')[0];
      const intent: DeviceIntent = accessory.capabilities.includes('toggle')
        ? 'toggle'
        : ['scene', 'script'].includes(domain)
          ? 'run'
          : 'press';
      onControl(device.id, intent);
      break;
    }
    case 'details':
      onOpenDetails(device.id);
      break;
    case 'ungroup':
      if (accessory.lightGroup) {
        onPreferencesPatch?.(separateLightGroupPatch(accessory.lightGroup.key, preferences));
      }
      break;
    case 'favorite':
      onFavorite(device.id, !device.favorite);
      break;
    case 'toggle-home':
      onPreferencesPatch?.(toggleHomeVisibilityPatch(accessory, accessories, preferences).patch);
      break;
    case 'hide-app':
      onPreferencesPatch?.(toggleAppVisibilityPatch(accessory, accessories, preferences).patch);
      break;
  }
}

export function handleEntityVisibilityAction({
  actionId,
  entityId,
  preferences,
  accessories,
  onPreferencesPatch,
}: {
  readonly actionId: string;
  readonly entityId: string;
  readonly preferences: Preferences;
  readonly accessories: ReturnType<typeof homeDashboard>['devices'][number]['accessory'][];
  readonly onPreferencesPatch?: (patch: Partial<Preferences>) => void;
}): boolean {
  if (actionId === 'toggle-home') {
    onPreferencesPatch?.(toggleHomeVisibilityPatch(entityId, accessories, preferences).patch);
    return true;
  }
  if (actionId === 'hide-app') {
    onPreferencesPatch?.(toggleAppVisibilityPatch(entityId, accessories, preferences).patch);
    return true;
  }
  return false;
}

export function openDeviceContextMenu({
  device,
  home,
  snapshot,
  preferences,
  platform,
  onFallback,
  onCloseFallback,
  onControl,
  onFavorite,
  onManage,
  onPreferencesPatch,
  onOpenDetails,
  registry,
  onMoveRoom,
}: {
  readonly device: HomeDevice;
  readonly home: ReturnType<typeof homeDashboard>;
  readonly snapshot: Snapshot;
  readonly preferences: Preferences;
  readonly platform?: Pick<GpuiPlatform, 'showContextMenu'>;
  readonly onFallback: (menu: ActiveFallbackMenu) => void;
  readonly onCloseFallback: () => void;
  readonly onControl: (id: string, intent: DeviceIntent) => void;
  readonly onFavorite: (id: string, favorite: boolean) => void;
  readonly onManage?: (url: string) => void;
  readonly onPreferencesPatch?: (patch: Partial<Preferences>) => void;
  readonly onOpenDetails: (id: string) => void;
  readonly registry?: Pick<RegistryController, 'updateEntity'>;
  readonly onMoveRoom?: (device: HomeDevice, areaId: string | null) => void;
}): void {
  const { accessory } = device;
  const allAccessories = home.devices.map((item) => item.accessory);
  const items = buildDeviceMenuOptions({
    primaryEntityId: accessory.primaryEntityId,
    areaId: accessory.areaId,
    capabilities: accessory.capabilities,
    isActive: isEntityActive(accessory.state),
    available: accessory.availability === 'available',
    isLightGroup: Boolean(accessory.lightGroup),
    managementUrl: accessory.managementUrl,
    areas: snapshot.areas,
    isAdmin: snapshot.user.is_admin,
    isFavorite: Boolean(device.favorite),
    isHomeHidden: preferences.hiddenHome.includes(accessory.primaryEntityId),
    isAppHidden: preferences.hiddenApp.includes(accessory.primaryEntityId),
  });
  void dispatchContextMenu({
    platform,
    title: device.name,
    items,
    onFallback,
    onSelect: (actionId) => {
      onCloseFallback();
      handleDeviceMenuAction({
        actionId,
        device,
        accessories: allAccessories,
        preferences,
        onControl,
        onFavorite,
        onManage,
        onPreferencesPatch,
        onOpenDetails,
        registry,
        onMoveRoom,
      });
    },
  });
}

export function openSceneContextMenu({
  scene,
  home,
  preferences,
  platform,
  canEdit = true,
  onFallback,
  onCloseFallback,
  onControl,
  onPreviewScene,
  onEditScene,
  onOpenScenes,
  onPreferencesPatch,
}: {
  readonly scene: HassEntity;
  readonly home: ReturnType<typeof homeDashboard>;
  readonly preferences: Preferences;
  readonly platform?: Pick<GpuiPlatform, 'showContextMenu'>;
  readonly canEdit?: boolean;
  readonly onFallback: (menu: ActiveFallbackMenu) => void;
  readonly onCloseFallback: () => void;
  readonly onControl: (id: string, intent: DeviceIntent) => void;
  readonly onPreviewScene?: (scene: HassEntity) => void;
  readonly onEditScene?: (scene: HassEntity) => void;
  readonly onOpenScenes: () => void;
  readonly onPreferencesPatch?: (patch: Partial<Preferences>) => void;
}): void {
  const allAccessories = home.devices.map((item) => item.accessory);
  const items = buildSceneMenuOptions({
    isHomeHidden: preferences.hiddenHome.includes(scene.entity_id),
    isAppHidden: preferences.hiddenApp.includes(scene.entity_id),
    canEdit,
  });
  void dispatchContextMenu({
    platform,
    title: home.sceneCard(scene).name,
    items,
    onFallback,
    onSelect: (actionId) => {
      onCloseFallback();
      if (actionId === 'run') onControl(scene.entity_id, 'run');
      else if (actionId === 'details') {
        if (onPreviewScene) onPreviewScene(scene);
        else onOpenScenes();
      } else if (actionId === 'edit') {
        onEditScene?.(scene);
      } else {
        handleEntityVisibilityAction({
          actionId,
          entityId: scene.entity_id,
          preferences,
          accessories: allAccessories,
          onPreferencesPatch,
        });
      }
    },
  });
}

export function openCameraContextMenu({
  cameraId,
  visibleCameraIds,
  home,
  preferences,
  platform,
  onFallback,
  onCloseFallback,
  onOpenCamera,
  onPreferencesPatch,
}: {
  readonly cameraId: string;
  readonly visibleCameraIds?: readonly string[];
  readonly home: ReturnType<typeof homeDashboard>;
  readonly preferences: Preferences;
  readonly platform?: Pick<GpuiPlatform, 'showContextMenu'>;
  readonly onFallback: (menu: ActiveFallbackMenu) => void;
  readonly onCloseFallback: () => void;
  readonly onOpenCamera: (id: string) => void;
  readonly onPreferencesPatch?: (patch: Partial<Preferences>) => void;
}): void {
  const allAccessories = home.devices.map((item) => item.accessory);
  const allCameraIds = home.allCameras.map((item) => item.id);
  const scopeIds =
    visibleCameraIds && visibleCameraIds.includes(cameraId)
      ? visibleCameraIds
      : home.cameras.some((item) => item.id === cameraId)
        ? home.cameras.map((item) => item.id)
        : allCameraIds;
  const index = scopeIds.indexOf(cameraId);
  const cameraInfo = home.allCameras.find((item) => item.id === cameraId);
  const items = buildCameraMenuOptions({
    index: index >= 0 ? index : undefined,
    total: index >= 0 ? scopeIds.length : undefined,
    isHomeHidden: preferences.hiddenHome.includes(cameraId),
    isAppHidden: preferences.hiddenApp.includes(cameraId),
  });
  void dispatchContextMenu({
    platform,
    title: cameraInfo?.name ?? 'Camera',
    items,
    onFallback,
    onSelect: (actionId) => {
      onCloseFallback();
      if (actionId === 'details') onOpenCamera(cameraId);
      else if (actionId === 'earlier' || actionId === 'later') {
        const patch = buildCameraMovePreferencePatch(
          preferences,
          allCameraIds,
          scopeIds,
          cameraId,
          actionId === 'earlier' ? -1 : 1,
        );
        if (patch) onPreferencesPatch?.(patch);
      } else {
        handleEntityVisibilityAction({
          actionId,
          entityId: cameraId,
          preferences,
          accessories: allAccessories,
          onPreferencesPatch,
        });
      }
    },
  });
}

export type SceneContextMenuInput = HassEntity;
