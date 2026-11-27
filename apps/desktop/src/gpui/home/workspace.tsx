/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowSize } from '@gpuix/react';
import { mergeRoomIcons } from '@haus/core/transport';
import type { HassEntity } from '@haus/ha/types';
import type { HausScrollHandle } from '@haus/ui';
import {
  isStoryboardToggleShortcut,
  type SidebarContextualNav,
} from '@haus/ui/components';
import { pct } from '@haus/ui/ir';
import { Box, HausUiProvider } from '@haus/ui/primitives';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import type { GpuiAddDeviceRequest } from '../management/add-device.js';
import type { HomeRoute } from '../shell.js';
import { resolveModalDevice } from './cards.js';
import { useGpuiBrandIconPort } from './device-icon.js';
import { useGpuiAlerts } from './hub-alerts.js';
import { buildWorkspaceSpotlightItems, type ActiveFallbackMenu } from './menus.js';
import { homeDashboard } from './model.js';
import { navigation, WORKSPACE_ROUTE_LABELS } from './navigation.js';
import { WorkspaceOverlays } from './overlays.js';
import { WorkspaceShellView } from './shell-view.js';
import { NON_DEVICE_ROUTES } from './workspace-props.js';
import type { HomeWorkspaceProps, WorkspaceEditingConfig } from './workspace-props.js';

