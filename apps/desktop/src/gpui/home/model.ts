/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { buildInventoryRecords } from '@haus/core/transport';
import type { HassEntity, HausAction, Snapshot } from '@haus/ha/types';
import type { HausAccessory } from '@haus/ha/view/types';
import { buildAction } from '@haus/ha/view/controls/action';
import { normalizeHome } from '@haus/ha/view/normalize';
import { buildHomeView, roomTemperatureFor } from '@haus/ha/view/home-view';
import { describeAccessory } from '@haus/ha/view/presentation';
import { deviceDisplayName } from '@haus/ha/view/device-name';
import { deviceTelemetryRegistry } from '@haus/ha/view/device-telemetry';
import { resolveDeviceHausId } from '@haus/ha/view/device-identity';
import { deviceArea } from '@haus/ha/view/registry';
import { groupNumberedLights, orderRoomDevices } from '@haus/ha/view/room-devices';
import { accessoriesForCategory, homeCategorySummaries } from '@haus/ha/view/categories';
import { homeControls } from '@haus/ha/view/controls/home';
import { groupScenes, sceneCard } from '@haus/ha/view/scene-presentation';
import { isEntityActive } from '@haus/ha/view/device-state';
import { lightColor } from '@haus/ha/light-color';
import type { Preferences } from '@haus/ha/view/preferences';
import { setAccessoryFavorite } from '@haus/ha/view/settings/shared';
import { getCategoryMetadata } from '@haus/ui/categories';
import type { DeviceTileData } from '@haus/ui/components';

export interface HomeDevice extends DeviceTileData {
  readonly id: string;
  readonly accessory: HausAccessory;
  readonly accent?: string;
}

export interface HomeRoom {
  readonly id: string;
  readonly name: string;
  readonly devices: readonly HomeDevice[];
}

export function lightCommand(snapshot: Snapshot, id: string) {
  const entity = snapshot.states.find((state) => state.entity_id === id);
  if (
    !id.startsWith('light.') ||
    (entity?.state !== 'on' && entity?.state !== 'off') ||
    !snapshot.services.light?.turn_on ||
    !snapshot.services.light?.turn_off
  )
    return undefined;
  return {
    type: 'call_service',
    domain: 'light',
    service: entity.state === 'on' ? 'turn_off' : 'turn_on',
    target: { entity_id: id },
  };
}

function dashboardView(
  snapshot: Snapshot,
  preferences: Preferences,
  model = normalizeHome(snapshot),
) {
  return buildHomeView({
    model,
    snapshot,
    preferences,
    route: { kind: 'home' },
    search: '',
    selectedLightGroup: null,
  });
}

export function updateFavorite(
  snapshot: Snapshot,
  preferences: Preferences,
  id: string,
  favorite: boolean,
): Preferences | undefined {
  const view = dashboardView(snapshot, preferences);
  const accessory = view.visibleAccessories.find(
    (item) => item.primaryEntityId === id || item.entityIds.includes(id),
  );
  if (!accessory || view.isFavorite(accessory) === favorite) return undefined;
  return {
    ...preferences,
    favorites: setAccessoryFavorite(preferences.favorites, accessory, favorite),
  };
}

export function buildGpuiInventory(snapshot: Snapshot, accessories: readonly HausAccessory[]) {
  const telemetryRegistry = deviceTelemetryRegistry(snapshot);
  return buildInventoryRecords({
    devices: snapshot.devices,
    entities: snapshot.entities,
    states: snapshot.states,
    accessories,
    effectiveEntities: telemetryRegistry.values(),
    resolveEffectiveEntity: (entityId) => telemetryRegistry.get(entityId),
    resolveAreaId: deviceArea,
    resolveHausId: ({ device, category, areaId, used }) =>
      resolveDeviceHausId(device, snapshot, { category, areaId, used }),
  });
}

