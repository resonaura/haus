/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { memo, type ReactNode, type RefObject } from 'react';
import type { HomeNotice, ManagementPort } from '@haus/core/transport';
import type { Area, HassEntity, Snapshot } from '@haus/ha/types';
import { buildCameraMovePreferencePatch, type Preferences } from '@haus/core/preferences';
import type { HausAccessory } from '@haus/ha/view/types';
import { SCROLL_SHADOW_PRESETS, type HausScrollHandle } from '@haus/ui';
import { DesktopTopbar, type SidebarContextualNav } from '@haus/ui/components';
import { insets, pct, px } from '@haus/ui/ir';
import { ScrollView, Stack, Text } from '@haus/ui/primitives';
import type { GpuiAddDeviceRequest } from '../management/add-device.js';
import type { GpuiPlatform } from '../platform.js';
import { DesktopShell, type HomeRoute } from '../shell.js';
import { CameraPreviews, DeviceCards, SceneCards, type DeviceControl } from './cards.js';
import { WorkspaceCategoryRail, WorkspacePageHeader } from './header.js';
import type { StatisticsRequest } from './history.js';
import {
  openCameraContextMenu,
  openDeviceContextMenu,
  openSceneContextMenu,
  type ActiveFallbackMenu,
} from './menus.js';
import type { HomeDevice, homeDashboard } from './model.js';
import { navigation, settingsLink } from './navigation.js';
import { HomeRouteContent } from './routes.js';
import type { HomeWorkspaceProps, WorkspaceEditingConfig } from './workspace-props.js';

type HomeDashboard = ReturnType<typeof homeDashboard>;

export interface WorkspaceShellViewProps {
  readonly sidebar?: HomeWorkspaceProps['sidebar'];
  readonly notice?: ReactNode;
  readonly route: HomeRoute;
  readonly dark: boolean;
  readonly groups: ReturnType<typeof navigation>;
  readonly activeServerSidebar?: SidebarContextualNav;
  readonly width: number;
  readonly inset: number;
  readonly columns: number;
  readonly home: HomeDashboard;
  readonly allAccessories: readonly HausAccessory[];
  readonly snapshot: Snapshot;
  readonly preferences: Preferences;
  readonly category?: HomeDashboard['categories'][number];
  readonly room?: HomeDashboard['navigationRooms'][number];
  readonly roomArea?: Area;
  readonly heading: string;
  readonly showCategoryDock: boolean;
  readonly search: boolean;
  readonly demo?: boolean;
  readonly disabled: boolean;
  readonly canFavorite: boolean;
  readonly registry?: HomeWorkspaceProps['registry'];
  readonly management?: ManagementPort;
  readonly system?: HomeWorkspaceProps['system'];
  readonly statistics?: StatisticsRequest;
  readonly sessionMeta?: HomeWorkspaceProps['sessionMeta'];
  readonly alertsNotices: readonly HomeNotice[];
  readonly alertsError?: string;
  readonly integrationsRefreshSignal: number;
  readonly platform?: GpuiPlatform;
  readonly mainScrollRef: RefObject<HausScrollHandle | null>;
  readonly fetchCameraSnapshot?: (id: string) => Promise<string | null>;
  readonly boundOpenExternal?: (url: string) => Promise<void>;
  readonly copyText?: (text: string) => void;
  readonly onGo: (route: HomeRoute) => void;
  readonly onToggleSearch: () => void;
  readonly onAddDevice: (request?: GpuiAddDeviceRequest) => void;
  readonly onSelectDevice: (id: string) => void;
  readonly onOpenCamera: (id: string) => void;
  readonly onOpenEntity: (id: string) => void;
  readonly onPreviewScene: (scene: HassEntity) => void;
  readonly onEditConfig: (cfg: WorkspaceEditingConfig) => void;
  readonly onFallbackMenu: (menu: ActiveFallbackMenu | null) => void;
  readonly onDismissNotice: (id: string) => void;
  readonly onServerSidebarChange: (nav?: SidebarContextualNav) => void;
  readonly onControl: DeviceControl;
  readonly onFavorite: (id: string, favorite: boolean) => void;
  readonly onTheme: HomeWorkspaceProps['onTheme'];
  readonly onGrouping: HomeWorkspaceProps['onGrouping'];
  readonly onPreferencesPatch?: HomeWorkspaceProps['onPreferencesPatch'];
  readonly onResetLightGroups?: HomeWorkspaceProps['onResetLightGroups'];
  readonly onToggleDemo?: HomeWorkspaceProps['onToggleDemo'];
  readonly onConnect?: HomeWorkspaceProps['onConnect'];
  readonly onDisconnect?: HomeWorkspaceProps['onDisconnect'];
  readonly onManage?: HomeWorkspaceProps['onManage'];
  readonly onApplySceneEntities?: HomeWorkspaceProps['onApplySceneEntities'];
  readonly onRefresh?: HomeWorkspaceProps['onRefresh'];
}

