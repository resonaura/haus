import type { HassEntity, HausAccessory, HausModel, Snapshot } from './types';
import type { Preferences } from './preferences';
import { categories } from './categories';
import { accessoryVisibilityIds } from './visibility';
import { groupNumberedLights } from './room-devices';
import { sceneViews, scenePresentation, sortScenesByName } from './scene-presentation';
export const serviceRoomRank = (room: { id: string; name: string }) =>
  room.id === 'unassigned' || /^unassigned$/i.test(room.name)
    ? 2
    : /^(system|home\s*assistant|система)$/i.test(room.name)
      ? 1
      : 0;

export type HomeViewInput = {
  model: HausModel;
  snapshot: Snapshot;
  preferences: Preferences;
  route: { kind: string };
  search: string;
  selectedLightGroup: { key: string; memberIds: string[] } | null;
};
/** Derive view state from HA data without mutating registries, devices or preferences. */
export function buildHomeView({
  model,
  snapshot,
  preferences,
  route,
  search,
  selectedLightGroup,
}: HomeViewInput) {
  const isHomeOverview = route.kind === 'home' || route.kind === 'category';
  const owners = new Map<string, HausAccessory>();
  for (const accessory of model.accessories)
    for (const id of accessory.entityIds) if (!owners.has(id)) owners.set(id, accessory);
  const rooms = new Map(model.rooms.map((room) => [room.id, room]));
  const areas = new Map(snapshot.areas.map((area) => [area.area_id, area]));
  const hiddenAppIds = new Set(preferences.hiddenApp);
  const unhiddenAppIds = new Set(preferences.unhiddenApp ?? []);
  const hiddenHomeIds = new Set(preferences.hiddenHome);
  const includesAny = (ids: readonly string[], selectedIds: ReadonlySet<string>) =>
    ids.some((id) => selectedIds.has(id));
  const appHidden = (a: HausAccessory) =>
    a.defaultHidden
      ? !includesAny(accessoryVisibilityIds(a), unhiddenAppIds)
      : includesAny(accessoryVisibilityIds(a), hiddenAppIds);
  const homeHidden = (a: HausAccessory) => includesAny(accessoryVisibilityIds(a), hiddenHomeIds);
  const isFavorite = (a: HausAccessory) =>
    a.entityIds.some((id) => preferences.favorites.includes(id));
  const visibleAccessories = model.accessories.filter((a) => !appHidden(a));
  const homeAccessories = visibleAccessories.filter((a) => !homeHidden(a));
  const lightGroup =
    selectedLightGroup &&
    groupNumberedLights(
      (isHomeOverview ? homeAccessories : visibleAccessories).filter((item) =>
        selectedLightGroup.memberIds.includes(item.id),
      ),
      preferences.autoGroupLights !== false,
      preferences.disabledLightGroups,
    ).find((item) => item.lightGroup?.key === selectedLightGroup.key);
  const hiddenAccessories = model.accessories.filter(
    (a) => appHidden(a) && a.primaryEntityId.split('.')[0] !== 'camera',
  );
  const navigationCategories = categories.filter(
    (category) =>
      ['climate', 'lights', 'security', 'media', 'water'].includes(category.id) ||
      visibleAccessories.some((accessory) => accessory.category === category.id),
  );
  const cameraOwner = (camera: HassEntity) => owners.get(camera.entity_id);
  const appCameras = model.cameras.filter((camera) => {
    const owner = cameraOwner(camera);
    return owner ? !appHidden(owner) : !hiddenAppIds.has(camera.entity_id);
  });
  const camerasForRoom = (areaId: string) =>
    appCameras.filter((camera) => cameraOwner(camera)?.areaId === areaId);
  const hiddenCameras = model.cameras.filter((camera) => {
    const owner = cameraOwner(camera);
    return owner ? appHidden(owner) : hiddenAppIds.has(camera.entity_id);
  });
  const {
    visible: appScenes,
    home: homeVisibleScenes,
    hidden: hiddenScenes,
  } = sceneViews(model.scenes, hiddenAppIds, hiddenHomeIds);
  const scenePlacements = new Map(
    model.scenePlacements.map((placement) => [placement.sceneId, placement]),
  );
  const likelyActiveSceneIds = new Set<string>();
  for (const placement of model.scenePlacements) {
    if (placement.active) likelyActiveSceneIds.add(placement.sceneId);
  }
  const scenesForRoom = (areaId: string, homeView = false) =>
    (homeView ? homeVisibleScenes : appScenes).filter(
      (scene) =>
        scenePlacements.get(scene.entity_id)?.scope === 'room' &&
        scenePlacements.get(scene.entity_id)?.areaId === areaId,
    );
  const sortedHomeScenes = sortScenesByName(
    homeVisibleScenes,
    (scene) => rooms.get(scenePlacements.get(scene.entity_id)?.areaId ?? '')?.name,
  );
  const hiddenCameraMatches = hiddenCameras.filter(
    (camera) =>
      !search ||
      String(camera.attributes.friendly_name ?? camera.entity_id)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const hiddenSceneMatches = hiddenScenes.filter((scene) => {
    const info = scenePresentation(scene);
    return (
      !search || `${info.name} ${info.source ?? ''}`.toLowerCase().includes(search.toLowerCase())
    );
  });
  const hiddenCount = hiddenAccessories.length + hiddenCameras.length + hiddenScenes.length;
  const homeIds = new Set(homeAccessories.map((a) => a.id));
  const orderedRooms = [...model.rooms].sort((a, b) => serviceRoomRank(a) - serviceRoomRank(b));
  const homeRooms = orderedRooms
    .map((item) => ({ ...item, accessories: item.accessories.filter((a) => homeIds.has(a.id)) }))
    .filter((item) => item.accessories.length > 0 || scenesForRoom(item.id, true).length > 0);
  const navigationRooms = orderedRooms.filter(
    (item) => item.accessories.some((a) => !appHidden(a)) || scenesForRoom(item.id).length > 0,
  );
  const appAttention = model.attention.filter((item) => {
    const owner = owners.get(item.entityId);
    return !hiddenAppIds.has(item.entityId) && (!owner || !appHidden(owner));
  });
  const homeAttention = appAttention.filter((item) => {
    const owner = owners.get(item.entityId);
    return !owner || !homeHidden(owner);
  });
  const homeCameras = appCameras.filter((camera) => {
    const owner = cameraOwner(camera);
    return owner ? !homeHidden(owner) : !hiddenHomeIds.has(camera.entity_id);
  });
  const homeCamerasForRoom = (areaId: string) =>
    homeCameras.filter((camera) => cameraOwner(camera)?.areaId === areaId);
  const searchCameras =
    search && route.kind !== 'hidden'
      ? (route.kind === 'home' ? homeCameras : appCameras).filter((camera) => {
          const owner = cameraOwner(camera);
          const roomName = rooms.get(owner?.areaId ?? '')?.name ?? '';
          return `${camera.attributes.friendly_name ?? ''} ${camera.entity_id} ${owner?.name ?? ''} ${roomName}`
            .toLowerCase()
            .includes(search.toLowerCase());
        })
      : [];
  const indoorTemperatureReading = homeAccessories
    .flatMap((item) => {
      const roomName = areas.get(item.areaId ?? '')?.name ?? '';
      return [item.state, ...item.secondaryEntities].flatMap((entity) => {
        const domain = entity.entity_id.split('.')[0];
        const isClimate = domain === 'climate';
        const isTemperatureSensor =
          domain === 'sensor' && entity.attributes.device_class === 'temperature';
        const value = isClimate
          ? entity.attributes.current_temperature
          : isTemperatureSensor
            ? entity.state
            : undefined;
        if (value === undefined || value === null || value === 'unknown' || value === 'unavailable')
          return [];
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) return [];
        const context = `${roomName} ${entity.attributes.friendly_name ?? ''} ${entity.entity_id}`;
        const isOutdoor = /outdoor|outside|garden|patio|garage|балкон|улиц/i.test(context);
        const score =
          (isOutdoor ? -8 : 0) +
          (/living|lounge|family|inside|indoor|wohnzimmer|woonkamer|гостин|зал/i.test(context)
            ? 4
            : 0) +
          (isClimate ? 1 : 0);
        return [
          {
            value,
            score,
            unit:
              entity.attributes.temperature_unit ??
              entity.attributes.unit_of_measurement ??
              snapshot.config.unit_system?.temperature ??
              '°',
            entityId: entity.entity_id,
          },
        ];
      });
    })
    .sort((a, b) => b.score - a.score || a.entityId.localeCompare(b.entityId))[0];
  const indoorTemperature = indoorTemperatureReading
    ? `${indoorTemperatureReading.value}${indoorTemperatureReading.unit}`
    : '—';

  return {
    hiddenAppIds,
    hiddenHomeIds,
    appHidden,
    homeHidden,
    isFavorite,
    visibleAccessories,
    homeAccessories,
    lightGroup,
    hiddenAccessories,
    navigationCategories,
    cameraOwner,
    appCameras,
    camerasForRoom,
    likelyActiveSceneIds,
    scenesForRoom,
    sortedHomeScenes,
    hiddenCameraMatches,
    hiddenSceneMatches,
    hiddenCount,
    orderedRooms,
    homeRooms,
    navigationRooms,
    appAttention,
    homeAttention,
    homeCameras,
    homeCamerasForRoom,
    searchCameras,
    indoorTemperature,
    appScenes,
    homeVisibleScenes,
  };
}

export type HomeView = ReturnType<typeof buildHomeView>;