export function HomeWorkspace(props: HomeWorkspaceProps) {
  const {
    snapshot,
    preferences,
    systemTheme = 'dark',
    reducedTransparency,
    platform,
    management,
    system,
    demo,
    disabled = false,
    canFavorite = false,
    registry,
    sessionMeta,
    onControl,
    onFavorite,
    onPreferencesPatch,
    onRefresh,
  } = props;
  const home = useMemo(() => homeDashboard(snapshot, preferences), [snapshot, preferences]);
  const roomIcons = useMemo(
    () => mergeRoomIcons(snapshot.areas, preferences.roomIcons),
    [preferences.roomIcons, snapshot.areas],
  );
  const groups = useMemo(() => navigation(home, roomIcons), [home, roomIcons]);
  const [route, setRouteState] = useState<HomeRoute>(() => globalThis.hausGpuiRoute ?? 'home');
  const setRoute = useCallback((next: HomeRoute) => {
    globalThis.hausGpuiRoute = next;
    setRouteState(next);
  }, []);
  const [camera, setCamera] = useState<string>();
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [previewScene, setPreviewScene] = useState<HassEntity | null>(null);
  const [editingConfig, setEditingConfig] = useState<WorkspaceEditingConfig | null>(null);
  const [addDevice, setAddDevice] = useState<GpuiAddDeviceRequest | null>(null);
  const [integrationsRefreshSignal, setIntegrationsRefreshSignal] = useState(0);
  const [fallbackMenu, setFallbackMenu] = useState<ActiveFallbackMenu | null>(null);
  const [search, setSearch] = useState(false);
  const [storyboardOpen, setStoryboardOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [serverSidebar, setServerSidebar] = useState<SidebarContextualNav>();
  const activeServerSidebar = route === 'servers' ? serverSidebar : undefined;
  const mainScrollRef = useRef<HausScrollHandle | null>(null);
  const alerts = useGpuiAlerts({
    transport: props.alertsTransport,
    states: snapshot.states,
    demo,
  });
  const { width, height } = useWindowSize();
  const inset = width <= 760 ? 19 : width <= 1180 ? 25 : 32;
  const columns = width <= 760 ? 2 : width <= 1180 ? 3 : 4;
  const dark = (preferences.theme === 'system' ? systemTheme : preferences.theme) === 'dark';
  const resolvedBrandIcons = useGpuiBrandIconPort(props.brandIcons, preferences, dark);
  const category = route.startsWith('category:')
    ? home.categories.find((item) => item.id === route.slice(9))
    : undefined;
  const room = route.startsWith('room:')
    ? home.navigationRooms.find((item) => item.id === route.slice(5))
    : undefined;
  const roomArea = snapshot.areas.find((area) => area.area_id === room?.id);
  const heading = room?.name ?? category?.name ?? WORKSPACE_ROUTE_LABELS[route] ?? 'Home';
  const showCategoryDock =
    (route === 'home' || Boolean(category) || route === 'servers') && !activeServerSidebar;

  const closeSearch = useCallback(() => {
    setSearch(false);
    setQuery('');
  }, []);
  const toggleSearch = useCallback(() => setSearch((value) => !value), []);
  const go = useCallback(
    (next: HomeRoute) => {
      setCamera(undefined);
      setSelectedDeviceId('');
      setFallbackMenu(null);
      closeSearch();
      if (next !== 'servers') setServerSidebar(undefined);
      setRoute(next);
      mainScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    },
    [closeSearch, setRoute],
  );

  useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [route, activeServerSidebar?.title, activeServerSidebar?.activeId]);

  const openCamera = useCallback(
    (id: string) => {
      setFallbackMenu(null);
      closeSearch();
      setSelectedDeviceId('');
      setCamera(id);
    },
    [closeSearch],
  );
  const routeRef = useRef(route);
  routeRef.current = route;
  const openDeviceByEntity = useCallback(
    (entityOrDeviceId: string) => {
      const target = home.devices.find(
        (item) =>
          item.id === entityOrDeviceId ||
          item.accessory.primaryEntityId === entityOrDeviceId ||
          item.accessory.entityIds.includes(entityOrDeviceId),
      );
      if (!target) return;
      setSearch(false);
      setFallbackMenu(null);
      if (NON_DEVICE_ROUTES.has(routeRef.current)) setRoute(`category:${target.category}`);
      setSelectedDeviceId(target.id);
    },
    [home.devices, setRoute],
  );

  const handleShortcut = (
    key: string,
    mod: boolean,
    shift = false,
    alt = false,
    preventDefault?: () => void,
  ) => {
    const lower = key.toLocaleLowerCase();
    if (isStoryboardToggleShortcut({ key, metaKey: mod, shiftKey: shift, altKey: alt })) {
      preventDefault?.();
      setStoryboardOpen((value) => !value);
      return;
    }
    if (mod && !shift && lower === 'k') return (preventDefault?.(), setSearch((value) => !value));
    if (mod && (key === ',' || lower === 'comma')) return (preventDefault?.(), go('settings'));
    if (lower !== 'escape') return;
    if (storyboardOpen) setStoryboardOpen(false);
    else if (fallbackMenu) setFallbackMenu(null);
    else if (search) closeSearch();
    else if (camera) setCamera(undefined);
  };
  useEffect(() => {
    if (!props.subscribeKeyDown) return;
    return props.subscribeKeyDown((event) => {
      handleShortcut(
        event.key ?? '',
        Boolean(event.modifiers?.cmd || event.modifiers?.ctrl),
        Boolean(event.modifiers?.shift),
        Boolean(event.modifiers?.alt),
        () => event.preventDefault(),
      );
    });
  });

  const allAccessories = useMemo(() => home.devices.map((item) => item.accessory), [home.devices]);
  const activeDevice = useMemo(
    () => resolveModalDevice(home.devices, selectedDeviceId, preferences),
    [home.devices, selectedDeviceId, preferences],
  );
  const closeDeviceModal = useCallback(() => setSelectedDeviceId(''), []);
  const openAddDevice = useCallback(
    (req?: GpuiAddDeviceRequest) => setAddDevice(req ?? { mode: 'picker' }),
    [],
  );
  const closeAddDevice = useCallback(() => setAddDevice(null), []);
  const onAddDeviceSaved = useCallback(() => {
    setIntegrationsRefreshSignal((n) => n + 1);
    onRefresh?.();
  }, [onRefresh]);

  const openExternal = platform?.openExternal;
  const sessionUrl = sessionMeta?.url;
  const boundOpenExternal = useMemo(
    () =>
      openExternal
        ? (url: string) =>
            sessionUrl
              ? openExternal(url, sessionUrl)
              : Promise.reject(new Error('Connect your home first.'))
        : undefined,
    [openExternal, sessionUrl],
  );
  const clipboard = platform?.clipboard;
  const copyText = useMemo(
    () =>
      clipboard
        ? (text: string) => void clipboard.writeText(text).catch(() => undefined)
        : undefined,
    [clipboard],
  );
  const dismissNoticeFn = alerts.dismissNotice;
  const dismissNotice = useCallback((id: string) => void dismissNoticeFn(id), [dismissNoticeFn]);

  const spotlightItems = useMemo(
    () =>
      search
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
        : [],
    [search, query, home, snapshot, preferences, go, openDeviceByEntity, openCamera, onControl],
  );

  return (
    <HausUiProvider
      contentHost={GPUIX_CONTENT_HOST}
      mode={dark ? 'dark' : 'light'}
      reducedTransparency={reducedTransparency}
      viewportWidth={width}
      viewportHeight={height}
      brandIcons={resolvedBrandIcons}
    >
      <Box
        onKeyDown={(event) =>
          handleShortcut(
            event.key,
            Boolean(event.metaKey || event.ctrlKey),
            Boolean(event.shiftKey),
            Boolean(event.altKey),
            () => event.preventDefault(),
          )
        }
        style={{ layout: { width: pct(100), height: pct(100) } }}
      >
        <WorkspaceShellView
          sidebar={props.sidebar}
          notice={props.notice}
          route={route}
          dark={dark}
          groups={groups}
          activeServerSidebar={activeServerSidebar}
          width={width}
          inset={inset}
          columns={columns}
          home={home}
          allAccessories={allAccessories}
          snapshot={snapshot}
          preferences={preferences}
          category={category}
          room={room}
          roomArea={roomArea}
          heading={heading}
          showCategoryDock={showCategoryDock}
          search={search}
          demo={demo}
          disabled={disabled}
          canFavorite={canFavorite}
          registry={registry}
          management={management}
          system={system}
          statistics={props.statistics}
          sessionMeta={sessionMeta}
          alertsNotices={alerts.notices}
          alertsError={alerts.error}
          integrationsRefreshSignal={integrationsRefreshSignal}
          platform={platform}
          mainScrollRef={mainScrollRef}
          fetchCameraSnapshot={props.fetchCameraSnapshot}
          boundOpenExternal={boundOpenExternal}
          copyText={copyText}
          onGo={go}
          onToggleSearch={toggleSearch}
          onAddDevice={openAddDevice}
          onSelectDevice={setSelectedDeviceId}
          onOpenCamera={openCamera}
          onOpenEntity={openDeviceByEntity}
          onPreviewScene={setPreviewScene}
          onEditConfig={setEditingConfig}
          onFallbackMenu={setFallbackMenu}
          onDismissNotice={dismissNotice}
          onServerSidebarChange={setServerSidebar}
          onControl={onControl}
          onFavorite={onFavorite}
          onTheme={props.onTheme}
          onGrouping={props.onGrouping}
          onPreferencesPatch={onPreferencesPatch}
          onResetLightGroups={props.onResetLightGroups}
          onToggleDemo={props.onToggleDemo}
          onConnect={props.onConnect}
          onDisconnect={props.onDisconnect}
          onManage={props.onManage}
          onApplySceneEntities={props.onApplySceneEntities}
          onRefresh={onRefresh}
        />
        <WorkspaceOverlays
          search={search}
          query={query}
          onQueryChange={setQuery}
          spotlightItems={spotlightItems}
          onCloseSearch={closeSearch}
          fallbackMenu={fallbackMenu}
          onCloseMenu={() => setFallbackMenu(null)}
          activePairing={alerts.activePairing}
          platform={platform}
          onDismissPairing={(sessionId) => void alerts.dismissPairing(sessionId)}
          deviceModal={
            activeDevice
              ? {
                  device: activeDevice,
                  snapshot,
                  preferences,
                  allAccessories,
                  demo,
                  disabled,
                  canFavorite,
                  statistics: props.statistics,
                  registry,
                  onClose: closeDeviceModal,
                  onSelectDevice: setSelectedDeviceId,
                  onControl,
                  onFavorite,
                  onPreferencesPatch,
                  onManage: props.onManage,
                }
              : undefined
          }
          cameraModal={
            camera
              ? {
                  cameraId: camera,
                  snapshot,
                  preferences,
                  allAccessories: home.allAccessories,
                  demo,
                  disabled,
                  streaming: props.streaming,
                  cameraApi: props.cameraApi,
                  fetchSnapshot: props.fetchCameraSnapshot,
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
                  onApplySceneEntities: props.onApplySceneEntities,
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
                  sessionKind: system?.sessionKind,
                  management,
                  requestRpc: system?.requestRpc,
                  openExternal: boundOpenExternal,
                  onCopyText: copyText,
                  initialRequest: addDevice,
                  onOpenApps: () => {
                    closeAddDevice();
                    go('addons');
                  },
                  onClose: closeAddDevice,
                  onSaved: onAddDeviceSaved,
                }
              : undefined
          }
          storyboardOpen={storyboardOpen}
          onCloseStoryboard={() => setStoryboardOpen(false)}
        />
      </Box>
    </HausUiProvider>
  );
}