/**
 * Memoized background dashboard shell isolated from modal-only states (`query`,
 * `selectedDeviceId`, `addDevice`, `camera`, `previewScene`, `editingConfig`,
 * `fallbackMenu`, `activePairing`) so opening, closing, or typing inside modals
 * never re-renders the background workspace tree.
 */
export const WorkspaceShellView = memo(function WorkspaceShellView(p: WorkspaceShellViewProps) {
  const renderDevices = (devices: readonly HomeDevice[]) =>
    devices.length ? (
      <DeviceCards
        cards={devices}
        columns={p.columns}
        snapshot={p.snapshot}
        preferences={p.preferences}
        allAccessories={p.allAccessories}
        demo={p.demo}
        disabled={p.disabled}
        canFavorite={p.canFavorite}
        externalModal
        statistics={p.statistics}
        registry={p.registry}
        onSelectId={p.onSelectDevice}
        onControl={p.onControl}
        onFavorite={p.onFavorite}
        onPreferencesPatch={p.onPreferencesPatch}
        onManage={p.onManage}
        onContextMenu={(device) =>
          openDeviceContextMenu({
            device,
            home: p.home,
            snapshot: p.snapshot,
            preferences: p.preferences,
            platform: p.platform,
            onFallback: p.onFallbackMenu,
            onCloseFallback: () => p.onFallbackMenu(null),
            onControl: p.onControl,
            onFavorite: p.onFavorite,
            onManage: p.onManage,
            onPreferencesPatch: p.onPreferencesPatch,
            onOpenDetails: p.onSelectDevice,
            registry: p.registry,
          })
        }
      />
    ) : (
      <Text tone="muted">No devices to show.</Text>
    );

  const renderScenes = (
    scenes: readonly HassEntity[],
    showAccessoryCount = true,
    horizontal = false,
  ) =>
    scenes.length ? (
      <SceneCards
        scenes={scenes}
        present={p.home.sceneCard}
        columns={p.columns}
        horizontal={horizontal}
        snapshot={p.snapshot}
        disabled={p.disabled}
        showAccessoryCount={showAccessoryCount}
        onControl={p.onControl}
        onContextMenu={(scene) =>
          openSceneContextMenu({
            scene,
            home: p.home,
            preferences: p.preferences,
            platform: p.platform,
            canEdit: Boolean(p.demo || p.snapshot.user.is_admin),
            onFallback: p.onFallbackMenu,
            onCloseFallback: () => p.onFallbackMenu(null),
            onControl: p.onControl,
            onPreviewScene: p.onPreviewScene,
            onEditScene: (target) => p.onEditConfig({ kind: 'scene', entity: target }),
            onOpenScenes: () => p.onGo('scenes'),
            onPreferencesPatch: p.onPreferencesPatch,
          })
        }
      />
    ) : (
      <Text tone="muted">No scenes to show.</Text>
    );

  const renderCameras = (cameras: HomeDashboard['cameras']) => {
    const visibleCameraIds = cameras.map((item) => item.id);
    const allCameraIds = p.home.allCameras.map((item) => item.id);
    return (
      <CameraPreviews
        cameras={cameras}
        columns={p.columns}
        demo={p.demo}
        fetchSnapshot={p.fetchCameraSnapshot}
        onOpen={p.onOpenCamera}
        onReorder={
          p.onPreferencesPatch
            ? (cameraId, direction) => {
                const patch = buildCameraMovePreferencePatch(
                  p.preferences,
                  allCameraIds,
                  visibleCameraIds,
                  cameraId,
                  direction,
                );
                if (patch) p.onPreferencesPatch?.(patch);
              }
            : undefined
        }
        onContextMenu={(cameraId) =>
          openCameraContextMenu({
            cameraId,
            visibleCameraIds,
            home: p.home,
            preferences: p.preferences,
            platform: p.platform,
            onFallback: p.onFallbackMenu,
            onCloseFallback: () => p.onFallbackMenu(null),
            onOpenCamera: p.onOpenCamera,
            onPreferencesPatch: p.onPreferencesPatch,
          })
        }
      />
    );
  };

  return (
    <DesktopShell
      sidebar={p.sidebar}
      route={p.route}
      onSelect={p.onGo}
      dark={p.dark}
      groups={p.groups}
      footer={settingsLink}
      contextual={p.activeServerSidebar}
      expandedWidth={p.width > 760 && p.width <= 1180 ? 215 : undefined}
    >
      <Stack gapPx={0} style={{ layout: { height: pct(100) } }}>
        <DesktopTopbar
          homeName={p.snapshot.config.location_name}
          heading={p.activeServerSidebar?.title ?? (p.route === 'home' ? 'Overview' : p.heading)}
          userName={p.snapshot.user.name}
          demo={p.demo}
          hasAttention={p.home.attention.length + p.alertsNotices.length > 0}
          inset={p.inset}
          showMenu={false}
          onSearch={p.onToggleSearch}
          onNotifications={() => p.onGo('attention')}
          onSettings={() => p.onGo('settings')}
        />
        <ScrollView
          id="main-scroll"
          scrollId="main-scroll"
          scrollRef={p.mainScrollRef}
          orientation="vertical"
          shadowSizePx={SCROLL_SHADOW_PRESETS.main}
          edges={p.showCategoryDock ? ['bottom'] : ['top', 'bottom']}
          style={{ layout: { flexGrow: 1, minHeight: px(0), direction: 'column' } }}
        >
          <Stack
            gapPx={0}
            style={{
              layout: {
                width: pct(100),
                maxWidth: px(1420),
                padding: insets(p.width <= 760 ? 22 : 27, p.inset, 22, p.inset),
              },
            }}
          >
            {!p.activeServerSidebar && (
              <WorkspacePageHeader
                category={p.category}
                room={p.room}
                roomArea={p.roomArea}
                route={p.route}
                search={p.search}
                heading={p.heading}
                demo={p.demo}
                isAdmin={Boolean(p.snapshot.user.is_admin)}
                disabled={p.disabled}
                registry={p.registry}
                onGo={p.onGo}
                onAddDevice={p.onAddDevice}
                onConnect={p.onConnect}
                onRefresh={p.onRefresh}
              />
            )}
            {p.notice}
            {p.showCategoryDock && (
              <WorkspaceCategoryRail
                categories={p.home.categories}
                route={p.route}
                activeCategory={p.category}
                bleedX={p.inset}
                liquidGlass={p.preferences.liquidGlass}
                onGo={p.onGo}
              />
            )}
            <HomeRouteContent
              route={p.route}
              home={p.home}
              snapshot={p.snapshot}
              preferences={p.preferences}
              category={p.category}
              room={p.room}
              columns={p.columns}
              demo={p.demo}
              disabled={p.disabled}
              canFavorite={p.canFavorite}
              registry={p.registry}
              management={p.management}
              system={p.system}
              statistics={p.statistics}
              sessionMeta={p.sessionMeta}
              alertsNotices={p.alertsNotices}
              alertsError={p.alertsError}
              fetchCameraSnapshot={p.fetchCameraSnapshot}
              onDismissNotice={p.onDismissNotice}
              onOpenEntity={p.onOpenEntity}
              onOpenCamera={p.onOpenCamera}
              onGo={p.onGo}
              onControl={p.onControl}
              onApplySceneEntities={p.onApplySceneEntities}
              onSaved={p.onRefresh}
              integrationsRefreshSignal={p.integrationsRefreshSignal}
              onAddDevice={p.onAddDevice}
              onTheme={p.onTheme}
              onGrouping={p.onGrouping}
              onPreferencesPatch={p.onPreferencesPatch}
              onResetLightGroups={p.onResetLightGroups}
              onToggleDemo={p.onToggleDemo}
              onConnect={p.onConnect}
              onDisconnect={p.onDisconnect}
              openExternal={p.boundOpenExternal}
              openPaths={p.platform?.openPaths}
              onCopyText={p.copyText}
              onServerSidebarChange={p.onServerSidebarChange}
              renderDevices={renderDevices}
              renderScenes={renderScenes}
              renderCameras={renderCameras}
            />
          </Stack>
        </ScrollView>
      </Stack>
    </DesktopShell>
  );
});