export function homeDashboard(snapshot: Snapshot, preferences: Preferences) {
  const model = normalizeHome(snapshot);
  const view = dashboardView(snapshot, preferences, model);
  const areasById = new Map(snapshot.areas.map((area) => [area.area_id, area.name]));
  const roomNameForEntity = (entityId: string): string | undefined => {
    const entry = snapshot.entities.find((item) => item.entity_id === entityId);
    const areaId =
      entry?.area_id ??
      (entry?.device_id
        ? snapshot.devices.find((item) => item.id === entry.device_id)?.area_id
        : undefined);
    return areaId ? areasById.get(areaId) : undefined;
  };
  const cameraCard = (camera: HassEntity) => {
    const name =
      typeof camera.attributes.friendly_name === 'string'
        ? camera.attributes.friendly_name
        : camera.entity_id;
    const room = roomNameForEntity(camera.entity_id);
    const demoScene =
      typeof camera.attributes.demo_scene === 'string' ? camera.attributes.demo_scene : undefined;
    return {
      id: camera.entity_id,
      name,
      room,
      label: deviceDisplayName(name, room, 'Camera'),
      demoScene,
      available: camera.state !== 'unknown' && camera.state !== 'unavailable',
    };
  };
  const cameras = view.homeCameras.map(cameraCard);
  const isDevice = (item: HausAccessory) => !item.primaryEntityId.startsWith('camera.');
  const tile = (item: HausAccessory): HomeDevice => ({
    id: item.primaryEntityId,
    accessory: item,
    name: item.name,
    category: item.category,
    categoryLabel: getCategoryMetadata(item.category).label,
    state: describeAccessory(item),
    available: item.availability === 'available',
    favorite: view.isFavorite(item),
    accent: isEntityActive(item.state) ? lightColor(item.state) : undefined,
  });
  const tiles = (items: HausAccessory[], scope?: string) =>
    orderRoomDevices(
      groupNumberedLights(
        items.filter(isDevice),
        preferences.autoGroupLights !== false,
        preferences.disabledLightGroups,
      ),
      preferences,
      scope ? preferences.deviceOrder?.[scope] : undefined,
    ).map(tile);
  const rooms: HomeRoom[] = view.homeRooms.flatMap((room) => {
    const accessories = room.accessories.filter(isDevice);
    if (!accessories.length) return [];
    return [{ id: room.id, name: room.name, devices: tiles(accessories, `home:room:${room.id}`) }];
  });
  const quick = homeControls(view.homeAccessories, preferences.favorites, preferences.manualUsage);
  const inventory = buildGpuiInventory(snapshot, model.accessories);
  const categories = homeCategorySummaries(
    view.navigationCategories,
    view.homeAccessories,
    snapshot.services,
    view.indoorTemperature,
  ).map(({ accessories, ...category }) => ({ ...category, devices: tiles(accessories) }));
  return {
    rooms,
    cameras,
    allCameras: view.appCameras.map(cameraCard),
    allAccessories: model.accessories,
    navigationRooms: view.navigationRooms,
    inventory,
    registeredDeviceCount: inventory.length,
    roomDevices: (id: string) =>
      tiles(view.visibleAccessories.filter((item) => item.areaId === id)),
    roomRawAccessories: (id: string) =>
      view.visibleAccessories.filter((item) => item.areaId === id && isDevice(item)),
    roomDevicesForCategory: (id: string, categoryId: string) =>
      tiles(
        accessoriesForCategory(
          view.visibleAccessories.filter((item) => item.areaId === id),
          categoryId,
          { services: snapshot.services, excludeCameras: true },
        ),
      ),
    roomTemperature: (id: string) =>
      roomTemperatureFor(
        view.visibleAccessories.filter((item) => item.areaId === id),
        snapshot,
      ),
    devices: tiles(view.visibleAccessories),
    hiddenAccessories: view.hiddenAccessories,
    hiddenDevices: tiles(view.hiddenAccessories),
    hiddenCameras: view.hiddenCameraMatches.map(cameraCard),
    hiddenScenes: view.hiddenSceneMatches,
    hiddenCount: view.hiddenCount,
    favorites: tiles(view.visibleAccessories.filter(view.isFavorite)),
    quick: { cards: quick.controls.map(tile), usingFavorites: quick.usingFavorites },
    categories,
    sceneGroups: groupScenes(view.appScenes, model),
    sceneCard: (scene: HassEntity) => sceneCard(scene, snapshot, model),
    homeScenes: view.sortedHomeScenes,
    attention: view.appAttention,
    homeAttention: view.homeAttention,
    roomScenes: view.scenesForRoom,
    roomCameras: (id: string) => view.camerasForRoom(id).map(cameraCard),
    automations: snapshot.states.filter((entity) => entity.entity_id.startsWith('automation.')),
  };
}

export type DeviceIntent =
  | 'toggle'
  | 'press'
  | 'run'
  | 'brightness'
  | 'color'
  | 'temperature'
  | 'effect'
  | 'hvac-mode'
  | 'climate-temperature'
  | 'water-temperature'
  | 'heater-mode'
  | 'play-pause'
  | 'volume'
  | 'remote-command'
  | 'media-next'
  | 'media-previous'
  | 'open'
  | 'close'
  | 'stop'
  | 'lock'
  | 'unlock'
  | 'select'
  | 'percentage'
  | 'value'
  | 'position'
  | 'update-install'
  | 'update-skip';

export function availableAction(
  snapshot: Snapshot,
  id: string,
  intent: DeviceIntent,
  value?: unknown,
): HausAction | undefined {
  const entity = snapshot.states.find((candidate) => candidate.entity_id === id);
  if (!entity) return undefined;
  try {
    if (intent === 'remote-command') {
      if (['unavailable', 'unknown'].includes(entity.state)) return undefined;
      if (!Object.hasOwn(snapshot.services.remote ?? {}, 'send_command')) return undefined;
      return {
        domain: 'remote',
        service: 'send_command',
        target: { entity_id: id },
        service_data: { command: String(value ?? ''), delay_secs: 0 },
      };
    }
    if (intent === 'media-next' || intent === 'media-previous') {
      const service = intent === 'media-next' ? 'media_next_track' : 'media_previous_track';
      if (['unavailable', 'unknown'].includes(entity.state)) return undefined;
      if (!Object.hasOwn(snapshot.services.media_player ?? {}, service)) return undefined;
      return { domain: 'media_player', service, target: { entity_id: id } };
    }
    const action = buildAction(entity, intent, value);
    return Object.hasOwn(snapshot.services[action.domain] ?? {}, action.service)
      ? action
      : undefined;
  } catch {
    return undefined;
  }
}
