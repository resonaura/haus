/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useMemo, useState } from 'react';
import { useWindowSize } from '@gpuix/react';
import { mergeRoomIcons, type EditableKind } from '@haus/core/transport';
import type { HassEntity } from '@haus/ha/types';
import { DesktopTopbar, type SidebarContextualNav } from '@haus/ui/components';
import { colorToken, insets, pct, px, SolidMaterial } from '@haus/ui/ir';
import { Box, HausUiProvider, Stack, Text } from '@haus/ui/primitives';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { DesktopShell, type HomeRoute } from '../shell.js';
import { CameraPreviews, DeviceCards, SceneCards } from './cards.js';
import { WorkspaceCategoryRail, WorkspacePageHeader } from './header.js';
import { useGpuiAlerts } from './hub-alerts.js';
import {
  buildWorkspaceSpotlightItems,
  openCameraContextMenu,
  openDeviceContextMenu,
  openSceneContextMenu,
  type ActiveFallbackMenu,
} from './menus.js';
import { navigation, settingsLink, WORKSPACE_ROUTE_LABELS } from './navigation.js';
import type { GpuiAddDeviceRequest } from '../management/add-device.js';
import { WorkspaceOverlays } from './overlays.js';
import { HomeRouteContent } from './routes.js';
import { homeDashboard, type HomeDevice } from './model.js';
import { NON_DEVICE_ROUTES, type HomeWorkspaceProps } from './workspace-props.js';

declare global {
  var hausGpuiRoute: HomeRoute | undefined;
}

