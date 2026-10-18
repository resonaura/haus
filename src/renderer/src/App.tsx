import { version as appVersion } from '../../../package.json';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Button, Modal, ScrollShadow, Switch } from '@heroui/react';
import {
  Archive,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Activity,
  Bell,
  Check,
  ChevronRight,
  Command,
  ExternalLink,
  Eye,
  Heart,
  House,
  LayoutGrid,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Moon,
  Plus,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Wifi,
  X,
  Zap,
  Cable,
  Box,
  RefreshCw,
} from 'lucide-react';
import { deviceDisplayName, deviceSource } from './model/device-name';
import { useHaus, message } from './hooks/useHaus';
import { useNativeSidebar } from './hooks/useNativeSidebar';
import { useDelayedPending } from './hooks/useDelayedPending';
import { useHomeNotifications } from './hooks/useHomeNotifications';
import { buildAction, generateDashboard, type HausAccessory, type HassEntity } from './model';
import { AccessoryIcon, categoryIcons, roomIcons, SceneIcon } from './components/Icon';
import { HAUS_DASHBOARD_PATH, syncDashboard } from './ha/dashboard-sync';
import { DeviceControl } from './components/DeviceControl';
import { CameraCard, CameraModal, CameraPreview } from './components/Camera';
import { LightGroupControl } from './components/LightGroupControl';
import { StatisticsPanel } from './components/StatisticsPanel';
import { AddDeviceFlow, ConnectionsPage, DeviceInventory } from './components/Management';
import { ServerMarkdown } from './components/ServerMarkdown';
import { SceneCollection } from './components/Scenes';
import { HomeCategoryDock } from './components/HomeCategoryDock';
import { VirtualSections } from './components/VirtualSections';
import {
  binaryStateDescription,
  deviceAppearance,
  isEntityActive,
} from './model/device-appearance';
import { lightStateDescription } from './model/light-profile';
import { homeControls, stableQuickControls } from './model/home-controls';
import { scenePresentation, sceneViews, sortScenesByName } from './model/scene-presentation';
import { accessoryVisibilityIds, visibilityTarget } from './model/visibility';
import {
  groupNumberedLights,
  lightGroupActions,
  lightGroupDescription,
  orderRoomDevices,
  roomDevicePriority,
} from './model/room-devices';
import type { DiscoveredServer, ContextMenuItem } from '../../shared/native';

type Route =
  | {
      kind:
        | 'home'
        | 'automations'
        | 'scenes'
        | 'cameras'
        | 'attention'
        | 'settings'
        | 'statistics'
        | 'favorites'
        | 'hidden'
        | 'devices'
        | 'integrations'
        | 'addons';
    }
  | { kind: 'room' | 'category'; id: string };
const categories = [
  { id: 'climate', name: 'Climate' },
  { id: 'lights', name: 'Lights' },
  { id: 'security', name: 'Security' },
  { id: 'media', name: 'Speakers & TVs' },
  { id: 'water', name: 'Water' },
  { id: 'outlets', name: 'Sockets' },
  { id: 'covers', name: 'Covers' },
  { id: 'printers', name: 'Printers' },
  { id: 'network', name: 'Network' },
  { id: 'other', name: 'Other devices' },
];
const titleCase = (text: string) =>
  text.replaceAll('_', ' ').replace(/\b\w/g, (s) => s.toUpperCase());
const serviceRoomRank = (room: { id: string; name: string }) =>
  room.id === 'unassigned' || /^unassigned$/i.test(room.name)
    ? 2
    : /^(system|home\s*assistant|система)$/i.test(room.name)
      ? 1
      : 0;
const formatLastUsed = (timestamp: number) => {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 172_800_000) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(timestamp),
  );
};
const isActive = (a: HausAccessory) => isEntityActive(a.state);
function describe(a: HausAccessory): string {
  if (a.lightGroup) return lightGroupDescription(a);
  if (a.availability !== 'available') return titleCase(a.availability);
  const s = a.state;
  const domain = s.entity_id.split('.')[0];
  if (domain === 'light') return lightStateDescription(s);
  if (domain === 'binary_sensor') return binaryStateDescription(s) ?? titleCase(s.state);
  if (domain === 'climate')
    return `${s.attributes.current_temperature ?? s.attributes.temperature ?? '—'}° · ${titleCase(s.state)}`;
  if (domain === 'media_player')
    return s.state === 'playing'
      ? String(s.attributes.media_title ?? 'Playing')
      : titleCase(s.state);
  if (domain === 'sensor') return `${s.state}${s.attributes.unit_of_measurement ?? ''}`;
  if (domain === 'button' || domain === 'input_button') {
    const timestamp = Date.parse(s.state);
    return Number.isFinite(timestamp)
      ? `Last pressed ${formatLastUsed(timestamp)}`
      : 'Ready to press';
  }
  if (domain === 'cover' && s.attributes.current_position != null)
    return `${s.attributes.current_position}% open`;
  return titleCase(s.state);
}

