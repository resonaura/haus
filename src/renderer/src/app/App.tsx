import { createDeviceActions } from '../features/devices/device-actions';
import { useAccessoryContextMenu } from '../features/devices/useAccessoryContextMenu';
import {
  DeviceControl,
  CameraModal,
  LightGroupControl,
  StatisticsPanel,
  AddDeviceFlow,
  ConnectionsPage,
  DeviceInventory,
  RoomsPage,
  SettingsPage,
  ServersPage,
  AttentionPage,
  ConnectDialog,
} from './deferred-features';
import { Deferred } from '../components/ui/Deferred';
import { AppNotifications } from '../components/ui/AppNotifications';
import { AccessoryGrid } from '../features/devices/AccessoryGrid';
import { DeviceGroups } from '../features/devices/DeviceGroups';
import { ContextMenu } from '../components/ui/ContextMenu';
import { useHomeView } from '../features/home/useHomeView';
import { categories } from '../model/categories';
import { HomeOverview } from '../features/home/HomeOverview';
import { ServerCollection } from '../features/servers/ServerCollection';
import { Sidebar } from './shell/Sidebar';
import { Topbar } from './shell/Topbar';
import { HomeStartup } from './shell/HomeStartup';
import { type Route } from './navigation';
import { titleCase } from '../model/presentation';
import { isEntityActive } from '../model/device-appearance';

import { Dialog } from '../components/ui/Dialog';
import { Section } from '../components/ui/Section';
import { EmptyState as Empty } from '../components/ui/EmptyState';
import { AutomationsPage } from '../features/automations/AutomationsPage';
import { useModalMaterial } from '../hooks/useModalMaterial';
import { lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, ScrollShadow } from '@heroui/react';
import {
  Archive,
  ArrowDownToLine,
  ArrowLeft,
  Eye,
  Heart,
  House,
  LayoutGrid,
  Plus,
  Radio,
  Search,
  Sparkles,
  RefreshCw,
  Settings,
  Server,
  Plug,
} from 'lucide-react';
import { useHaus, message } from '../hooks/useHaus';
import { useNativeSidebar } from '../hooks/useNativeSidebar';
import { useHomeNotifications } from '../hooks/useHomeNotifications';
import { generateDashboard, type HausAccessory, type HassEntity } from '../model';
import { buildInventory } from '../model/inventory';
import { categoryIcons } from '../components/icons/Icon';
import { HAUS_DASHBOARD_PATH, syncDashboard } from '../ha/dashboard-sync';
import { CameraPreview } from '../features/cameras/CameraCard';
import { CameraCollection } from '../features/cameras/CameraCollection';

import { SceneCollection } from '../features/scenes/SceneCollection';
import { HomeCategoryDock } from '../features/home/HomeCategoryDock';

import { Spotlight } from '../features/search/Spotlight';
import { RoomIconPicker } from '../features/rooms/RoomIconPicker';

import { homeControls, stableQuickControls } from '../model/home-controls';
import type { ServerDevicePreference } from '../model/preferences';
import type { HomeServer } from '../features/servers/types';
import { ServerIcon } from '../components/icons/ServerIcon';

const RoomServers = lazy(() =>
  import('../features/servers/RoomServers').then((module) => ({ default: module.RoomServers })),
);

const isActive = (accessory: HausAccessory) => isEntityActive(accessory.state);