export function HomeWorkspace({
  snapshot,
  preferences,
  systemTheme = 'dark',
  reducedTransparency,
  platform,
  alertsTransport,
  management,
  system,
  subscribeKeyDown,
  sidebar,
  streaming,
  cameraApi,
  demo,
  disabled = false,
  canFavorite = false,
  registry,
  statistics,
  fetchCameraSnapshot,
  onApplySceneEntities,
  sessionMeta,
  notice,
  onControl,
  onFavorite,
  onTheme,
  onGrouping,
  onPreferencesPatch,
  onResetLightGroups,
  onToggleDemo,
  onManage,
  onConnect,
  onRefresh,
  onDisconnect,
}: HomeWorkspaceProps) {
  const home = useMemo(() => homeDashboard(snapshot, preferences), [snapshot, preferences]);
  const roomIcons = useMemo(
    () => mergeRoomIcons(snapshot.areas, preferences.roomIcons),
    [preferences.roomIcons, snapshot.areas],
  );
  const groups = useMemo(() => navigation(home, roomIcons), [home, roomIcons]);
  const [route, setRouteState] = useState<HomeRoute>(() => globalThis.hausGpuiRoute ?? 'home');
  const setRoute = (next: HomeRoute) => {
    globalThis.hausGpuiRoute = next;
    setRouteState(next);
  };
  const [camera, setCamera] = useState<string>();
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [previewScene, setPreviewScene] = useState<HassEntity | null>(null);
  const [editingConfig, setEditingConfig] = useState<{
    kind: EditableKind;
    entity?: HassEntity;
  } | null>(null);
  const [addDevice, setAddDevice] = useState<GpuiAddDeviceRequest | null>(null);
  const [fallbackMenu, setFallbackMenu] = useState<ActiveFallbackMenu | null>(null);
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [serverSidebar, setServerSidebar] = useState<SidebarContextualNav>();
  const activeServerSidebar = route === 'servers' ? serverSidebar : undefined;
  const alerts = useGpuiAlerts({ transport: alertsTransport, states: snapshot.states, demo });
  const { width } = useWindowSize();
  const inset = width <= 760 ? 19 : width <= 1180 ? 25 : 32;
  const columns = width <= 760 ? 2 : width <= 1180 ? 3 : 4;
  const dark = (preferences.theme === 'system' ? systemTheme : preferences.theme) === 'dark';
  const category = route.startsWith('category:')
    ? home.categories.find((item) => item.id === route.slice(9))
    : undefined;
  const room = route.startsWith('room:')
    ? home.navigationRooms.find((item) => item.id === route.slice(5))
    : undefined;
  const roomArea = snapshot.areas.find((area) => area.area_id === room?.id);
  const heading = room?.name ?? category?.name ?? WORKSPACE_ROUTE_LABELS[route] ?? 'Home';
  const go = (next: HomeRoute) => {
    setCamera(undefined);
    setSelectedDeviceId('');
    setFallbackMenu(null);
    setSearch(false);
    setQuery('');
    if (next !== 'servers') setServerSidebar(undefined);
    setRoute(next);
  };
  const openCamera = (id: string) => {
    setFallbackMenu(null);
    setSearch(false);
    setQuery('');
    setSelectedDeviceId('');
    setCamera(id);
  };
  const openDeviceByEntity = (entityOrDeviceId: string) => {
    const target = home.devices.find(
      (item) =>
        item.id === entityOrDeviceId ||
        item.accessory.primaryEntityId === entityOrDeviceId ||
        item.accessory.entityIds.includes(entityOrDeviceId),
    );
    if (!target) return;
    setSearch(false);
    setFallbackMenu(null);
    if (NON_DEVICE_ROUTES.has(route)) setRoute(`category:${target.category}`);
    setSelectedDeviceId(target.id);
  };
  const handleShortcut = (key: string, mod: boolean, preventDefault?: () => void) => {
    const lower = key.toLocaleLowerCase();
    if (mod && lower === 'k') {
      preventDefault?.();
      setSearch((value) => !value);
      return;
    }
    if (mod && (key === ',' || lower === 'comma')) {
      preventDefault?.();
      go('settings');
      return;
    }
    if (lower === 'escape') {
      if (fallbackMenu) setFallbackMenu(null);
      else if (search) {
        setSearch(false);
        setQuery('');
      } else if (camera) setCamera(undefined);
    }
  };
  useEffect(() => {
    if (!subscribeKeyDown) return;
    return subscribeKeyDown((event) => {
      handleShortcut(event.key ?? '', Boolean(event.modifiers?.cmd || event.modifiers?.ctrl), () =>
        event.preventDefault(),
      );
    });
  });

  const renderDevices = (devices: readonly HomeDevice[]) =>
    devices.length ? (
      <DeviceCards
        cards={devices}
        columns={columns}
        snapshot={snapshot}
        preferences={preferences}
        allAccessories={home.devices.map((item) => item.accessory)}
        demo={demo}
        disabled={disabled}
        canFavorite={canFavorite}
        selectedId={selectedDeviceId}
        statistics={statistics}
        registry={registry}
        onSelectId={setSelectedDeviceId}
        onControl={onControl}
        onFavorite={onFavorite}
        onPreferencesPatch={onPreferencesPatch}
        onManage={onManage}
        onContextMenu={(device) =>
          openDeviceContextMenu({
            device,
            home,
            snapshot,
            preferences,
            platform,
            onFallback: setFallbackMenu,
            onCloseFallback: () => setFallbackMenu(null),
            onControl,
            onFavorite,
            onManage,
            onPreferencesPatch,
            onOpenDetails: setSelectedDeviceId,
            registry,
          })
        }
      />
    ) : (
      <Text tone="muted">No devices to show.</Text>
    );
  const renderScenes = (scenes: readonly HassEntity[], showAccessoryCount = true) =>
    scenes.length ? (
      <SceneCards
        scenes={scenes}
        present={home.sceneCard}
        columns={columns}
        snapshot={snapshot}
        disabled={disabled}
        showAccessoryCount={showAccessoryCount}
        onControl={onControl}
        onContextMenu={(scene) =>
          openSceneContextMenu({
            scene,
            home,
            preferences,
            platform,
            canEdit: Boolean(demo || snapshot.user.is_admin),
            onFallback: setFallbackMenu,
            onCloseFallback: () => setFallbackMenu(null),
            onControl,
            onPreviewScene: setPreviewScene,
            onEditScene: (target) => setEditingConfig({ kind: 'scene', entity: target }),
            onOpenScenes: () => go('scenes'),
            onPreferencesPatch,
          })
        }
      />
    ) : (
      <Text tone="muted">No scenes to show.</Text>
    );
  const renderCameras = (cameras: typeof home.cameras) => (
    <CameraPreviews
      cameras={cameras}
      columns={columns}
      demo={demo}
      fetchSnapshot={fetchCameraSnapshot}
      onOpen={openCamera}
      onContextMenu={(cameraId) =>
        openCameraContextMenu({
          cameraId,
          home,
          preferences,
          platform,
          onFallback: setFallbackMenu,
          onCloseFallback: () => setFallbackMenu(null),
          onOpenCamera: openCamera,
          onPreferencesPatch,
        })
      }
    />
  );

  const spotlightItems = search
    ? buildWorkspaceSpotlightItems({
        query,
        home,
        snapshot,
        preferences,
        onGo: go,
        onOpenDevice: openDeviceByEntity,
        onOpenCamera: openCamera,
        onControl,
      })
    : [];

  const openAddDevice = (req?: GpuiAddDeviceRequest) => setAddDevice(req ?? { mode: 'picker' });
  const openExternal = platform?.openExternal;
  const boundOpenExternal = openExternal
    ? (url: string) =>
        sessionMeta?.url
          ? openExternal(url, sessionMeta.url)
          : Promise.reject(new Error('Connect your home first.'))
    : undefined;
  const copyText = platform?.clipboard
    ? (text: string) => void platform.clipboard?.writeText(text).catch(() => undefined)
    : undefined;

  const content = (
    <HomeRouteContent
      route={route}
      home={home}
      snapshot={snapshot}
      preferences={preferences}
      category={category}
      room={room}
      columns={columns}
      demo={demo}
      disabled={disabled}
      canFavorite={canFavorite}
      registry={registry}
      management={management}
      system={system}
      statistics={statistics}
      sessionMeta={sessionMeta}
      alertsNotices={alerts.notices}
      alertsError={alerts.error}
      fetchCameraSnapshot={fetchCameraSnapshot}
      onDismissNotice={(id) => void alerts.dismissNotice(id)}
      onOpenEntity={openDeviceByEntity}
      onOpenCamera={openCamera}
      onGo={go}
      onControl={onControl}
      onApplySceneEntities={onApplySceneEntities}
      onSaved={onRefresh}
      onAddDevice={openAddDevice}
      onTheme={onTheme}
      onGrouping={onGrouping}
      onPreferencesPatch={onPreferencesPatch}
      onResetLightGroups={onResetLightGroups}
      onToggleDemo={onToggleDemo}
      onConnect={onConnect}
      onDisconnect={onDisconnect}
      openExternal={boundOpenExternal}
      openPaths={platform?.openPaths}
      onCopyText={copyText}
      onServerSidebarChange={setServerSidebar}
      renderDevices={renderDevices}
      renderScenes={renderScenes}
      renderCameras={renderCameras}
    />
  );

  return (
    <HausUiProvider
      contentHost={GPUIX_CONTENT_HOST}
      mode={dark ? 'dark' : 'light'}
      reducedTransparency={reducedTransparency}
    >
      <Box
        onKeyDown={(event) =>
          handleShortcut(event.key, Boolean(event.metaKey || event.ctrlKey), () =>
            event.preventDefault(),
          )
        }
        style={{ layout: { width: pct(100), height: pct(100) } }}
      >
        <DesktopShell
          sidebar={sidebar}
          route={route}
          onSelect={go}
          dark={dark}
          groups={groups}
          footer={settingsLink}
          contextual={activeServerSidebar}
          expandedWidth={width > 760 && width <= 1180 ? 215 : undefined}
        >
          {(toggleSidebar, collapsed) => (
            <Stack gapPx={0} style={{ layout: { height: pct(100) } }}>
              <DesktopTopbar
                homeName={snapshot.config.location_name}
                heading={activeServerSidebar?.title ?? (route === 'home' ? 'Overview' : heading)}
                userName={snapshot.user.name}
                demo={demo}
                hasAttention={home.attention.length + alerts.notices.length > 0}
                inset={inset}
                showMenu={width <= 760 || collapsed}
                onOpenNavigation={toggleSidebar}
                onSearch={() => setSearch((value) => !value)}
                onNotifications={() => go('attention')}
                onSettings={() => go('settings')}
              />
              <Box
                style={{
                  layout: { height: px(1), flexShrink: 0 },
                  material: new SolidMaterial(colorToken('borderSubtle')),
                }}
              />
              <Stack
                gapPx={0}
                style={{
                  layout: {
                    flexGrow: 1,
                    minHeight: px(0),
                    overflowY: 'scroll',
                    padding: insets(width <= 760 ? 22 : 27, inset, 22, inset),
                  },
                }}
              >
                {!activeServerSidebar && (
                  <WorkspacePageHeader
                    category={category}
                    room={room}
                    roomArea={roomArea}
                    route={route}
                    search={search}
                    heading={heading}
                    demo={demo}
                    isAdmin={Boolean(snapshot.user.is_admin)}
                    disabled={disabled}
                    registry={registry}
                    onGo={go}
                    onAddDevice={openAddDevice}
                    onConnect={onConnect}
                    onRefresh={onRefresh}
                  />
                )}
                {notice}
                {(route === 'home' || category) && (
                  <WorkspaceCategoryRail
                    categories={home.categories}
                    activeCategory={category}
                    onSelectHome={() => go('home')}
                    onSelectCategory={(id) => go(`category:${id}`)}
                  />
                )}
                {content}
              </Stack>
            </Stack>
          )}
        </DesktopShell>
        <WorkspaceOverlays
          search={search}
          query={query}
          onQueryChange={setQuery}
          spotlightItems={spotlightItems}
          onCloseSearch={() => {
            setSearch(false);
            setQuery('');
          }}
          fallbackMenu={fallbackMenu}
          onCloseMenu={() => setFallbackMenu(null)}
          activePairing={alerts.activePairing}
          platform={platform}
          onDismissPairing={(sessionId) => void alerts.dismissPairing(sessionId)}
          cameraModal={
            camera
              ? {
                  cameraId: camera,
                  snapshot,
                  preferences,
                  allAccessories: home.allAccessories,
                  demo,
                  disabled,
                  streaming,
                  cameraApi,
                  fetchSnapshot: fetchCameraSnapshot,
                  onControl,
                  onToggleFullscreen: platform?.toggleFullscreen,
                  onPreferencesPatch,
                  onClose: () => setCamera(undefined),
                }
              : undefined
          }
          scenePreview={
            previewScene
              ? {
                  scene: previewScene,
                  snapshot,
                  canEdit: Boolean(demo || snapshot.user.is_admin),
                  onClose: () => setPreviewScene(null),
                  onEdit: () => {
                    setEditingConfig({ kind: 'scene', entity: previewScene });
                    setPreviewScene(null);
                  },
                  onApply: () => {
                    onControl(previewScene.entity_id, 'run');
                    setPreviewScene(null);
                  },
                }
              : undefined
          }
          configEditor={
            editingConfig
              ? {
                  kind: editingConfig.kind,
                  entity: editingConfig.entity,
                  snapshot,
                  demo,
                  management,
                  onApplySceneEntities,
                  onClose: () => setEditingConfig(null),
                  onSaved: () => onRefresh?.(),
                }
              : undefined
          }
          addDevice={
            addDevice
              ? {
                  snapshot,
                  demo,
                  management,
                  requestRpc: system?.requestRpc,
                  openExternal: boundOpenExternal,
                  initialRequest: addDevice,
                  onOpenApps: () => {
                    setAddDevice(null);
                    go('addons');
                  },
                  onClose: () => setAddDevice(null),
                  onSaved: () => onRefresh?.(),
                }
              : undefined
          }
        />
      </Box>
    </HausUiProvider>
  );
}