export function App() {
  const haus = useHaus();
  const { snapshot, model, mode, status, preferences, notify } = haus;
  const homeNotices = useHomeNotifications(
    snapshot,
    mode === 'live' && status === 'connected',
    haus.session?.url,
  );
  const [route, setRoute] = useState<Route>({ kind: 'home' });
  const isHomeOverview = route.kind === 'home' || route.kind === 'category';
  const [selected, setSelected] = useState<string | null>(null);
  const [controllerEntityId, setControllerEntityId] = useState<string | null>(null);
  const [camera, setCamera] = useState<HassEntity | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [addDeviceOpen, setAddDeviceOpen] = useState(false);
  const [dashboardBusy, setDashboardBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useNativeSidebar(sidebarOpen);
  const [roomCategory, setRoomCategory] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    scopeKey: string;
    draggedId: string;
    overId: string | null;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    items: ContextMenuItem[];
    x: number;
    y: number;
    accessory: HausAccessory;
  } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const accessory = model.accessories.find((a) => a.primaryEntityId === selected);
  const [selectedLightGroup, setSelectedLightGroup] = useState<{
    key: string;
    memberIds: string[];
  } | null>(null);
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
  const cameraOwner = (camera: HassEntity) =>
    model.accessories.find((item) => item.entityIds.includes(camera.entity_id));
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
    (scene) =>
      model.rooms.find((room) => room.id === scenePlacements.get(scene.entity_id)?.areaId)?.name,
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
    const owner = model.accessories.find((a) => a.entityIds.includes(item.entityId));
    return !hiddenAppIds.has(item.entityId) && (!owner || !appHidden(owner));
  });
  const homeAttention = appAttention.filter((item) => {
    const owner = model.accessories.find((a) => a.entityIds.includes(item.entityId));
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
          const roomName = model.rooms.find((item) => item.id === owner?.areaId)?.name ?? '';
          return `${camera.attributes.friendly_name ?? ''} ${camera.entity_id} ${owner?.name ?? ''} ${roomName}`
            .toLowerCase()
            .includes(search.toLowerCase());
        })
      : [];
  const indoorTemperatureReading = homeAccessories
    .flatMap((item) => {
      const roomName = snapshot.areas.find((area) => area.area_id === item.areaId)?.name ?? '';
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
  const dashboardUrl =
    haus.session && preferences.hausDashboard
      ? `${haus.session.url}/${preferences.hausDashboard.urlPath}`
      : '';
  const room = route.kind === 'room' ? model.rooms.find((r) => r.id === route.id) : undefined;
  const roomCameras = route.kind === 'room' ? camerasForRoom(route.id) : [];
  const roomTemperatureSensor = room
    ? snapshot.states.find(
        (state) =>
          state.attributes.device_class === 'temperature' &&
          room.accessories.some((item) => item.entityIds.includes(state.entity_id)),
      )
    : undefined;
  const roomClimate = room?.accessories.find((item) => item.primaryEntityId.startsWith('climate.'));
  const roomTemperature =
    roomTemperatureSensor?.state ?? roomClimate?.state.attributes.current_temperature;
  const roomTemperatureUnit =
    roomTemperatureSensor?.attributes.unit_of_measurement ??
    roomClimate?.state.attributes.temperature_unit ??
    snapshot.config.unit_system?.temperature ??
    '°';
  const roomTemperatureLabel =
    roomTemperature === undefined || roomTemperature === null || roomTemperature === 'unknown'
      ? '—'
      : `${roomTemperature}${roomTemperatureUnit}`;
  const heading =
    route.kind === 'home'
      ? 'Welcome home.'
      : route.kind === 'room'
        ? (room?.name ?? 'Room')
        : route.kind === 'category'
          ? (categories.find((c) => c.id === route.id)?.name ?? titleCase(route.id))
          : route.kind === 'addons'
            ? 'Add-ons'
            : titleCase(route.kind);
  const go = (next: Route) => {
    setRoute(next);
    setSearch('');
    setSidebarOpen(false);
    setRoomCategory(null);
    scrollRef.current?.scrollTo({ top: 0 });
  };
  useEffect(() => {
    setRoomCategory(null);
  }, [route]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setSearchOpen((prev) => !prev);
        setTimeout(() => searchRef.current?.focus(), 30);
      }
      if (event.key === 'Escape') {
        setContextMenu(null);
        setSearchOpen(false);
        setSearch('');
      }
    };
    const closeContext = () => setContextMenu(null);
    window.addEventListener('keydown', listener);
    window.addEventListener('click', closeContext);
    window.addEventListener('blur', closeContext);
    return () => {
      window.removeEventListener('keydown', listener);
      window.removeEventListener('click', closeContext);
      window.removeEventListener('blur', closeContext);
    };
  }, []);
  const run = async (action: ReturnType<typeof buildAction>) => {
    try {
      await haus.act(action);
      if (mode === 'demo' || action.target.entity_id.startsWith('scene.'))
        haus.recordManualUse(action.target.entity_id);
    } catch (error) {
      notify(message(error));
      throw error;
    }
  };
  const runLightGroup = async (item: HausAccessory, action: ReturnType<typeof buildAction>) => {
    const commands = lightGroupActions(item, action);
    const results = await Promise.allSettled(commands.map((command) => haus.act(command)));
    if (mode === 'demo')
      for (let index = 0; index < results.length; index++)
        if (results[index].status === 'fulfilled')
          haus.recordManualUse(commands[index].target.entity_id);
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed) {
      const error = new Error(
        `${failed} of ${commands.length} lights could not be updated. Device states show the actual result.`,
      );
      notify(error.message);
      throw error;
    }
  };
  const separateLights = (item: HausAccessory) => {
    if (!item.lightGroup) return;
    haus.savePreferences({
      disabledLightGroups: [
        ...new Set([...(preferences.disabledLightGroups ?? []), item.lightGroup.key]),
      ],
    });
    setSelectedLightGroup(null);
    notify(`${item.name} lights are now shown separately.`);
  };
  const visibilityTargetName = (target: string | HausAccessory) => {
    if (typeof target !== 'string') return target.name;
    const scene = model.scenes.find((item) => item.entity_id === target);
    return scene
      ? scenePresentation(scene).name
      : (visibilityTarget(target, model.accessories).accessory?.name ?? 'Accessory');
  };
  const restoreFromApp = (target: string | HausAccessory) => {
    const { accessory, id, entityIds: ids } = visibilityTarget(target, model.accessories);
    const isDefaultHidden = accessory?.defaultHidden;
    haus.savePreferences({
      hiddenApp: preferences.hiddenApp.filter((item) => !ids.includes(item)),
      unhiddenApp: isDefaultHidden
        ? Array.from(new Set([...(preferences.unhiddenApp ?? []), id]))
        : (preferences.unhiddenApp ?? []),
    });
    const name = visibilityTargetName(target);
    notify(`${name} restored to the app.`);
  };
  const toggleAppVisibility = (target: string | HausAccessory) => {
    const { accessory, id, entityIds: ids } = visibilityTarget(target, model.accessories);
    const isCurrentlyHidden = accessory
      ? appHidden(accessory)
      : ids.some((memberId) => hiddenAppIds.has(memberId));
    if (isCurrentlyHidden) {
      const nextHiddenApp = preferences.hiddenApp.filter((item) => !ids.includes(item));
      const nextUnhiddenApp = accessory?.defaultHidden
        ? Array.from(new Set([...(preferences.unhiddenApp ?? []), id]))
        : (preferences.unhiddenApp ?? []);
      haus.savePreferences({
        hiddenApp: nextHiddenApp,
        unhiddenApp: nextUnhiddenApp,
      });
      setSelected(null);
      notify(`${visibilityTargetName(target)} restored to the app.`);
    } else {
      const nextHiddenApp = Array.from(
        new Set([...preferences.hiddenApp, ...(accessory?.lightGroup ? ids : [id])]),
      );
      const nextUnhiddenApp = (preferences.unhiddenApp ?? []).filter((item) => !ids.includes(item));
      haus.savePreferences({
        hiddenApp: nextHiddenApp,
        unhiddenApp: nextUnhiddenApp,
      });
      setSelected(null);
      notify(
        `${visibilityTargetName(target)} hidden from Haus. You can restore it in Hidden at any time.`,
      );
    }
  };
  const toggleHomeVisibility = (target: string | HausAccessory) => {
    const { id, entityIds: ids } = visibilityTarget(target, model.accessories);
    const hidden = ids.some((memberId) => hiddenHomeIds.has(memberId));
    haus.savePreferences({
      hiddenHome: hidden
        ? preferences.hiddenHome.filter((item) => !ids.includes(item))
        : [
            ...preferences.hiddenHome,
            ...(typeof target !== 'string' && target.lightGroup ? ids : [id]),
          ],
    });
    const name = visibilityTargetName(target);
    notify(hidden ? `${name} shown on Home.` : `${name} hidden from Home view.`);
  };
  const openAccessory = (item: HausAccessory) => {
    if (item.lightGroup) {
      setSelectedLightGroup({
        key: item.lightGroup.key,
        memberIds: item.lightGroup.members.map((member) => member.id),
      });
      return;
    }
    if (item.primaryEntityId.split('.')[0] === 'camera') {
      setCamera(item.state);
      return;
    }
    const owner = model.accessories.find((candidate) =>
      candidate.entityIds.includes(item.primaryEntityId),
    );
    setControllerEntityId(item.primaryEntityId);
    setSelected(owner?.primaryEntityId ?? item.primaryEntityId);
  };
  const quick = async (a: HausAccessory) => {
    if (a.lightGroup) {
      try {
        await runLightGroup(a, buildAction(a.state, 'toggle'));
      } catch {
        /* shown in toast */
      }
      return;
    }
    const domain = a.primaryEntityId.split('.')[0];
    const intent = a.capabilities.includes('toggle')
      ? 'toggle'
      : ['scene', 'script'].includes(domain)
        ? 'run'
        : ['button', 'input_button'].includes(domain) && a.capabilities.includes('press')
          ? 'press'
          : undefined;
    if (!intent) {
      openAccessory(a);
      return;
    }
    try {
      await run(buildAction(a.state, intent));
    } catch {
      /* shown in toast */
    }
  };
  const sceneRun = async (scene: HassEntity) => {
    await run(buildAction(scene, 'run'));
    notify(`${scenePresentation(scene).name} applied`);
  };
  const openServer = (path: string) => {
    if (!haus.session || !window.hausNative) {
      notify('Connect Home Assistant to manage your home.');
      setConnectOpen(true);
      return;
    }
    void window.hausNative
      .openExternal(`${haus.session.url}${path}`)
      .catch((error) => notify(message(error)));
  };
  const toggleFavorite = (item: HausAccessory) => {
    haus.savePreferences({
      favorites: isFavorite(item)
        ? preferences.favorites.filter((id) => !item.entityIds.includes(id))
        : [
            ...preferences.favorites,
            ...(item.lightGroup?.members.map((member) => member.primaryEntityId) ?? [
              item.primaryEntityId,
            ]),
          ],
    });
  };
  const handleContextAction = useCallback(
    (actionId: string, item: HausAccessory) => {
      setContextMenu(null);
      switch (actionId) {
        case 'ungroup':
          separateLights(item);
          break;
        case 'quick':
          void quick(item);
          break;
        case 'details':
          openAccessory(item);
          break;
        case 'favorite':
          toggleFavorite(item);
          break;
        case 'toggle-home':
          toggleHomeVisibility(item);
          break;
        case 'hide-app':
          toggleAppVisibility(item);
          break;
      }
    },
    [quick, openAccessory, toggleFavorite, toggleHomeVisibility, toggleAppVisibility],
  );
  const showAccessoryContextMenu = useCallback(
    async (event: React.MouseEvent, item: HausAccessory) => {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      const active = isActive(item);
      const domain = item.primaryEntityId.split('.')[0];
      const quickLabel = item.capabilities.includes('toggle')
        ? active
          ? 'Turn Off'
          : 'Turn On'
        : ['scene', 'script'].includes(domain)
          ? 'Run'
          : ['button', 'input_button'].includes(domain) && item.capabilities.includes('press')
            ? 'Press'
            : undefined;
      const favored = isFavorite(item);
      const homeHiddenState = homeHidden(item);

      const menuItems: ContextMenuItem[] = [
        ...(quickLabel
          ? [
              { id: 'quick', label: quickLabel, enabled: item.availability === 'available' },
              { id: 'sep1', label: '', type: 'separator' as const },
            ]
          : []),
        { id: 'details', label: 'Accessory Details...' },
        ...(item.lightGroup ? [{ id: 'ungroup', label: 'Show Lights Separately' }] : []),
        { id: 'favorite', label: favored ? 'Remove from Favorites' : 'Add to Favorites' },
        { id: 'sep2', label: '', type: 'separator' as const },
        {
          id: 'toggle-home',
          label: homeHiddenState ? 'Show on Home View' : 'Hide from Home View',
        },
        {
          id: 'hide-app',
          label: appHidden(item) ? 'Restore to Haus' : 'Hide from Haus',
        },
      ];

      if (window.hausNative?.showContextMenu) {
        const selectedId = await window.hausNative.showContextMenu(menuItems);
        if (selectedId) {
          handleContextAction(selectedId, item);
        }
      } else {
        const clickX = event.clientX;
        const clickY = event.clientY;
        const menuWidth = 200;
        const menuHeight = 220;
        const x =
          clickX + menuWidth > window.innerWidth
            ? Math.max(10, window.innerWidth - menuWidth - 10)
            : clickX;
        const y =
          clickY + menuHeight > window.innerHeight
            ? Math.max(10, window.innerHeight - menuHeight - 10)
            : clickY;
        setContextMenu({
          items: menuItems,
          x,
          y,
          accessory: item,
        });
      }
    },
    [handleContextAction, isFavorite, homeHidden, appHidden],
  );
  const getOrderedItems = useCallback(
    (scopeKey: string, items: HausAccessory[], showDragPreview = true): HausAccessory[] => {
      const ordered =
        scopeKey === 'home:quick'
          ? [...items]
          : orderRoomDevices(items, preferences, preferences.deviceOrder?.[scopeKey]);

      if (
        showDragPreview &&
        dragState &&
        dragState.scopeKey === scopeKey &&
        dragState.draggedId &&
        dragState.overId &&
        dragState.draggedId !== dragState.overId
      ) {
        const preview = [...ordered];
        const fromIdx = preview.findIndex((item) => item.id === dragState.draggedId);
        const toIdx = preview.findIndex((item) => item.id === dragState.overId);
        if (fromIdx !== -1 && toIdx !== -1) {
          const [moved] = preview.splice(fromIdx, 1);
          preview.splice(toIdx, 0, moved);
          return preview;
        }
      }

      return ordered;
    },
    [preferences.deviceOrder, preferences.favorites, preferences.manualUsage, dragState],
  );
  const handleTileDrop = useCallback(
    (scopeKey: string, targetId: string, scopeItems?: HausAccessory[], draggedIdParam?: string) => {
      const draggedId = draggedIdParam || dragState?.draggedId;
      if (!draggedId || draggedId === targetId) {
        setDragState(null);
        return;
      }
      const itemsToOrder =
        scopeItems ??
        getOrderedItems(
          scopeKey,
          model.accessories.filter((a) => !appHidden(a)),
          false,
        );
      const currentIds = itemsToOrder.map((item) => item.id);
      const baseIds = currentIds;

      const fromIndex = baseIds.indexOf(draggedId);
      const toIndex = baseIds.indexOf(targetId);
      if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
        const nextIds = [...baseIds];
        const [moved] = nextIds.splice(fromIndex, 1);
        nextIds.splice(toIndex, 0, moved);
        const nextOrder = {
          ...preferences.deviceOrder,
          [scopeKey]: nextIds,
        };
        haus.savePreferences({ deviceOrder: nextOrder });
      }
      setDragState(null);
    },
    [dragState, preferences.deviceOrder, getOrderedItems, model.accessories, appHidden, haus],
  );
  const createDashboard = async () => {
    if (mode !== 'live' || !window.hausNative) {
      notify('Connect your Home Assistant to create its dashboard.');
      return;
    }
    if (!snapshot.user.is_admin) {
      notify('Only a Home Assistant administrator can create a dashboard.');
      return;
    }
    setDashboardBusy(true);
    try {
      const config = generateDashboard(snapshot);
      const result = await syncDashboard(
        <T,>(command: Record<string, unknown>) => window.hausNative!.request<T>(command),
        config,
        preferences.hausDashboard,
      );
      if (result.kind === 'conflict') {
        setDashboardOpen(false);
        notify(
          'The existing “Haus” dashboard has edits or is managed by YAML. Haus left it untouched; review the preview or open the dashboard in Home Assistant.',
        );
        return;
      }
      haus.savePreferences({
        hausDashboard: { urlPath: HAUS_DASHBOARD_PATH, lastGenerated: config },
      });
      notify(
        result.kind === 'created'
          ? 'Your Haus dashboard is ready.'
          : 'Your Haus dashboard is up to date.',
      );
    } catch (error) {
      notify(message(error));
    } finally {
      setDashboardBusy(false);
    }
  };
  const sourceAccessories = route.kind === 'hidden' ? hiddenAccessories : visibleAccessories;
  const filtered = sourceAccessories.filter(
    (a) =>
      a.primaryEntityId.split('.')[0] !== 'camera' &&
      (!isHomeOverview || !homeHidden(a)) &&
      (route.kind !== 'category' || a.category === route.id) &&
      (route.kind !== 'room' || a.areaId === route.id) &&
      (!search ||
        `${a.name} ${a.secondaryEntities.map((entity) => `${entity.attributes.friendly_name ?? ''} ${entity.entity_id}`).join(' ')} ${model.rooms.find((r) => r.id === a.areaId)?.name ?? ''}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const homeCategoryItems = navigationCategories.map((category) => {
    const items = homeAccessories.filter((item) => item.category === category.id);
    const active = items.filter(isActive).length;
    const summary =
      category.id === 'climate'
        ? indoorTemperature
        : category.id === 'lights'
          ? `${active} on · ${items.length} lights`
          : `${items.length} ${items.length === 1 ? 'device' : 'devices'}${active ? ` · ${active} active` : ''}`;
    return { ...category, summary };
  });
  const categoryRoomCount = new Set(filtered.map((item) => item.areaId || 'unassigned')).size;
  const categoryActiveCount = filtered.filter(isActive).length;
  const favorites = filtered.filter(isFavorite);
  const roomCategories =
    route.kind === 'room'
      ? categories.filter((category) =>
          filtered.some((accessory) => accessory.category === category.id),
        )
      : [];
  const effectiveRoomCategory = roomCategory ?? 'all';
  const { controls: rankedQuickControls, usingFavorites: hasHomeFavorites } = homeControls(
    homeAccessories,
    preferences.favorites,
    preferences.manualUsage,
  );
  const quickSelectionKey = `${route.kind}:${mode}:${haus.session?.url ?? ''}:${preferences.favorites.join(',')}`;
  const [quickSelection, setQuickSelection] = useState<{ key: string; ids: string[] }>({
    key: '',
    ids: [],
  });
  const homeQuickControls = stableQuickControls(
    quickSelection.key === quickSelectionKey ? quickSelection.ids : [],
    rankedQuickControls,
    homeAccessories,
  );
  const quickSelectionIds = homeQuickControls.map((item) => item.id).join(',');
  useEffect(() => {
    setQuickSelection({
      key: quickSelectionKey,
      ids: quickSelectionIds ? quickSelectionIds.split(',') : [],
    });
  }, [quickSelectionKey, quickSelectionIds]);
  const renderGrid = (
    items: HausAccessory[],
    hiddenView = false,
    gridClassName = 'accessory-grid',
    scopeKey = `scope:${route.kind}`,
  ) => {
    const visibleItems = items.filter((a) =>
      hiddenView ? appHidden(a) : !appHidden(a) && (!isHomeOverview || !homeHidden(a)),
    );
    const canGroup = !hiddenView && !search && scopeKey !== 'home:quick';
    const displayItems = groupNumberedLights(
      visibleItems,
      canGroup && preferences.autoGroupLights !== false,
      preferences.disabledLightGroups,
    );
    const ordered = getOrderedItems(scopeKey, displayItems);

    return (
      <div className={gridClassName}>
        {ordered.map((a) => (
          <AccessoryTile
            key={a.id}
            accessory={a}
            room={model.rooms.find((r) => r.id === a.areaId)?.name}
            favorite={isFavorite(a)}
            hidden={hiddenView}
            isDragging={dragState?.scopeKey === scopeKey && dragState?.draggedId === a.id}
            isDragOver={
              dragState?.scopeKey === scopeKey &&
              dragState?.overId === a.id &&
              dragState?.draggedId !== a.id
            }
            onDragStart={(e) => {
              if (hiddenView) return;
              e.dataTransfer.setData('text/plain', a.id);
              e.dataTransfer.effectAllowed = 'move';
              setDragState({ scopeKey, draggedId: a.id, overId: null });
            }}
            onDragOver={(e) => {
              if (hiddenView || !dragState || dragState.scopeKey !== scopeKey) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dragState.overId !== a.id && dragState.draggedId !== a.id) {
                setDragState((prev) => (prev ? { ...prev, overId: a.id } : null));
              }
            }}
            onDragEnd={() => setDragState(null)}
            onDrop={(e) => {
              if (hiddenView) return;
              e.preventDefault();
              const draggedId = e.dataTransfer.getData('text/plain') || dragState?.draggedId;
              handleTileDrop(
                scopeKey,
                a.id,
                getOrderedItems(scopeKey, displayItems, false),
                draggedId,
              );
            }}
            onContextMenu={(e) => showAccessoryContextMenu(e, a)}
            onRestore={() => restoreFromApp(a)}
            onOpen={() => openAccessory(a)}
            onQuick={() => void quick(a)}
          />
        ))}
      </div>
    );
  };
  const renderGroupedGrid = (
    items: HausAccessory[],
    grouping: 'category' | 'room',
    hiddenView = false,
  ) => {
    const groups = new Map<string, HausAccessory[]>();
    for (const item of items) {
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
            ...[...groups.keys()].filter((id) => !model.rooms.some((item) => item.id === id)),
          ];

    return (
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
        renderSection={(key) => {
          const groupItems = groups.get(key) ?? [];
          const category = categories.find((item) => item.id === key);
          const room = model.rooms.find((item) => item.id === key);
          const Icon = grouping === 'category' ? categoryIcons[key] : roomIcons[room?.name ?? ''];
          const label =
            grouping === 'category'
              ? (category?.name ?? titleCase(key))
              : (room?.name ?? 'Unassigned');

          return (
            <section
              className={`device-group ${grouping === 'category' ? `device-group--${key}` : ''}`}
              data-category={grouping === 'category' ? key : undefined}
              key={key}
            >
              <div className="device-group-heading">
                <span
                  className={`device-group-icon ${grouping === 'category' ? `device-group-icon--${key}` : ''}`}
                >
                  {Icon ? <Icon size={16} strokeWidth={1.7} /> : <LayoutGrid size={16} />}
                </span>
                <h2>
                  {route.kind === 'category' && grouping === 'room' && room ? (
                    <button
                      className="group-room-link"
                      onClick={() => go({ kind: 'room', id: key })}
                    >
                      {label}
                      <ChevronRight size={14} />
                    </button>
                  ) : (
                    label
                  )}
                </h2>
                <span className="device-group-count">
                  {groupItems.length} {groupItems.length === 1 ? 'device' : 'devices'}
                </span>
                <span className="device-group-rule" />
              </div>
              {renderGrid(
                groupItems,
                hiddenView,
                'accessory-grid',
                grouping === 'category'
                  ? `category:${key}:${route.kind === 'room' ? route.id : 'global'}`
                  : `room:${key}:${route.kind === 'category' ? route.id : 'global'}`,
              )}
            </section>
          );
        }}
      />
    );
  };
  const sceneControls = {
    hiddenHomeIds,
    onToggleHome: (scene: HassEntity) => toggleHomeVisibility(scene.entity_id),
    onToggleApp: (scene: HassEntity) => toggleAppVisibility(scene.entity_id),
  };
  const renderScenes = (
    scenes: HassEntity[] = appScenes,
    horizontal = true,
    hiddenView = false,
  ) => (
    <SceneCollection
      scenes={scenes}
      snapshot={snapshot}
      model={model}
      onRun={sceneRun}
      openServer={openServer}
      horizontal={horizontal}
      showAccessoryCount={route.kind !== 'home'}
      hiddenView={hiddenView}
      {...sceneControls}
    />
  );
  const renderCameras = (cameras: HassEntity[] = appCameras, horizontal = false) => {
    const cards = cameras
      .filter((camera) => {
        const owner = cameraOwner(camera);
        return (
          route.kind !== 'home' ||
          (owner ? !homeHidden(owner) : !hiddenHomeIds.has(camera.entity_id))
        );
      })
      .map((c, i) => (
        <CameraCard
          key={c.entity_id}
          entity={c}
          demo={mode === 'demo'}
          index={i}
          room={model.rooms.find((room) => room.id === cameraOwner(c)?.areaId)?.name}
          onOpen={() => setCamera(c)}
        />
      ));

    return horizontal ? (
      <ScrollShadow className="camera-scroll" orientation="horizontal" hideScrollBar size={36}>
        <div className="camera-grid camera-rail">{cards}</div>
      </ScrollShadow>
    ) : (
      <div className="camera-grid">{cards}</div>
    );
  };
  const online = status === 'connected' || mode === 'demo';

  return (
    <div className={`app-shell ${sidebarOpen ? 'sidebar-is-open' : ''}`}>
      <aside className="sidebar">
        <div className="window-handle">
          <span />
          <span />
          <span />
        </div>
        <button className="brand" onClick={() => go({ kind: 'home' })} aria-label="Haus home">
          <House size={30} strokeWidth={1.8} />
          <span>
            haus<span className="brand-dot">.</span>
          </span>
        </button>
        <ScrollShadow className="sidebar-scroll" orientation="vertical" size={28} hideScrollBar>
          <nav aria-label="Main navigation">
            <div className="nav-block">
              <NavButton
                active={route.kind === 'home'}
                icon={<House size={19} />}
                onClick={() => go({ kind: 'home' })}
              >
                Home
              </NavButton>
              <NavButton
                active={route.kind === 'scenes'}
                icon={<Sparkles size={19} />}
                onClick={() => go({ kind: 'scenes' })}
              >
                Scenes
              </NavButton>
              <NavButton
                active={route.kind === 'favorites'}
                icon={<Heart size={19} />}
                onClick={() => go({ kind: 'favorites' })}
              >
                Favorites
              </NavButton>
              <NavButton
                active={route.kind === 'automations'}
                icon={<Zap size={19} />}
                onClick={() => go({ kind: 'automations' })}
              >
                Automations
              </NavButton>
            </div>
            <div className="nav-block">
              <div className="nav-label">YOUR HOME</div>
              {navigationCategories.map((c) => {
                const Icon = categoryIcons[c.id];
                return (
                  <NavButton
                    key={c.id}
                    active={route.kind === 'category' && route.id === c.id}
                    icon={<Icon size={18} />}
                    onClick={() => go({ kind: 'category', id: c.id })}
                  >
                    {c.name}
                  </NavButton>
                );
              })}
              <NavButton
                active={route.kind === 'cameras'}
                icon={<Radio size={18} />}
                onClick={() => go({ kind: 'cameras' })}
              >
                Cameras<span className="nav-count">{appCameras.length}</span>
              </NavButton>
            </div>
            <div className="nav-block rooms-nav">
              <div className="nav-label">
                ROOMS <span>{navigationRooms.length}</span>
              </div>
              {navigationRooms.map((r) => {
                const Icon = roomIcons[r.name] ?? LayoutGrid;
                return (
                  <NavButton
                    key={r.id}
                    active={route.kind === 'room' && route.id === r.id}
                    icon={<Icon size={18} />}
                    onClick={() => go({ kind: 'room', id: r.id })}
                  >
                    {r.name}
                  </NavButton>
                );
              })}
            </div>
            <div className="nav-block management-nav">
              <div className="nav-label">MANAGE HOME</div>
              <NavButton
                active={route.kind === 'devices'}
                icon={<LayoutGrid size={18} />}
                onClick={() => go({ kind: 'devices' })}
              >
                Devices<span className="nav-count">{snapshot.devices.length}</span>
              </NavButton>
              <NavButton
                active={route.kind === 'integrations'}
                icon={<Cable size={18} />}
                onClick={() => go({ kind: 'integrations' })}
              >
                Integrations
              </NavButton>
              <NavButton
                active={route.kind === 'addons'}
                icon={<Box size={18} />}
                onClick={() => go({ kind: 'addons' })}
              >
                Add-ons
              </NavButton>
              <NavButton
                active={route.kind === 'statistics'}
                icon={<Activity size={18} />}
                onClick={() => go({ kind: 'statistics' })}
              >
                Statistics
              </NavButton>
              <NavButton
                active={route.kind === 'hidden'}
                icon={<Archive size={18} />}
                onClick={() => go({ kind: 'hidden' })}
              >
                Hidden<span className="nav-count">{hiddenCount}</span>
              </NavButton>
            </div>
          </nav>
        </ScrollShadow>
        <div className="sidebar-bottom">
          <div className="connected-hint">
            <i className={online ? '' : 'offline'} />
            {mode === 'demo'
              ? 'You’re in the demo home'
              : online
                ? 'Connected to your home'
                : 'Reconnecting to your home'}
          </div>
          <NavButton
            active={route.kind === 'settings'}
            icon={<Settings2 size={18} />}
            onClick={() => go({ kind: 'settings' })}
          >
            Settings<span className="key-hint">⌘ ,</span>
          </NavButton>
          <div className="sidebar-footnote">A little closer to home.</div>
        </div>
      </aside>
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={20} />
            </button>
            <House size={15} />
            <span>
              {mode === 'demo' ? snapshot.config.location_name : snapshot.config.location_name}
            </span>
            <ChevronRight size={13} />
            <strong>{route.kind === 'home' ? 'Overview' : heading}</strong>
          </div>
          <div className="topbar-actions">
            {mode === 'demo' && <span className="demo-badge">DEMO HOME</span>}
            <button
              className="icon-button"
              aria-label="Search devices"
              onClick={() => {
                setSearchOpen((v) => !v);
                setTimeout(() => searchRef.current?.focus(), 30);
              }}
            >
              <Search size={19} />
              <span className="shortcut">
                <Command size={10} /> K
              </span>
            </button>
            <button
              className="icon-button theme-toggle"
              aria-label={`Switch to ${preferences.theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${preferences.theme === 'dark' ? 'light' : 'dark'} theme`}
              onClick={() =>
                haus.savePreferences({ theme: preferences.theme === 'dark' ? 'light' : 'dark' })
              }
            >
              {preferences.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              className="icon-button notification-button"
              aria-label={`Notifications${homeNotices.notifications.length ? `, ${homeNotices.notifications.length}` : ''}`}
              onClick={() => go({ kind: 'attention' })}
            >
              <Bell size={19} />
              {(homeNotices.notifications.length > 0 || appAttention.length > 0) && <i />}
            </button>
            <span className="topbar-divider" />
            <button
              className="profile-button"
              aria-label="Home settings"
              onClick={() => go({ kind: 'settings' })}
            >
              {snapshot.user.name?.slice(0, 1) ?? 'H'}
            </button>
          </div>
        </header>
        <ScrollShadow
          className="main-scroll"
          orientation="vertical"
          size={isHomeOverview ? 0 : 36}
          ref={scrollRef}
        >
          <div className={`page-content ${isHomeOverview ? 'home-overview' : ''}`}>
            {searchOpen && (
              <div className="search-box">
                <Search size={19} />
                <input
                  ref={searchRef}
                  placeholder="Find a device or room…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button
                  className="icon-button"
                  aria-label="Close search"
                  onClick={() => {
                    setSearchOpen(false);
                    setSearch('');
                  }}
                >
                  <X size={17} />
                </button>
              </div>
            )}
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  {isHomeOverview
                    ? 'HAUS OVERVIEW'
                    : route.kind === 'room'
                      ? 'ROOM OVERVIEW'
                      : route.kind === 'hidden'
                        ? 'DEVICE VISIBILITY'
                        : 'THOUGHTFULLY CONNECTED'}
                </div>
                <h1>{heading}</h1>
                <p>
                  {route.kind === 'home'
                    ? 'Your home. A little closer.'
                    : route.kind === 'category'
                      ? `${filtered.length} ${filtered.length === 1 ? 'device' : 'devices'} in ${categoryRoomCount} ${categoryRoomCount === 1 ? 'room' : 'rooms'}${categoryActiveCount ? ` · ${categoryActiveCount} active` : ''}`
                      : route.kind === 'room'
                        ? `${filtered.length} devices${roomCameras.length ? ` · ${roomCameras.length} ${roomCameras.length === 1 ? 'camera' : 'cameras'}` : ''} · Make yourself comfortable.`
                        : route.kind === 'hidden'
                          ? `${hiddenCount} ${hiddenCount === 1 ? 'item' : 'items'} hidden from Haus. Restore any of them whenever you like.`
                          : route.kind === 'settings'
                            ? 'A home that works your way.'
                            : route.kind === 'statistics'
                              ? mode === 'demo'
                                ? 'Connect Home Assistant to explore its long-term sensor history.'
                                : 'Long-term sensor statistics recorded by Home Assistant.'
                              : 'Your home, thoughtfully connected.'}
                </p>
              </div>
              <div className="heading-actions">
                {!isHomeOverview && (
                  <button
                    className="icon-button back-button"
                    aria-label="Back to home"
                    onClick={() => go({ kind: 'home' })}
                  >
                    <ArrowLeft size={20} />
                  </button>
                )}
                {mode === 'live' && (
                  <button
                    className="icon-button"
                    aria-label="Refresh home"
                    title="Refresh devices from Home Assistant"
                    onClick={() => void haus.refresh()}
                  >
                    <RefreshCw size={17} />
                  </button>
                )}
                <Button
                  className="add-button"
                  variant="outline"
                  onPress={() => (mode === 'demo' ? setConnectOpen(true) : setAddDeviceOpen(true))}
                >
                  <Plus size={17} />
                  <span>{mode === 'demo' ? 'Connect your home' : 'Add device'}</span>
                </Button>
              </div>
            </div>
            {isHomeOverview && (
              <HomeCategoryDock
                categories={homeCategoryItems}
                selected={route.kind === 'category' ? route.id : null}
                onSelect={(id) => go(id ? { kind: 'category', id } : { kind: 'home' })}
              />
            )}
            {route.kind === 'home' && !search && (
              <>
                <Section
                  className="home-section-unboxed overview-cameras"
                  title="Cameras"
                  subtitle={
                    homeCameras.length
                      ? `${homeCameras.length} views of home.`
                      : 'Keep an eye on home.'
                  }
                  action="All cameras"
                  onAction={() => go({ kind: 'cameras' })}
                >
                  {homeCameras.length ? (
                    renderCameras(homeCameras, true)
                  ) : (
                    <Empty
                      icon={<Radio />}
                      title="No cameras on Home"
                      description="Cameras you add to Home view will appear here."
                    />
                  )}
                </Section>
                {homeVisibleScenes.length > 0 && (
                  <Section
                    title="Set the mood"
                    subtitle="Tap a scene. Change the atmosphere."
                    action="All scenes"
                    onAction={() => go({ kind: 'scenes' })}
                  >
                    {renderScenes(sortedHomeScenes)}
                  </Section>
                )}
                <div className="home-primary-grid">
                  {homeQuickControls.length > 0 && (
                    <Section
                      className="home-section-unboxed overview-controls"
                      title={hasHomeFavorites ? 'Quick controls' : 'At your fingertips'}
                      subtitle={
                        hasHomeFavorites
                          ? 'Pinned for one-tap access.'
                          : mode === 'demo'
                            ? 'Ranked by the changes you make here.'
                            : 'The controls you reach for most.'
                      }
                      action={hasHomeFavorites ? 'Favorites' : 'Statistics'}
                      onAction={() =>
                        go(hasHomeFavorites ? { kind: 'favorites' } : { kind: 'statistics' })
                      }
                    >
                      {renderGrid(
                        homeQuickControls,
                        false,
                        'accessory-grid home-device-grid',
                        'home:quick',
                      )}
                    </Section>
                  )}
                </div>
                {homeAttention.length > 0 && (
                  <button className="attention-banner" onClick={() => go({ kind: 'attention' })}>
                    <span className="attention-icon">
                      <Bell size={20} />
                    </span>
                    <span>
                      <strong>A few things to check</strong>
                      <small>
                        {homeAttention
                          .slice(0, 2)
                          .map((a) => a.title)
                          .join(' · ')}
                      </small>
                    </span>
                    <span className="attention-count">{homeAttention.length}</span>
                    <ChevronRight size={19} />
                  </button>
                )}
                <div className="home-room-stream" aria-label="Devices by room">
                  {homeRooms.length ? (
                    <VirtualSections
                      items={homeRooms}
                      getKey={(item) => item.id}
                      scrollRef={scrollRef}
                      estimateHeight={(item, columns) =>
                        100 +
                        Math.ceil(
                          groupNumberedLights(
                            item.accessories.filter(
                              (a) => !a.primaryEntityId.startsWith('camera.'),
                            ),
                            preferences.autoGroupLights !== false,
                            preferences.disabledLightGroups,
                          ).length / columns,
                        ) *
                          137
                      }
                      renderSection={(item) => {
                        const Icon = roomIcons[item.name] ?? LayoutGrid;
                        const roomScenes = sortScenesByName(
                          scenesForRoom(item.id, true),
                          () => item.name,
                        );
                        const roomDevices = item.accessories.filter(
                          (accessory) => !accessory.primaryEntityId.startsWith('camera.'),
                        );
                        const roomCameraCount = homeCamerasForRoom(item.id).length;
                        const activeCount = roomDevices.filter(isActive).length;
                        return (
                          <section className="device-group home-room-section" key={item.id}>
                            <div className="device-group-heading">
                              <span className="device-group-icon">
                                <Icon size={16} strokeWidth={1.7} />
                              </span>
                              <h2>
                                <button
                                  className="group-room-link"
                                  onClick={() => go({ kind: 'room', id: item.id })}
                                >
                                  {item.name}
                                  <ChevronRight size={14} />
                                </button>
                              </h2>
                              <span className="device-group-count">
                                {roomDevices.length} devices
                                {roomCameraCount > 0 &&
                                  ` · ${roomCameraCount} ${roomCameraCount === 1 ? 'camera' : 'cameras'}`}
                                {activeCount > 0 && ` · ${activeCount} active`}
                              </span>
                              <span className="device-group-rule" />
                            </div>
                            {roomDevices.length > 0 &&
                              renderGrid(
                                roomDevices,
                                false,
                                'accessory-grid',
                                `home:room:${item.id}`,
                              )}
                            {roomScenes.length > 0 && (
                              <ScrollShadow
                                className="room-overview-scenes-scroll"
                                orientation="horizontal"
                                size={22}
                                hideScrollBar
                              >
                                <div
                                  className="room-overview-scenes"
                                  aria-label={`${item.name} scenes`}
                                >
                                  {roomScenes.map((scene) => (
                                    <button
                                      className={`room-scene-chip ${likelyActiveSceneIds.has(scene.entity_id) ? 'is-likely-active' : ''}`}
                                      key={scene.entity_id}
                                      aria-label={`${scenePresentation(scene).name}${scenePresentation(scene).source ? ', Hue' : ''}${likelyActiveSceneIds.has(scene.entity_id) ? ', settings match' : ''}`}
                                      onClick={() => void sceneRun(scene).catch(() => {})}
                                    >
                                      <SceneIcon name={String(scene.attributes.friendly_name)} />
                                      {scenePresentation(scene, item.name).title}
                                      {scenePresentation(scene).source && (
                                        <span className="scene-source-badge scene-source-inline">
                                          Hue
                                        </span>
                                      )}
                                      {likelyActiveSceneIds.has(scene.entity_id) && (
                                        <Check
                                          size={12}
                                          className="scene-active-check"
                                          aria-hidden="true"
                                        />
                                      )}
                                    </button>
                                  ))}
                                </div>
                              </ScrollShadow>
                            )}
                          </section>
                        );
                      }}
                    />
                  ) : (
                    <Empty
                      icon={<House />}
                      title="No rooms yet"
                      description="Rooms from Home Assistant will appear here."
                    />
                  )}
                </div>
              </>
            )}
            {route.kind === 'category' && !search && (
              <div className="home-filter-content" key={route.id}>
                {route.id === 'security' && homeCameras.length > 0 && (
                  <Section
                    className="home-section-unboxed overview-cameras"
                    title="Cameras"
                    subtitle={`${homeCameras.length} views of home.`}
                    action="All cameras"
                    onAction={() => go({ kind: 'cameras' })}
                  >
                    {renderCameras(homeCameras, true)}
                  </Section>
                )}
                {filtered.length > 0 ? (
                  renderGroupedGrid(filtered, 'room')
                ) : (
                  <Empty
                    icon={<LayoutGrid />}
                    title="No devices on Home"
                    description="Devices in this category will appear here when added to Home view."
                  />
                )}
              </div>
            )}
            {(search || ['room', 'favorites', 'hidden'].includes(route.kind)) && (
              <>
                {route.kind === 'room' && !search && roomCameras.length > 0 && (
                  <Section
                    className="home-section-unboxed"
                    title="Cameras in this room"
                    subtitle={`${roomCameras.length} ${roomCameras.length === 1 ? 'camera' : 'cameras'} assigned to this room.`}
                    action="All cameras"
                    onAction={() => go({ kind: 'cameras' })}
                  >
                    {renderCameras(roomCameras, true)}
                  </Section>
                )}
                {route.kind === 'room' && !search && scenesForRoom(route.id).length > 0 && (
                  <Section
                    className="home-section-unboxed"
                    title="Scenes for this room"
                    subtitle="Run a scene without leaving the room."
                    action="All scenes"
                    onAction={() => go({ kind: 'scenes' })}
                  >
                    {renderScenes(scenesForRoom(route.id))}
                  </Section>
                )}
                {route.kind === 'room' && !search && roomCategories.length > 0 && (
                  <div className="room-category-bar">
                    <ScrollShadow
                      className="category-badges-scroll"
                      orientation="horizontal"
                      hideScrollBar
                      size={28}
                    >
                      <div className="room-category-badges">
                        <button
                          className={`category-badge category-badge--all ${effectiveRoomCategory === 'all' ? 'active' : ''}`}
                          data-category="all"
                          onClick={() => setRoomCategory('all')}
                        >
                          <span className="badge-icon">
                            <LayoutGrid size={15} />
                          </span>
                          <span className="badge-name">All</span>
                          <span className="badge-pill">{filtered.length}</span>
                        </button>
                        {roomCategories.map((category) => {
                          const Icon = categoryIcons[category.id] ?? LayoutGrid;
                          const items = filtered.filter((a) => a.category === category.id);
                          const activeCount = items.filter(isActive).length;
                          const isSelected = effectiveRoomCategory === category.id;
                          let pillText = `${items.length}`;
                          if (
                            category.id === 'climate' &&
                            roomTemperatureLabel &&
                            roomTemperatureLabel !== '—'
                          ) {
                            pillText = roomTemperatureLabel;
                          } else if (activeCount > 0) {
                            pillText = `${activeCount} on`;
                          }

                          return (
                            <button
                              key={category.id}
                              data-category={category.id}
                              className={`category-badge category-badge--${category.id} ${isSelected ? 'active' : ''} ${activeCount > 0 ? 'has-active' : ''}`}
                              onClick={() => setRoomCategory(isSelected ? 'all' : category.id)}
                            >
                              <span className="badge-icon">
                                <Icon size={15} strokeWidth={1.8} />
                              </span>
                              <span className="badge-name">{category.name}</span>
                              <span className={`badge-pill ${activeCount > 0 ? 'is-active' : ''}`}>
                                {pillText}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </ScrollShadow>
                  </div>
                )}
                {route.kind === 'favorites' && !search && (
                  <p className="page-tip">
                    <Heart size={16} />
                    Open an accessory and tap the heart to make it a favorite.
                  </p>
                )}
                {route.kind === 'hidden' ? (
                  <>
                    {filtered.length > 0 && renderGroupedGrid(filtered, 'room', true)}
                    {hiddenCameraMatches.length > 0 && (
                      <section className="device-group">
                        <div className="device-group-heading">
                          <span className="device-group-icon">
                            <Radio size={16} />
                          </span>
                          <h2>Cameras</h2>
                          <span className="device-group-count">
                            {hiddenCameraMatches.length}{' '}
                            {hiddenCameraMatches.length === 1 ? 'camera' : 'cameras'}
                          </span>
                          <span className="device-group-rule" />
                        </div>
                        <div className="hidden-camera-grid">
                          {hiddenCameraMatches.map((item, index) => (
                            <article className="hidden-camera-tile" key={item.entity_id}>
                              <button
                                className="hidden-camera-preview"
                                onClick={() => setCamera(item)}
                              >
                                <CameraPreview entity={item} demo={mode === 'demo'} index={index} />
                                <span>{String(item.attributes.friendly_name ?? 'Camera')}</span>
                              </button>
                              <button
                                className="tile-restore"
                                onClick={() => restoreFromApp(item.entity_id)}
                              >
                                <Eye size={14} />
                                Restore to app
                              </button>
                            </article>
                          ))}
                        </div>
                      </section>
                    )}
                    {hiddenSceneMatches.length > 0 && (
                      <section className="device-group">
                        <div className="device-group-heading">
                          <span className="device-group-icon">
                            <Sparkles size={16} />
                          </span>
                          <h2>Scenes</h2>
                          <span className="device-group-count">
                            {hiddenSceneMatches.length}{' '}
                            {hiddenSceneMatches.length === 1 ? 'scene' : 'scenes'}
                          </span>
                          <span className="device-group-rule" />
                        </div>
                        {renderScenes(hiddenSceneMatches, false, true)}
                      </section>
                    )}
                    {!filtered.length &&
                      !hiddenCameraMatches.length &&
                      !hiddenSceneMatches.length && (
                        <Empty
                          icon={hiddenCount ? <Eye /> : <Archive />}
                          title={hiddenCount ? 'No matching items' : 'Nothing hidden'}
                          description={
                            hiddenCount
                              ? 'Try another device, scene or room name.'
                              : 'Devices and scenes you hide from Haus will be kept here, ready to restore.'
                          }
                        />
                      )}
                  </>
                ) : (
                  <>
                    {(route.kind === 'favorites' ? favorites : filtered).length > 0 &&
                      (route.kind === 'room'
                        ? effectiveRoomCategory === 'all'
                          ? renderGroupedGrid(filtered, 'category')
                          : (() => {
                              const cat = categories.find((c) => c.id === effectiveRoomCategory);
                              const items = filtered.filter(
                                (a) => a.category === effectiveRoomCategory,
                              );
                              const Icon = categoryIcons[effectiveRoomCategory] ?? LayoutGrid;
                              const label = cat?.name ?? titleCase(effectiveRoomCategory);
                              return (
                                <section
                                  className={`device-group device-group--${effectiveRoomCategory}`}
                                  data-category={effectiveRoomCategory}
                                  key={effectiveRoomCategory}
                                >
                                  <div className="device-group-heading">
                                    <span
                                      className={`device-group-icon device-group-icon--${effectiveRoomCategory}`}
                                    >
                                      <Icon size={16} strokeWidth={1.7} />
                                    </span>
                                    <h2>{label}</h2>
                                    <span className="device-group-count">
                                      {items.length} {items.length === 1 ? 'device' : 'devices'}
                                    </span>
                                    <span className="device-group-rule" />
                                  </div>
                                  {renderGrid(
                                    items,
                                    false,
                                    'accessory-grid',
                                    `room:${route.id}:${effectiveRoomCategory}`,
                                  )}
                                </section>
                              );
                            })()
                        : route.kind === 'category' || route.kind === 'favorites'
                          ? renderGroupedGrid(
                              route.kind === 'favorites' ? favorites : filtered,
                              'room',
                            )
                          : renderGrid(filtered, false, 'accessory-grid', `scope:${route.kind}`))}
                    {searchCameras.length > 0 && (
                      <section className="device-group search-camera-group">
                        <div className="device-group-heading">
                          <span className="device-group-icon">
                            <Radio size={16} />
                          </span>
                          <h2>Cameras</h2>
                          <span className="device-group-count">
                            {searchCameras.length}{' '}
                            {searchCameras.length === 1 ? 'camera' : 'cameras'}
                          </span>
                          <span className="device-group-rule" />
                        </div>
                        {renderCameras(searchCameras)}
                      </section>
                    )}
                    {!(route.kind === 'favorites' ? favorites : filtered).length &&
                      !searchCameras.length && (
                        <Empty
                          icon={<Search />}
                          title={search ? 'No devices found' : 'Make this space yours'}
                          description={
                            search
                              ? 'Try another device, camera or room name.'
                              : 'Accessories appear here as you add them to your home.'
                          }
                        />
                      )}
                  </>
                )}
              </>
            )}
            {route.kind === 'statistics' && !search && (
              <StatisticsPanel mode={mode} states={snapshot.states} />
            )}
            {route.kind === 'scenes' && !search && (
              <SceneCollection
                scenes={appScenes}
                snapshot={snapshot}
                model={model}
                onRun={sceneRun}
                openServer={openServer}
                library
                {...sceneControls}
              />
            )}
            {route.kind === 'devices' && !search && (
              <DeviceInventory
                snapshot={snapshot}
                accessories={model.accessories}
                onOpen={openAccessory}
                openServer={openServer}
                onAdd={() => setAddDeviceOpen(true)}
              />
            )}
            {(route.kind === 'integrations' || route.kind === 'addons') && !search && (
              <ConnectionsPage
                key={route.kind}
                kind={route.kind}
                demo={mode === 'demo'}
                snapshot={snapshot}
                openServer={openServer}
                onAdd={() => setAddDeviceOpen(true)}
              />
            )}
            {route.kind === 'cameras' &&
              !search &&
              (appCameras.length ? (
                renderCameras()
              ) : (
                <Empty
                  icon={<Radio />}
                  title="No cameras in Haus"
                  description="Cameras you hide from the app can be restored from Hidden."
                />
              ))}
            {route.kind === 'attention' && !search && (
              <div className="attention-list">
                {homeNotices.error && (
                  <p role="status" className="form-error">
                    {homeNotices.error}
                  </p>
                )}
                {homeNotices.notifications.map((notice) => (
                  <article className="home-notice" key={notice.id}>
                    <span
                      className={`attention-icon ${notice.severity === 'critical' ? 'critical' : ''}`}
                    >
                      <Bell size={21} />
                    </span>
                    <div>
                      <small>
                        {notice.kind === 'update'
                          ? 'Software update'
                          : notice.kind === 'repair'
                            ? 'Repairs'
                            : 'Your home'}
                      </small>
                      <h3>{notice.title}</h3>
                      <div className="home-notice-body">
                        <ServerMarkdown text={notice.message} />
                      </div>
                    </div>
                    {notice.notificationId ? (
                      <Button
                        variant="ghost"
                        onPress={() =>
                          void homeNotices
                            .dismiss(notice.notificationId!)
                            .catch((error) => notify(message(error)))
                        }
                      >
                        Dismiss
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        onPress={() => {
                          openServer(
                            notice.kind === 'update' ? '/config/updates' : '/config/repairs',
                          );
                        }}
                      >
                        Review <ChevronRight size={15} />
                      </Button>
                    )}
                  </article>
                ))}
                {appAttention.length ? (
                  appAttention.map((a) => (
                    <button
                      key={a.id}
                      onClick={() =>
                        (() => {
                          const owner = model.accessories.find((d) =>
                            d.entityIds.includes(a.entityId),
                          );
                          if (owner) openAccessory(owner);
                          else setSelected(a.entityId);
                        })()
                      }
                    >
                      <span
                        className={`attention-icon ${a.severity === 'critical' ? 'critical' : ''}`}
                      >
                        <Bell size={21} />
                      </span>
                      <span>
                        <strong>{a.title}</strong>
                        <small>{a.description}</small>
                      </span>
                      <ChevronRight size={18} />
                    </button>
                  ))
                ) : !homeNotices.notifications.length && !homeNotices.error ? (
                  <Empty
                    icon={<ShieldCheck />}
                    title="Everything feels right"
                    description="Your home has no alerts that need your attention."
                  />
                ) : null}
              </div>
            )}
            {route.kind === 'automations' && !search && (
              <div className="automation-list">
                {snapshot.states
                  .filter((s) => s.entity_id.startsWith('automation.'))
                  .map((s) => (
                    <div className="automation-row" key={s.entity_id}>
                      <span className="automation-icon">
                        <Zap size={23} />
                      </span>
                      <span>
                        <strong>{String(s.attributes.friendly_name ?? 'Automation')}</strong>
                        <small>
                          {s.state === 'on' ? 'Ready when you need it' : 'Paused'} · Managed by Home
                          Assistant
                        </small>
                      </span>
                      <button
                        role="switch"
                        aria-checked={s.state === 'on'}
                        aria-label={`Enable ${s.attributes.friendly_name}`}
                        className={`toggle-switch ${s.state === 'on' ? 'checked' : ''}`}
                        onClick={() => void run(buildAction(s, 'toggle')).catch(() => {})}
                      >
                        <i />
                      </button>
                    </div>
                  ))}
                {!snapshot.states.some((s) => s.entity_id.startsWith('automation.')) && (
                  <Empty
                    icon={<Zap />}
                    title="Let home take care of it"
                    description="Automations from Home Assistant will appear here."
                  />
                )}
                <button
                  className="text-link"
                  onClick={() => {
                    if (haus.session)
                      void window.hausNative?.openExternal(
                        `${haus.session.url}/config/automation/dashboard`,
                      );
                    else notify('Connect your Home Assistant to create and edit automations.');
                  }}
                >
                  Manage in Home Assistant <ExternalLink size={15} />
                </button>
              </div>
            )}
            {route.kind === 'settings' && !search && (
              <div className="settings-layout">
                <div className="settings-card">
                  <div className="settings-card-title">
                    <span className="settings-icon">
                      <House size={24} />
                    </span>
                    <div>
                      <h2>Your home, connected.</h2>
                      <p>Home Assistant keeps everything in sync.</p>
                    </div>
                  </div>
                  <div className="settings-row">
                    <span>Home</span>
                    <strong>
                      {mode === 'demo'
                        ? `${snapshot.config.location_name} · Demo`
                        : snapshot.config.location_name}
                    </strong>
                  </div>
                  <div className="settings-row">
                    <span>Connection</span>
                    <strong className="connection-value">
                      <i />
                      {mode === 'demo' ? 'Exploring demo' : titleCase(status)}
                    </strong>
                  </div>
                  {haus.session && (
                    <div className="settings-row">
                      <span>Address</span>
                      <strong>{haus.session.url}</strong>
                    </div>
                  )}
                  <div className="settings-row">
                    <span>Home Assistant</span>
                    <strong>{snapshot.config.version ?? 'Demo'}</strong>
                  </div>
                  <div className="settings-card-actions">
                    <Button onPress={() => setConnectOpen(true)}>
                      {mode === 'demo' ? 'Connect Home Assistant' : 'Manage connection'}
                      <ArrowRight size={16} />
                    </Button>
                    {mode === 'live' && (
                      <Button variant="ghost" onPress={() => void haus.disconnect()}>
                        Disconnect
                      </Button>
                    )}
                  </div>
                </div>
                <div className="settings-card">
                  <h2>A space that feels like you.</h2>
                  <p>Make a few little adjustments.</p>
                  <div className="settings-row">
                    <span>Appearance</span>
                    <div className="segmented">
                      <button
                        className={preferences.theme === 'light' ? 'selected' : ''}
                        onClick={() => haus.savePreferences({ theme: 'light' })}
                      >
                        Light
                      </button>
                      <button
                        className={preferences.theme === 'dark' ? 'selected' : ''}
                        onClick={() => haus.savePreferences({ theme: 'dark' })}
                      >
                        Dark
                      </button>
                    </div>
                  </div>
                  <div className="settings-row">
                    <span>Group numbered lights</span>
                    <Switch
                      aria-label="Group numbered lights"
                      isSelected={preferences.autoGroupLights !== false}
                      onChange={(autoGroupLights) => haus.savePreferences({ autoGroupLights })}
                    >
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                      </Switch.Content>
                    </Switch>
                  </div>
                  <p className="settings-note">
                    Combine matching numbered lights in the same room. Each group can also be shown
                    separately.
                  </p>
                  {!!preferences.disabledLightGroups?.length && (
                    <Button
                      variant="ghost"
                      onPress={() => haus.savePreferences({ disabledLightGroups: [] })}
                    >
                      Reset separated light groups
                    </Button>
                  )}
                  <div className="settings-row">
                    <span>Favorites</span>
                    <strong>{preferences.favorites.length} accessories</strong>
                  </div>
                  <div className="settings-row">
                    <span>Notifications</span>
                    <span>Low batteries, leaks & offline devices</span>
                  </div>
                </div>
                <div className="settings-card">
                  <h2>Connections & services.</h2>
                  <p>Everything that connects and powers your home.</p>
                  <button className="settings-destination" onClick={() => go({ kind: 'devices' })}>
                    <LayoutGrid size={19} />
                    <span>
                      Device catalog<small>Every registered device, including diagnostics</small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                  <button
                    className="settings-destination"
                    onClick={() => go({ kind: 'integrations' })}
                  >
                    <Cable size={19} />
                    <span>
                      Integrations<small>Connections, configuration and status</small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                  <button className="settings-destination" onClick={() => go({ kind: 'addons' })}>
                    <Box size={19} />
                    <span>
                      Add-ons<small>Server services and available updates</small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                </div>
                <div className="settings-card dashboard-card">
                  <span className="settings-icon">
                    <LayoutGrid size={24} />
                  </span>
                  <h2>A little Haus in Home Assistant.</h2>
                  <p>
                    Bring your rooms and accessories into a separate Home Assistant dashboard.
                    Preview and export its built-in card configuration, or create it on your server.
                  </p>
                  <div className="dashboard-actions">
                    <Button variant="outline" onPress={() => setDashboardOpen(true)}>
                      Preview dashboard
                      <ArrowRight size={16} />
                    </Button>
                    {mode === 'live' && snapshot.user.is_admin && (
                      <Button
                        onPress={() => void createDashboard()}
                        isPending={dashboardBusy}
                        isDisabled={dashboardBusy}
                      >
                        {dashboardBusy ? 'Preparing dashboard…' : 'Create in Home Assistant'}
                      </Button>
                    )}
                    {mode === 'live' && !snapshot.user.is_admin && (
                      <span className="dashboard-admin-note">
                        An administrator account is required to create a dashboard.
                      </span>
                    )}
                    {dashboardUrl && (
                      <Button
                        variant="ghost"
                        onPress={() => void window.hausNative?.openExternal(dashboardUrl)}
                      >
                        Open Haus dashboard <ExternalLink size={15} />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="settings-about">
                  <House size={23} />
                  <strong>haus.</strong>
                  <span>Version {appVersion} · Thoughtfully connected.</span>
                </div>
              </div>
            )}
            <footer className="page-footer">
              <span>
                <House size={14} /> A little closer to home.
              </span>
              <span>
                {mode === 'demo' ? 'Sample home · Changes stay in this demo' : 'Connected locally'}
              </span>
            </footer>
          </div>
        </ScrollShadow>
      </main>
      {addDeviceOpen && (
        <AddDeviceFlow
          onClose={() => setAddDeviceOpen(false)}
          demo={mode === 'demo'}
          snapshot={snapshot}
          onDone={() => {
            void haus.refresh();
          }}
          onConnect={() => setConnectOpen(true)}
        />
      )}
      {accessory && (
        <DeviceControl
          key={accessory.primaryEntityId}
          accessory={accessory}
          snapshot={snapshot}
          favorite={isFavorite(accessory)}
          demo={mode === 'demo'}
          initialEntityId={controllerEntityId ?? undefined}
          theme={preferences.theme}
          hiddenFromHome={homeHidden(accessory)}
          hiddenFromApp={appHidden(accessory)}
          onClose={() => {
            setSelected(null);
            setControllerEntityId(null);
          }}
          onAction={run}
          onFavorite={() => toggleFavorite(accessory)}
          onToggleHomeVisibility={() => toggleHomeVisibility(accessory)}
          onToggleAppVisibility={() => toggleAppVisibility(accessory)}
          onMove={(areaId) => haus.updateEntity(accessory.primaryEntityId, { area_id: areaId })}
          onRename={(name) => haus.updateEntity(accessory.primaryEntityId, { name })}
        />
      )}
      {lightGroup && (
        <LightGroupControl
          accessory={lightGroup}
          theme={preferences.theme}
          room={model.rooms.find((room) => room.id === lightGroup.areaId)?.name}
          onClose={() => setSelectedLightGroup(null)}
          onAction={(action) => runLightGroup(lightGroup, action)}
          onOpenMember={(member) => {
            setSelectedLightGroup(null);
            openAccessory(member);
          }}
          onSeparate={() => separateLights(lightGroup)}
        />
      )}
      {camera && (
        <CameraModal
          room={model.rooms.find((room) => room.id === cameraOwner(camera)?.areaId)?.name}
          entity={camera}
          demo={mode === 'demo'}
          onClose={() => setCamera(null)}
          serverUrl={haus.session?.url}
          related={model.accessories.filter((a) => a.entityIds.includes(camera.entity_id))}
          hiddenFromHome={
            cameraOwner(camera)
              ? homeHidden(cameraOwner(camera)!)
              : hiddenHomeIds.has(camera.entity_id)
          }
          hiddenFromApp={
            cameraOwner(camera)
              ? appHidden(cameraOwner(camera)!)
              : hiddenAppIds.has(camera.entity_id)
          }
          onToggleHomeVisibility={() =>
            toggleHomeVisibility(cameraOwner(camera) ?? camera.entity_id)
          }
          onToggleAppVisibility={() => {
            toggleAppVisibility(cameraOwner(camera) ?? camera.entity_id);
            setCamera(null);
          }}
          onOpenRelated={(entityId) => {
            const owner = cameraOwner(camera);
            if (!owner) return;
            setControllerEntityId(entityId);
            setSelected(owner.primaryEntityId);
            setCamera(null);
          }}
          onAction={run}
        />
      )}
      {connectOpen && (
        <ConnectDialog
          currentUrl={haus.session?.url}
          onClose={() => setConnectOpen(false)}
          connect={haus.connect}
          onConnected={() => {
            setConnectOpen(false);
            notify('Welcome home. You’re connected.');
          }}
        />
      )}
      {dashboardOpen && (
        <Dialog
          title="Your Haus dashboard"
          onClose={() => setDashboardOpen(false)}
          className="dashboard-dialog"
        >
          <p className="dialog-description">
            Built from your rooms and accessories with built-in Home Assistant cards. Creating it
            adds a separate dashboard at /haus-home. If that dashboard already has manual edits or
            is managed by YAML, Haus leaves it untouched.
          </p>
          <ScrollShadow
            className="dashboard-code-scroll"
            orientation="vertical"
            size={20}
            hideScrollBar
          >
            <pre>{JSON.stringify(generateDashboard(snapshot), null, 2)}</pre>
          </ScrollShadow>
          <Button
            onPress={() => {
              const blob = new Blob([JSON.stringify(generateDashboard(snapshot), null, 2)], {
                type: 'application/json',
              });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = 'haus-dashboard.json';
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              notify('Dashboard exported.');
            }}
          >
            <ArrowDownToLine size={17} />
            Export configuration
          </Button>
          {mode === 'live' && snapshot.user.is_admin && (
            <Button
              className="dashboard-create-button"
              onPress={() => void createDashboard()}
              isPending={dashboardBusy}
              isDisabled={dashboardBusy}
            >
              {dashboardBusy ? 'Preparing dashboard…' : 'Create in Home Assistant'}
            </Button>
          )}
          {mode === 'live' && !snapshot.user.is_admin && (
            <p className="dashboard-admin-note">
              A Home Assistant administrator account is required to create a dashboard.
            </p>
          )}
        </Dialog>
      )}
      {haus.notice && (
        <div className="toast" role="status">
          <span className="toast-icon">
            <Sparkles size={18} />
          </span>
          {haus.notice}
          <button aria-label="Dismiss notification" onClick={() => notify('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {contextMenu && (
        <>
          <div
            className="native-context-menu-backdrop"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            className="native-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.items.map((item, idx) =>
              item.type === 'separator' ? (
                <div key={`sep-${idx}`} className="native-context-menu-separator" />
              ) : (
                <button
                  key={item.id}
                  className="native-context-menu-item"
                  disabled={item.enabled === false}
                  onClick={() => handleContextAction(item.id, contextMenu.accessory)}
                >
                  {item.label}
                </button>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}

function NavButton({
  children,
  icon,
  active,
  onClick,
}: {
  children: ReactNode;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`nav-button ${active ? 'active' : ''}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
function Section({
  className,
  title,
  subtitle,
  action,
  onAction,
  children,
}: {
  className?: string;
  title: string;
  subtitle: string;
  action: string;
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`home-section ${className ?? ''}`}>
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <button onClick={onAction}>
          {action}
          <ChevronRight size={15} />
        </button>
      </div>
      {children}
    </section>
  );
}
function Empty({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
function AccessoryTile({
  accessory: a,
  room,
  favorite,
  hidden = false,
  isDragging = false,
  isDragOver = false,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onContextMenu,
  onRestore,
  onOpen,
  onQuick,
}: {
  accessory: HausAccessory;
  room?: string;
  favorite: boolean;
  hidden?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onRestore?: () => void;
  onOpen: () => void;
  onQuick: () => void;
}) {
  const appearance = deviceAppearance(a.state);
  const active = appearance.active;
  const swatch = appearance.actualColor;
  const slowPending = useDelayedPending(Boolean(a.pending), a.pendingSince);
  // Retain the last output while the wash fades out, rather than fading via white.
  const [outputAccent, setOutputAccent] = useState(appearance.accent);
  if (active && outputAccent !== appearance.accent) setOutputAccent(appearance.accent);
  return (
    <article
      style={{ '--device-color': outputAccent } as CSSProperties}
      className={`accessory-tile accessory-${a.category} ${active ? 'is-active' : ''} ${a.availability !== 'available' ? 'is-unavailable' : ''} ${isDragging ? 'is-dragging' : ''} ${isDragOver ? 'is-drag-over' : ''}`}
      data-pending={a.pending || undefined}
      draggable={!hidden}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
    >
      <div className="tile-top">
        <button
          className="accessory-icon"
          aria-label={`Quick control ${a.name}`}
          onClick={onQuick}
          disabled={a.availability !== 'available'}
        >
          <AccessoryIcon accessory={a} />
        </button>
        <span>
          {slowPending && (
            <span className="tile-pending-indicator" aria-label="Updating device" title="Updating…">
              <LoaderCircle size={13} className="spin" />
            </span>
          )}
          {favorite ? <Heart size={13} fill="currentColor" /> : null}
          {a.lightGroup && (
            <b
              className="light-group-count"
              aria-label={`${a.lightGroup.members.length} lights grouped`}
            >
              {a.lightGroup.members.length}
            </b>
          )}
          {swatch ? (
            <i
              className="light-color-swatch"
              style={{ background: swatch }}
              title="Current light color"
            />
          ) : (
            <i className={active ? 'on' : ''} />
          )}
        </span>
      </div>
      <button className="tile-body" onClick={onOpen}>
        <small>
          {room ?? 'Other'}
          {deviceSource(a.name) && (
            <b className="scene-source-badge scene-source-inline device-source-badge">Hue</b>
          )}
        </small>
        <strong>
          {deviceDisplayName(a.name, room, titleCase(a.primaryEntityId.split('.')[0]))}
        </strong>
        <span key={`${a.state.state}:${describe(a)}`} className="device-state-text">
          {describe(a)}
        </span>
      </button>
      <button
        className="tile-more"
        aria-label={`Options for ${a.name}`}
        onClick={(e) => {
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          if (onContextMenu) {
            onContextMenu(e);
          } else {
            onOpen();
          }
        }}
      >
        <MoreHorizontal size={17} />
      </button>
      {hidden && onRestore && (
        <button className="tile-restore" onClick={onRestore}>
          <Eye size={14} />
          Restore to app
        </button>
      )}
    </article>
  );
}
export function Dialog({
  title,
  onClose,
  children,
  className = '',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container>
          <Modal.Dialog className={`haus-dialog ${className}`}>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{title}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <ScrollShadow
                className="haus-dialog-scroll"
                orientation="vertical"
                size={24}
                hideScrollBar
              >
                {children}
              </ScrollShadow>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
function ConnectDialog({
  onClose,
  connect,
  onConnected,
  currentUrl,
}: {
  onClose: () => void;
  connect: (url: string) => Promise<void>;
  onConnected: () => void;
  currentUrl?: string;
}) {
  const [servers, setServers] = useState<DiscoveredServer[]>([]);
  const [url, setUrl] = useState(currentUrl ?? '');
  const [searching, setSearching] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (window.hausNative)
      void window.hausNative
        .discover()
        .then((s) => {
          if (active) setServers(s);
        })
        .catch((e) => {
          if (active) setError(message(e));
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    else setSearching(false);
    return () => {
      active = false;
    };
  }, []);
  const submit = async (value: string) => {
    setError('');
    setPending(true);
    try {
      await connect(value);
      onConnected();
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog title="Let’s bring your home closer." onClose={onClose} className="connect-dialog">
      <div className="connect-illustration">
        <span />
        <House size={55} strokeWidth={1.2} />
        <i>
          <Wifi size={19} />
        </i>
      </div>
      <p className="dialog-description">
        Connect Home Assistant and all your rooms, accessories, and scenes will feel right at home.
      </p>
      <div className="discovery-label">
        {searching ? (
          <>
            <LoaderCircle className="spin" size={15} />
            Looking for your home…
          </>
        ) : (
          <>
            <Radio size={15} />
            {servers.length ? 'FOUND ON YOUR NETWORK' : 'YOUR HOME ASSISTANT'}
          </>
        )}
      </div>
      {servers.map((s) => (
        <button
          className="discovered-server"
          key={s.url}
          onClick={() => void submit(s.url)}
          disabled={pending}
        >
          <span className="home-avatar">
            <House size={20} />
          </span>
          <span>
            <strong>{s.name}</strong>
            <small>{s.url}</small>
          </span>
          <ArrowRight size={19} />
        </button>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(url);
        }}
      >
        <label htmlFor="ha-url">Home Assistant address</label>
        <input
          id="ha-url"
          type="url"
          placeholder="http://homeassistant.local:8123"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={pending}
        />
        <p className="input-hint">You’ll sign in securely in your browser. No API token needed.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="connect-submit"
          isPending={pending}
          isDisabled={!url || pending}
        >
          {pending ? (
            <>
              <LoaderCircle size={17} className="spin" />
              Complete sign-in in your browser…
            </>
          ) : (
            <>
              Connect your home
              <ArrowRight size={17} />
            </>
          )}
        </Button>
      </form>
      <button className="connect-later" onClick={onClose}>
        Keep exploring for now
      </button>
    </Dialog>
  );
}
