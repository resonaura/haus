/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import { mergeRoomIcons, type ManagementPort } from '@haus/core/transport';
import type { Area, HassEntity, Snapshot } from '@haus/ha/types';
import type { RegistryController } from '@haus/ha/ui/registry';
import type { Preferences } from '@haus/ha/view/preferences';
import {
  AttentionBanner,
  AttentionFeed,
  CategoryFilter,
  CategoryRail,
  DEVICE_ICONS,
  HomeSections,
  RoomSection,
  UiIcon,
  type PortableAttentionItem,
  type PortableHomeNotice,
} from '@haus/ui/components';
import { insets } from '@haus/ui/ir';
import { HausButton, Heading, Row, Stack, Text } from '@haus/ui/primitives';
import type { GpuiAddDeviceRequest } from '../management/add-device.js';
import { GpuiAppsView } from '../management/apps.js';
import { GpuiAutomationsView } from '../management/automations.js';
import { GpuiDevicesInventoryView } from '../management/devices.js';
import { GpuiHiddenView } from '../management/hidden.js';
import { GpuiIntegrationsView } from '../management/integrations.js';
import { GpuiRoomDetailView } from '../management/room-detail.js';
import { GpuiRoomsView } from '../management/rooms.js';
import { GpuiScenesView } from '../management/scenes.js';
import { GpuiServersView } from '../management/servers.js';
import type { GpuiSystemPorts } from '../management/servers-port.js';
import type { HomeRoute } from '../shell.js';
import type { DeviceControl } from './cards.js';
import { roomIcon } from './navigation.js';
import { Statistics, type StatisticsRequest } from './history.js';
import { RoomEditAction } from './rooms.js';
import { SettingsView, type HomeSessionStatusInfo } from './settings-view.js';
import { homeDashboard, type HomeDevice } from './model.js';

type HomeDashboard = ReturnType<typeof homeDashboard>;

export function WorkspacePageHeader({
  category,
  room,
  roomArea,
  route,
  search,
  heading,
  demo,
  isAdmin,
  disabled,
  registry,
  onGo,
  onAddDevice,
  onConnect,
  onRefresh,
}: {
  readonly category?: HomeDashboard['categories'][number];
  readonly room?: HomeDashboard['navigationRooms'][number];
  readonly roomArea?: Area;
  readonly route: HomeRoute;
  readonly search: boolean;
  readonly heading: string;
  readonly demo?: boolean;
  readonly isAdmin: boolean;
  readonly disabled: boolean;
  readonly registry?: Pick<RegistryController, 'saveRoom'>;
  readonly onGo: (route: HomeRoute) => void;
  readonly onAddDevice?: (request?: GpuiAddDeviceRequest) => void;
  readonly onConnect?: () => void;
  readonly onRefresh?: () => void;
}) {
  return (
    <Row justify="between" gapPx={10} style={{ layout: { margin: insets(0, 0, 22, 0) } }}>
      <Stack gapPx={0}>
        <Text
          tone="muted"
          size={8}
          weight={600}
          style={{
            typography: { letterSpacing: 0.25, lineHeight: 1.5 },
            layout: { margin: insets(0, 0, 7, 0) },
          }}
        >
          {category || route === 'home'
            ? 'HAUS OVERVIEW'
            : room
              ? 'ROOM OVERVIEW'
              : 'THOUGHTFULLY CONNECTED'}
        </Text>
        <Heading
          id="desktop-page-title"
          level={1}
          size={28}
          weight={600}
          style={{ typography: { lineHeight: 1.08 } }}
        >
          {search ? 'Search' : heading}
        </Heading>
        {route === 'home' && !search && (
          <Text tone="muted" size={12} style={{ typography: { lineHeight: 1.5 } }}>
            Your home. A little closer.
          </Text>
        )}
      </Stack>
      <Row gapPx={8} align="center" wrap>
        {roomArea && (
          <RoomEditAction
            key={room?.id ?? 'new'}
            room={roomArea}
            registry={isAdmin ? registry : undefined}
            disabled={disabled}
            onSaved={(area) => onGo(`room:${area.area_id}`)}
          />
        )}
        {route === 'home' && (demo || isAdmin) && onAddDevice && (
          <HausButton
            id="home-add-device"
            variant="secondary"
            disabled={disabled}
            onPress={() => onAddDevice({ mode: 'picker' })}
          >
            <Row gapPx={6}>
              <UiIcon name="plus" size={15} />
              <Text size={12.5}>Add device</Text>
            </Row>
          </HausButton>
        )}
        {onConnect && (
          <HausButton id="connect-home" variant="outline" onPress={onConnect}>
            <Row gapPx={8}>
              <UiIcon name="plus" size={17} />
              <Text size={13}>Connect your home</Text>
            </Row>
          </HausButton>
        )}
        {onRefresh && (
          <HausButton
            id="hub-reconnect"
            variant="outline"
            disabled={disabled}
            onPress={onRefresh}
          >
            Refresh home
          </HausButton>
        )}
      </Row>
    </Row>
  );
}