export function App() {
  const haus = useHaus();
  const { snapshot, model, mode, status, preferences, notify } = haus;
  const visibleDeviceCount = useMemo(
    () => buildInventory(snapshot, model.accessories).length,
    [snapshot, model.accessories],
  );
  const homeNotices = useHomeNotifications(
    snapshot,
    mode === 'live' && status === 'connected',
    haus.session?.url,
  );
  const [route, setRoute] = useState<Route>({ kind: 'home' });
  const [selectedServerId, setSelectedServerId] = useState<string>();
  const [selectedServer, setSelectedServer] = useState<HomeServer>();
  const [serverTab, setServerTab] = useState('overview');
  const [serverActionsContainer, setServerActionsContainer] = useState<HTMLDivElement | null>(null);
  const [serverStatus, setServerStatus] = useState<'online' | 'offline' | 'paused' | 'unknown'>(
    'unknown',
  );
  const isServers = route.kind === 'servers' || route.kind === 'nvr';
  const isServerDetail = isServers && Boolean(selectedServerId);
  const selectedServerName =
    preferences.serverDevices?.[selectedServerId ?? '']?.name ?? selectedServer?.name ?? 'Server';
  const isHomeOverview = route.kind === 'home' || route.kind === 'category' || isServers;
  const [selected, setSelected] = useState<string | null>(null);
  const [controllerEntityId, setControllerEntityId] = useState<string | null>(null);
  const [camera, setCamera] = useState<HassEntity | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [addDeviceOpen, setAddDeviceOpen] = useState(false);
  const [dashboardBusy, setDashboardBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useNativeSidebar(sidebarOpen);
  useModalMaterial();
  const [roomCategory, setRoomCategory] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const accessory = model.accessories.find((a) => a.primaryEntityId === selected);
  const [selectedLightGroup, setSelectedLightGroup] = useState<{
    key: string;
    memberIds: string[];
  } | null>(null);
  const view = useHomeView({ model, snapshot, preferences, route, search: '', selectedLightGroup });
  const {
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
    scenesForRoom,
    sortedHomeScenes,
    hiddenCameraMatches,
    hiddenSceneMatches,
    hiddenCount: hiddenAccessoryCount,
    orderedRooms,
    homeRooms,
    navigationRooms,
    appAttention,
    homeAttention,
    homeCameras,
    homeCamerasForRoom,
    indoorTemperature,
    appScenes,
  } = view;
  const hiddenServerCount = Object.values(preferences.serverDevices ?? {}).filter(
    (preference) => preference.appHidden,
  ).length;
  const hiddenCount = hiddenAccessoryCount + hiddenServerCount;
  const actions = createDeviceActions({
    haus,
    view,
    onSelect: setSelected,
    onControllerEntity: setControllerEntityId,
    onCamera: setCamera,
    onLightGroup: setSelectedLightGroup,
    onConnect: () => setConnectOpen(true),
  });
  const {
    run,
    runLightGroup,
    separateLights,
    restoreFromApp,
    toggleAppVisibility,
    toggleHomeVisibility,
    openAccessory,
    quick,
    sceneRun,
    openServer,
    toggleFavorite,
  } = actions;
  const { contextMenu, closeContextMenu, handleContextAction, showAccessoryContextMenu } =
    useAccessoryContextMenu({ haus, view, actions });
  const dashboardUrl =
    haus.session && preferences.hausDashboard
      ? `${haus.session.url}/${preferences.hausDashboard.urlPath}`
      : '';
  const room = route.kind === 'room' ? model.rooms.find((r) => r.id === route.id) : undefined;
  const setRoomIcon = (areaId: string, icon: string) =>
    haus.savePreferences({
      roomIcons: { ...preferences.roomIcons, [areaId]: icon },
    });
  const saveServerDevice = (id: string, value: ServerDevicePreference) =>
    haus.savePreferences({ serverDevices: { ...preferences.serverDevices, [id]: value } });
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
            : route.kind === 'nvr' || route.kind === 'servers'
              ? 'Servers'
              : titleCase(route.kind);
  const go = (next: Route) => {
    setServerStatus('unknown');
    setSelectedServerId(undefined);
    setSelectedServer(undefined);
    setServerTab('overview');
    setRoute(next);
    setSearchQuery('');
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
        setTimeout(() => document.querySelector<HTMLInputElement>('.spotlight-input')?.focus(), 30);
      }
      if (event.key === 'Escape') {
        closeContextMenu();
        setSearchOpen(false);
        setSearchQuery('');
      }
    };
    window.addEventListener('keydown', listener);
    return () => {
      window.removeEventListener('keydown', listener);
    };
  }, [closeContextMenu]);
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
      (route.kind !== 'room' || a.areaId === route.id),
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
  const hasServerFavorites = Object.values(preferences.serverDevices ?? {}).some(
    (preference) => preference.favorite && !preference.appHidden,
  );
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
    className = 'accessory-grid',
    scopeKey = `scope:${route.kind}`,
    children?: ReactNode,
  ) => (
    <AccessoryGrid
      key={scopeKey}
      items={items}
      hiddenView={hiddenView}
      className={className}
      scopeKey={scopeKey}
      isHomeOverview={isHomeOverview}
      search=""
      preferences={preferences}
      rooms={model.rooms}
      appHidden={appHidden}
      homeHidden={homeHidden}
      isFavorite={isFavorite}
      savePreferences={haus.savePreferences}
      onContextMenu={showAccessoryContextMenu}
      onRestore={restoreFromApp}
      onOpen={openAccessory}
      onQuick={quick}
      children={children}
    />
  );
  const renderGroupedGrid = (
    items: HausAccessory[],
    grouping: 'category' | 'room',
    hiddenView = false,
  ) => (
    <DeviceGroups
      items={items}
      grouping={grouping}
      hiddenView={hiddenView}
      preferences={preferences}
      search=""
      orderedRooms={orderedRooms}
      model={model}
      scrollRef={scrollRef}
      route={route}
      go={go}
      renderGrid={renderGrid}
    />
  );
  const sceneControls = {
    demo: mode === 'demo',
    onSaved: () => void haus.refresh(),
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
  const renderCameras = (cameras: HassEntity[] = appCameras, horizontal = false) => (
    <CameraCollection
      cameras={cameras}
      allCameraIds={model.cameras.map((item) => item.entity_id)}
      demo={mode === 'demo'}
      paused={Boolean(camera)}
      horizontal={horizontal}
      homeOverview={route.kind === 'home'}
      preferences={preferences}
      savePreferences={haus.savePreferences}
      roomName={(item) => model.rooms.find((room) => room.id === cameraOwner(item)?.areaId)?.name}
      homeHidden={(item) => {
        const owner = cameraOwner(item);
        return owner ? homeHidden(owner) : hiddenHomeIds.has(item.entity_id);
      }}
      appHidden={(item) => {
        const owner = cameraOwner(item);
        return owner ? appHidden(owner) : hiddenAppIds.has(item.entity_id);
      }}
      onOpen={setCamera}
      onToggleHome={(item) => toggleHomeVisibility(item.entity_id)}
      onToggleApp={(item) => toggleAppVisibility(item.entity_id)}
      onError={(error) => notify(message(error))}
    />
  );
  return (
    <div className={`app-shell ${sidebarOpen ? 'sidebar-is-open' : ''}`}>
      <Sidebar
        route={route}
        go={go}
        categories={navigationCategories}
        rooms={navigationRooms}
        roomIcons={preferences.roomIcons}
        cameraCount={appCameras.length}
        deviceCount={visibleDeviceCount}
        hiddenCount={hiddenCount}
        serverContext={
          isServerDetail
            ? {
                name: selectedServerName,
                icon: (
                  <ServerIcon
                    server={
                      selectedServer ?? {
                        kind: selectedServerId === 'home-assistant' ? 'home-assistant' : 'nvr',
                      }
                    }
                    icon={preferences.serverDevices?.[selectedServerId ?? '']?.icon}
                    size={22}
                  />
                ),
                status: serverStatus,
                activeTab: serverTab,
                admin: snapshot.user.is_admin,
                onTabChange: (tab) => {
                  setServerTab(tab);
                  setSidebarOpen(false);
                  scrollRef.current?.scrollTo({ top: 0 });
                },
                onBack: () => {
                  setSelectedServerId(undefined);
                  setSelectedServer(undefined);
                  setServerTab('overview');
                },
              }
            : undefined
        }
      />
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <main className="main-panel">
        <Topbar
          route={route}
          heading={isServerDetail ? selectedServerName : heading}
          homeName={snapshot.config.location_name}
          mode={mode}
          notificationCount={homeNotices.notifications.length}
          attentionCount={appAttention.length}
          userName={snapshot.user.name}
          onOpenNavigation={() => setSidebarOpen(true)}
          onSearch={() => setSearchOpen((open) => !open)}
          go={go}
        />
        <Spotlight
          isOpen={searchOpen}
          demo={mode === 'demo'}
          serverDevices={preferences.serverDevices}
          scope={`${haus.session?.url ?? mode}:${String(snapshot.user.id ?? '')}`}
          favorites={preferences.favorites}
          actions={[
            {
              id: 'add-device',
              title: 'Add a device',
              subtitle: 'Connect a camera or another accessory',
              keywords: 'pair camera integration',
              icon: <Plus size={17} />,
              onAction: () => (mode === 'demo' ? setConnectOpen(true) : setAddDeviceOpen(true)),
            },
            {
              id: 'servers',
              title: 'Servers',
              subtitle: 'Storage, backups and home services',
              keywords: 'nvr recordings disk cpu ram',
              icon: <Server size={17} />,
              onAction: () => go({ kind: 'servers' }),
            },
            {
              id: 'integrations',
              title: 'Manage integrations',
              subtitle: 'Connections and accounts in your home',
              keywords: 'xiaomi hue eufy',
              icon: <Plug size={17} />,
              onAction: () => go({ kind: 'integrations' }),
            },
            {
              id: 'settings',
              title: 'Settings',
              subtitle: 'Appearance and preferences',
              keywords: 'theme dark light system',
              icon: <Settings size={17} />,
              onAction: () => go({ kind: 'settings' }),
            },
            {
              id: 'scenes',
              title: 'Scenes',
              subtitle: 'Create or edit a scene',
              keywords: 'automation accessories',
              icon: <Sparkles size={17} />,
              onAction: () => go({ kind: 'scenes' }),
            },
            {
              id: 'hidden',
              title: 'Hidden devices',
              subtitle: 'Find devices hidden from Haus',
              keywords: 'show restore visibility',
              icon: <Eye size={17} />,
              onAction: () => go({ kind: 'hidden' }),
            },
            {
              id: 'rooms',
              title: 'Manage rooms',
              subtitle: 'Names, icons and devices',
              keywords: 'move organize',
              icon: <House size={17} />,
              onAction: () => go({ kind: 'rooms' }),
            },
          ]}
          query={searchQuery}
          model={model}
          categories={navigationCategories}
          accessories={visibleAccessories}
          cameras={appCameras}
          scenes={appScenes}
          onQueryChange={setSearchQuery}
          onClose={() => {
            setSearchOpen(false);
            setSearchQuery('');
          }}
          onOpenAccessory={openAccessory}
          onOpenCamera={setCamera}
          onOpenRoom={(id) => go({ kind: 'room', id })}
          onOpenCategory={(id) => go({ kind: 'category', id })}
          onOpenScenes={() => go({ kind: 'scenes' })}
          onOpenServer={(id) => {
            go({ kind: 'servers' });
            setSelectedServerId(id);
          }}
        />
        {haus.homeState !== 'ready' && (
          <HomeStartup
            failed={haus.homeState === 'error'}
            errorMessage={haus.homeError}
            onRetry={() => void haus.refresh()}
            onConnect={() => setConnectOpen(true)}
          />
        )}
        <ScrollShadow
          hidden={haus.homeState !== 'ready'}
          isEnabled={!isHomeOverview && !camera}
          className="main-scroll"
          orientation="vertical"
          size={isHomeOverview ? 0 : 36}
          ref={scrollRef}
        >
          <div
            className={`page-content ${isHomeOverview ? 'home-overview' : ''} ${isServerDetail ? 'server-detail-page' : ''} ${isServerDetail && serverTab === 'storage' ? 'server-disks-page' : ''}`}
          >
            <div className="page-heading" hidden={isServerDetail}>
              <div>
                <div className="eyebrow">
                  {isServers
                    ? 'HOME SERVERS'
                    : isHomeOverview
                      ? 'HAUS OVERVIEW'
                      : route.kind === 'room'
                        ? 'ROOM OVERVIEW'
                        : route.kind === 'hidden'
                          ? 'DEVICE VISIBILITY'
                          : 'THOUGHTFULLY CONNECTED'}
                </div>
                {room ? (
                  <div className="page-title-line">
                    <RoomIconPicker
                      name={room.name}
                      value={preferences.roomIcons?.[room.id]}
                      onChange={(icon) => setRoomIcon(room.id, icon)}
                    />
                    <h1>{heading}</h1>
                  </div>
                ) : (
                  <h1>{heading}</h1>
                )}
                <p>
                  {route.kind === 'home'
                    ? 'Your home. A little closer.'
                    : route.kind === 'category'
                      ? `${filtered.length} ${filtered.length === 1 ? 'device' : 'devices'} in ${categoryRoomCount} ${categoryRoomCount === 1 ? 'room' : 'rooms'}${categoryActiveCount ? ` · ${categoryActiveCount} active` : ''}`
                      : route.kind === 'room'
                        ? `${filtered.length} devices${roomCameras.length ? ` · ${roomCameras.length} ${roomCameras.length === 1 ? 'camera' : 'cameras'}` : ''} · Make yourself comfortable.`
                        : route.kind === 'rooms'
                          ? 'Create rooms, choose icons and keep devices together.'
                          : route.kind === 'devices'
                            ? 'Find, rename and organize devices across your home.'
                            : route.kind === 'hidden'
                              ? `${hiddenCount} ${hiddenCount === 1 ? 'item' : 'items'} hidden from Haus. Restore any of them whenever you like.`
                              : route.kind === 'nvr' || route.kind === 'servers'
                                ? 'The machines that keep your home running.'
                                : route.kind === 'settings'
                                  ? 'A home that works your way.'
                                  : route.kind === 'statistics'
                                    ? mode === 'demo'
                                      ? 'Connect Home Assistant to explore its long-term sensor history.'
                                      : 'Long-term sensor statistics recorded by Home Assistant.'
                                    : 'Your home, thoughtfully connected.'}
                </p>
              </div>
              <div
                className="heading-actions"
                ref={isServers ? setServerActionsContainer : undefined}
              >
                {!isHomeOverview && (
                  <button
                    className="icon-button back-button"
                    aria-label="Back to home"
                    onClick={() => go({ kind: 'home' })}
                  >
                    <ArrowLeft size={20} />
                  </button>
                )}
                {mode === 'live' && !isServers && (
                  <button
                    className="icon-button"
                    aria-label="Refresh home"
                    title="Refresh devices from Home Assistant"
                    onClick={() => void haus.refresh()}
                  >
                    <RefreshCw size={17} />
                  </button>
                )}
                {(!isServers || mode === 'demo') && (
                  <Button
                    aria-label={mode === 'demo' ? 'Connect your home' : 'Add device'}
                    className="add-button"
                    variant="outline"
                    onPress={() =>
                      mode === 'demo' ? setConnectOpen(true) : setAddDeviceOpen(true)
                    }
                  >
                    <Plus size={17} />
                    <span>{mode === 'demo' ? 'Connect your home' : 'Add device'}</span>
                  </Button>
                )}
              </div>
            </div>
            {isHomeOverview && !isServerDetail && (
              <HomeCategoryDock
                categories={[
                  ...homeCategoryItems.filter((category) => category.id !== 'other'),
                  { id: 'servers', name: 'Servers', summary: 'Storage & services' },
                  ...homeCategoryItems.filter((category) => category.id === 'other'),
                ]}
                selected={isServers ? 'servers' : route.kind === 'category' ? route.id : null}
                onSelect={(id) =>
                  go(
                    id === 'servers'
                      ? { kind: 'servers' }
                      : id
                        ? { kind: 'category', id }
                        : { kind: 'home' },
                  )
                }
              />
            )}
            {route.kind === 'home' && (
              <HomeOverview
                key={haus.session?.url ?? 'demo'}
                mode={mode}
                preferences={preferences}
                homeCameras={homeCameras}
                sortedHomeScenes={sortedHomeScenes}
                homeQuickControls={homeQuickControls}
                hasHomeFavorites={hasHomeFavorites}
                homeAttention={homeAttention}
                homeRooms={homeRooms}
                scrollRef={scrollRef}
                go={go}
                renderGrid={renderGrid}
                renderCameras={renderCameras}
                renderScenes={renderScenes}
                homeCamerasForRoom={homeCamerasForRoom}
                setRoomIcon={setRoomIcon}
                serverRooms={orderedRooms}
                serverDevices={preferences.serverDevices ?? {}}
                onOpenServer={(id) => {
                  go({ kind: 'servers' });
                  setSelectedServerId(id);
                }}
                onServerDeviceChange={saveServerDevice}
              />
            )}
            {route.kind === 'category' && (
              <div className="home-filter-content" key={route.id}>
                {route.id === 'security' && homeCameras.length > 0 && (
                  <Section
                    className="home-section-unboxed overview-cameras"
                    title="Cameras"
                    subtitle={`${homeCameras.length} views of home.`}
                    action="All cameras"
                    onAction={() => go({ kind: 'cameras' })}
                  >
                    {renderCameras(homeCameras)}
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
            {['room', 'favorites', 'hidden'].includes(route.kind) && (
              <>
                {route.kind === 'room' && roomCameras.length > 0 && (
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
                {route.kind === 'room' && effectiveRoomCategory === 'all' && (
                  <Deferred>
                    <RoomServers
                      key={`${haus.session?.url ?? 'demo'}:${route.id}`}
                      demo={mode === 'demo'}
                      areaId={route.id}
                      rooms={model.rooms}
                      serverDevices={preferences.serverDevices ?? {}}
                      onServerDeviceChange={saveServerDevice}
                      onOpen={(id) => {
                        go({ kind: 'servers' });
                        setSelectedServerId(id);
                      }}
                    />
                  </Deferred>
                )}
                {route.kind === 'room' && scenesForRoom(route.id).length > 0 && (
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
                {route.kind === 'room' && roomCategories.length > 0 && (
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
                {route.kind === 'favorites' && (
                  <>
                    <ServerCollection
                      demo={mode === 'demo'}
                      rooms={model.rooms}
                      preferences={preferences.serverDevices ?? {}}
                      mode="favorites"
                      onOpen={(id) => {
                        go({ kind: 'servers' });
                        setSelectedServerId(id);
                      }}
                      onSave={saveServerDevice}
                    />
                    {!favorites.length && !hasServerFavorites && (
                      <p className="page-tip">
                        <Heart size={16} />
                        Open a device or server and add it to Favorites.
                      </p>
                    )}
                  </>
                )}
                {route.kind === 'hidden' ? (
                  <>
                    {hiddenServerCount > 0 && (
                      <ServerCollection
                        key={haus.session?.url ?? 'demo'}
                        demo={mode === 'demo'}
                        rooms={model.rooms}
                        preferences={preferences.serverDevices ?? {}}
                        mode="hidden"
                        onOpen={(id) => {
                          go({ kind: 'servers' });
                          setSelectedServerId(id);
                        }}
                        onSave={saveServerDevice}
                      />
                    )}
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
                      !hiddenServerCount &&
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
                    {!(route.kind === 'favorites' ? favorites : filtered).length &&
                      (route.kind !== 'favorites' || !hasServerFavorites) && (
                        <Empty
                          icon={<Search />}
                          title="Make this space yours"
                          description="Accessories appear here as you add them to your home."
                        />
                      )}
                  </>
                )}
              </>
            )}
            {route.kind === 'statistics' && (
              <Deferred>
                <StatisticsPanel mode={mode} states={snapshot.states} />
              </Deferred>
            )}
            {route.kind === 'scenes' && (
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
            {route.kind === 'rooms' && (
              <Deferred>
                <RoomsPage
                  snapshot={snapshot}
                  registry={haus.registry}
                  roomIcons={preferences.roomIcons}
                  onIcon={setRoomIcon}
                  onOpen={(id) => go({ kind: 'room', id })}
                  onDevices={() => go({ kind: 'devices', areaId: 'unassigned' })}
                  notify={notify}
                />
              </Deferred>
            )}
            {route.kind === 'devices' && (
              <Deferred>
                <DeviceInventory
                  key={route.areaId ?? 'all'}
                  initialArea={route.areaId}
                  snapshot={snapshot}
                  accessories={model.accessories}
                  onOpen={openAccessory}
                  registry={haus.registry}
                  notify={notify}
                  onAdd={() => setAddDeviceOpen(true)}
                />
              </Deferred>
            )}
            {(route.kind === 'integrations' || route.kind === 'addons') && (
              <Deferred>
                <ConnectionsPage
                  key={route.kind}
                  kind={route.kind}
                  demo={mode === 'demo'}
                  snapshot={snapshot}
                  openServer={openServer}
                  onAdd={() => setAddDeviceOpen(true)}
                />
              </Deferred>
            )}
            {route.kind === 'cameras' &&
              (appCameras.length ? (
                renderCameras()
              ) : (
                <Empty
                  icon={<Radio />}
                  title="No cameras in Haus"
                  description="Cameras you hide from the app can be restored from Hidden."
                />
              ))}
            {route.kind === 'attention' && (
              <Deferred>
                <AttentionPage
                  homeNotices={homeNotices}
                  appAttention={appAttention}
                  onOpenEntity={(id) => {
                    const owner = model.accessories.find((item) => item.entityIds.includes(id));
                    if (owner) openAccessory(owner);
                    else setSelected(id);
                  }}
                  notify={notify}
                  openServer={openServer}
                />
              </Deferred>
            )}
            {route.kind === 'automations' && (
              <AutomationsPage
                states={snapshot.states}
                snapshot={snapshot}
                demo={mode === 'demo'}
                onSaved={() => void haus.refresh()}
                onAction={run}
                openServer={openServer}
              />
            )}
            {(route.kind === 'nvr' || route.kind === 'servers') && (
              <Deferred>
                <ServersPage
                  key={haus.session?.url ?? 'demo'}
                  demo={mode === 'demo'}
                  admin={snapshot.user.is_admin}
                  rooms={model.rooms}
                  roomIcons={preferences.roomIcons}
                  onOpenRoom={(id) => go({ kind: 'room', id })}
                  scrollRef={scrollRef}
                  actionsContainer={serverActionsContainer}
                  serverDevices={preferences.serverDevices}
                  onServerDeviceChange={saveServerDevice}
                  initialServerId={selectedServerId}
                  onOpenServer={(id) => {
                    setSelectedServerId(id);
                    setServerTab('overview');
                    scrollRef.current?.scrollTo({ top: 0 });
                  }}
                  onServerChange={setSelectedServer}
                  onServerStatusChange={setServerStatus}
                  activeTab={serverTab}
                  onTabChange={setServerTab}
                  contextualNavigation={isServerDetail}
                />
              </Deferred>
            )}
            {route.kind === 'settings' && (
              <Deferred>
                <SettingsPage
                  mode={mode}
                  snapshot={snapshot}
                  status={status}
                  preferences={preferences}
                  preferenceSync={haus.preferenceSync}
                  session={haus.session}
                  savePreferences={haus.savePreferences}
                  onConnect={() => setConnectOpen(true)}
                  onDisconnect={haus.disconnect}
                  go={go}
                  onPreviewDashboard={() => setDashboardOpen(true)}
                  createDashboard={createDashboard}
                  dashboardBusy={dashboardBusy}
                  dashboardUrl={dashboardUrl}
                />
              </Deferred>
            )}
            <footer className="page-footer">
              <span>
                <House size={14} /> A little closer to home.
              </span>
              {mode === 'demo' && <span>Sample home · Changes stay in this demo</span>}
            </footer>
          </div>
        </ScrollShadow>
      </main>
      {addDeviceOpen && (
        <Deferred overlay>
          <AddDeviceFlow
            onClose={() => setAddDeviceOpen(false)}
            demo={mode === 'demo'}
            snapshot={snapshot}
            onDone={() => {
              void haus.refresh();
            }}
            onConnect={() => setConnectOpen(true)}
          />
        </Deferred>
      )}
      {accessory && (
        <Deferred overlay>
          <DeviceControl
            key={accessory.primaryEntityId}
            accessory={accessory}
            snapshot={snapshot}
            favorite={isFavorite(accessory)}
            demo={mode === 'demo'}
            initialEntityId={controllerEntityId ?? undefined}
            theme={haus.appearance}
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
        </Deferred>
      )}
      {lightGroup && (
        <Deferred overlay>
          <LightGroupControl
            accessory={lightGroup}
            theme={haus.appearance}
            room={model.rooms.find((room) => room.id === lightGroup.areaId)?.name}
            onClose={() => setSelectedLightGroup(null)}
            onAction={(action) => runLightGroup(lightGroup, action)}
            onOpenMember={(member) => {
              setSelectedLightGroup(null);
              openAccessory(member);
            }}
            onSeparate={() => separateLights(lightGroup)}
          />
        </Deferred>
      )}
      {camera && (
        <Deferred overlay>
          <CameraModal
            talkProviderHint={
              snapshot.devices.some(
                (device) =>
                  /eufy/i.test(device.manufacturer ?? '') &&
                  snapshot.entities.some(
                    (entry) =>
                      entry.device_id === device.id &&
                      [camera.entity_id, `${camera.entity_id}_internal`].includes(entry.entity_id),
                  ),
              )
                ? 'eufy'
                : undefined
            }
            room={model.rooms.find((room) => room.id === cameraOwner(camera)?.areaId)?.name}
            entity={model.cameras.find((item) => item.entity_id === camera.entity_id) ?? camera}
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
        </Deferred>
      )}
      {connectOpen && (
        <Deferred overlay>
          <ConnectDialog
            currentUrl={haus.session?.url}
            onClose={() => setConnectOpen(false)}
            connect={haus.connect}
            onConnected={() => {
              setConnectOpen(false);
              notify('Welcome home. You’re connected.');
            }}
          />
        </Deferred>
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
      <AppNotifications notifications={haus.notifications} />
      {contextMenu && (
        <ContextMenu
          items={contextMenu.items}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => closeContextMenu()}
          onAction={(id) => handleContextAction(id, contextMenu.accessory)}
        />
      )}
    </div>
  );
}