export function HomeRouteContent({
  route,
  home,
  snapshot,
  preferences,
  category,
  room,
  columns = 3,
  demo,
  disabled,
  canFavorite,
  registry,
  management,
  system,
  statistics,
  sessionMeta,
  alertsNotices = [],
  alertsError,
  fetchCameraSnapshot,
  onDismissNotice,
  onReviewNotice,
  onOpenEntity,
  onOpenCamera,
  onGo,
  onControl,
  onApplySceneEntities,
  onSaved,
  onAddDevice,
  onTheme,
  onGrouping,
  onPreferencesPatch,
  onResetLightGroups,
  onToggleDemo,
  onConnect,
  onDisconnect,
  renderDevices,
  renderScenes,
  renderCameras,
}: {
  route: HomeRoute;
  home: HomeDashboard;
  snapshot: Snapshot;
  preferences: Preferences;
  category?: HomeDashboard['categories'][number];
  room?: HomeDashboard['navigationRooms'][number];
  columns?: number;
  demo?: boolean;
  disabled: boolean;
  canFavorite: boolean;
  registry?: Pick<
    RegistryController,
    'saveRoom' | 'deleteRoom' | 'moveDevices' | 'updateDevice' | 'updateEntity'
  >;
  management?: ManagementPort;
  system?: GpuiSystemPorts;
  statistics?: StatisticsRequest;
  sessionMeta?: HomeSessionStatusInfo;
  alertsNotices?: readonly PortableHomeNotice[];
  alertsError?: string;
  fetchCameraSnapshot?: (id: string) => Promise<string | null>;
  onDismissNotice?: (notificationId: string) => void;
  onReviewNotice?: (notice: PortableHomeNotice) => void;
  onOpenEntity?: (entityId: string) => void;
  onOpenCamera?: (id: string) => void;
  onGo: (route: HomeRoute) => void;
  onControl: DeviceControl;
  onApplySceneEntities?: (entities: Record<string, unknown>) => Promise<void>;
  onSaved?: () => void;
  onAddDevice?: (request?: GpuiAddDeviceRequest) => void;
  onTheme: (theme: Preferences['theme']) => void;
  onGrouping: (enabled: boolean) => void;
  onPreferencesPatch?: (patch: Partial<Preferences>) => void;
  onResetLightGroups?: () => void;
  onToggleDemo?: (enabled: boolean) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  renderDevices: (devices: readonly HomeDevice[]) => ReactNode;
  renderScenes: (scenes: readonly HassEntity[], showAccessoryCount?: boolean) => ReactNode;
  renderCameras: (cameras: typeof home.cameras) => ReactNode;
}): ReactNode {
  const roomIcons = mergeRoomIcons(snapshot.areas, preferences.roomIcons);
  if (category) return renderDevices(category.devices);
  if (room) {
    return (
      <GpuiRoomDetailView
        key={room.id}
        roomId={room.id}
        snapshot={snapshot}
        home={home}
        renderDevices={renderDevices}
        renderCameras={renderCameras}
        renderScenes={renderScenes}
        onGo={onGo}
      />
    );
  }
  switch (route) {
    case 'cameras':
      return home.allCameras.length > 0 ? (
        <Stack gapPx={12}>
          {renderCameras(home.allCameras)}
        </Stack>
      ) : (
        <Text tone="muted">No cameras in this home.</Text>
      );
    case 'scenes':
      return (
        <GpuiScenesView
          snapshot={snapshot}
          scenes={home.sceneGroups.flatMap((g) => g.items)}
          home={home}
          demo={demo}
          management={management}
          renderScenes={renderScenes}
          onApplyScene={(sceneId) => onControl(sceneId, 'run')}
          onApplySceneEntities={onApplySceneEntities}
          onSaved={onSaved}
        />
      );
    case 'favorites':
      return renderDevices(home.favorites);
    case 'rooms':
      return (
        <GpuiRoomsView
          snapshot={snapshot}
          preferences={preferences}
          columns={columns}
          registry={registry}
          onPreferencesPatch={onPreferencesPatch}
          onOpenRoom={(id) => onGo(`room:${id}`)}
          onOpenDevices={() => onGo('devices')}
        />
      );
    case 'devices':
      return (
        <GpuiDevicesInventoryView
          snapshot={snapshot}
          home={home}
          registry={registry}
          onOpenEntity={onOpenEntity}
          onSaved={onSaved}
        />
      );
    case 'integrations':
      return (
        <GpuiIntegrationsView
          snapshot={snapshot}
          home={home}
          columns={columns}
          demo={demo}
          requestRpc={system?.requestRpc}
          onOpenEntity={onOpenEntity}
          onAddDevice={onAddDevice}
          onSaved={onSaved}
        />
      );
    case 'addons':
      return (
        <GpuiAppsView
          snapshot={snapshot}
          columns={columns}
          demo={demo}
          sessionKind={system?.sessionKind}
          management={management}
          requestRpc={system?.requestRpc}
          onSaved={onSaved}
        />
      );
    case 'servers':
      return (
        <GpuiServersView
          snapshot={snapshot}
          columns={columns}
          demo={demo}
          system={system}
          onSaved={onSaved}
        />
      );
    case 'hidden':
      return (
        <GpuiHiddenView
          snapshot={snapshot}
          preferences={preferences}
          home={home}
          demo={demo}
          fetchCameraSnapshot={fetchCameraSnapshot}
          renderDevices={renderDevices}
          renderScenes={renderScenes}
          onOpenCamera={(id) => onOpenCamera?.(id)}
          onPreferencesPatch={onPreferencesPatch}
        />
      );
    case 'automations':
      return (
        <GpuiAutomationsView
          snapshot={snapshot}
          automations={home.automations}
          demo={demo}
          disabled={disabled}
          management={management}
          onControl={onControl}
          onApplySceneEntities={onApplySceneEntities}
          onSaved={onSaved}
        />
      );
    case 'settings':
      return (
        <SettingsView
          demo={Boolean(demo)}
          homeName={snapshot.config.location_name}
          versionText={
            typeof snapshot.config.version === 'string' ? snapshot.config.version : undefined
          }
          preferences={preferences}
          disabled={disabled}
          canEditPreferences={canFavorite}
          sessionMeta={sessionMeta}
          onToggleDemo={onToggleDemo}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onTheme={onTheme}
          onGrouping={onGrouping}
          onPreferencesPatch={onPreferencesPatch}
          onResetLightGroups={onResetLightGroups}
          onNavigate={(destination) => {
            if (destination === 'rooms' || destination === 'devices') onGo(destination);
          }}
        />
      );
    case 'statistics':
      return <Statistics request={statistics} />;
    case 'attention': {
      const attentionItems: readonly PortableAttentionItem[] = home.attention;
      return (
        <AttentionFeed
          notices={alertsNotices}
          attention={attentionItems}
          error={alertsError}
          onDismissNotice={onDismissNotice}
          onReviewNotice={onReviewNotice}
          onOpenEntity={onOpenEntity}
        />
      );
    }
    default:
      return (
        <HomeSections
          cameraCount={home.cameras.length}
          onCameras={() => onGo('cameras')}
          cameras={
            home.cameras.length ? (
              renderCameras(home.cameras)
            ) : (
              <Text tone="muted">No cameras on Home</Text>
            )
          }
          scenes={home.homeScenes.length ? renderScenes(home.homeScenes, false) : undefined}
          onScenes={() => onGo('scenes')}
          quick={
            home.quick.cards.length
              ? {
                  title: home.quick.usingFavorites ? 'Quick controls' : 'At your fingertips',
                  subtitle: home.quick.usingFavorites
                    ? 'Pinned for one-tap access.'
                    : demo
                      ? 'Ranked by the changes you make here.'
                      : 'The controls you reach for most.',
                  action: 'Favorites',
                  onAction: () => onGo('favorites'),
                  content: renderDevices(home.quick.cards),
                }
              : undefined
          }
          attention={
            alertsNotices.length + home.homeAttention.length > 0 && (
              <AttentionBanner
                titles={[
                  ...alertsNotices.map((item) => item.title),
                  ...home.homeAttention.map((item) => item.title),
                ].slice(0, 2)}
                count={alertsNotices.length + home.homeAttention.length}
                onOpen={() => onGo('attention')}
                portable
              />
            )
          }
          rooms={home.rooms.map((item) => (
            <RoomSection
              key={item.id}
              name={item.name}
              icon={<UiIcon name={roomIcon(item.name, roomIcons[item.id])} size={18} />}
              caption={`${item.devices.length} devices`}
              onOpen={() => onGo(`room:${item.id}`)}
            >
              {renderDevices(item.devices)}
            </RoomSection>
          ))}
          portable
        />
      );
  }
}

export function WorkspaceCategoryRail({
  categories,
  activeCategory,
  onSelectHome,
  onSelectCategory,
}: {
  readonly categories: HomeDashboard['categories'];
  readonly activeCategory?: HomeDashboard['categories'][number];
  readonly onSelectHome: () => void;
  readonly onSelectCategory: (id: string) => void;
}) {
  return (
    <CategoryRail>
      <CategoryFilter
        name="All"
        summary="Your home"
        icon={<UiIcon name="house" size={19} />}
        selected={!activeCategory}
        onSelect={onSelectHome}
        portable
      />
      {categories.map((item) => (
        <CategoryFilter
          key={item.id}
          id={item.id}
          name={item.name}
          summary={item.summary}
          selected={item.id === activeCategory?.id}
          icon={<UiIcon name={DEVICE_ICONS[item.id]} size={19} />}
          onSelect={() =>
            item.id === activeCategory?.id ? onSelectHome() : onSelectCategory(item.id)
          }
          portable
        />
      ))}
    </CategoryRail>
  );
}
