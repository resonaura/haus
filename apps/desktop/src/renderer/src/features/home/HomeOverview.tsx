/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ReactNode, RefObject } from 'react';
import { Text } from '@haus/ui';
import { House, LayoutGrid, Radio } from 'lucide-react';
import type { HausAccessory, HassEntity, HausModel, HausRoom } from '../../model';
import type { Preferences } from '../../model/preferences';
import type { Route } from '../../app/navigation';
import {
  AttentionBanner,
  HomeSections,
  RoomSection,
  EmptyState as Empty,
} from '@haus/ui/components';
import { VirtualSections } from '@haus/ui/web';
import { RoomIconPicker } from '../rooms/RoomIconPicker';
import { isEntityActive } from '../../model/device-appearance';
import { groupNumberedLights } from '../../model/room-devices';
import { ServerCard } from '../servers/ServerCard';
import { useServers } from '../servers/useServers';
import { homeRoomSections } from './home-room-sections';
import type {
  ServerDevicePreference,
  ServerDevicePreferences,
  ServerRoom,
} from '../servers/server-rooms';
type Props = {
  mode: 'live' | 'demo';
  preferences: Preferences;
  homeCameras: HassEntity[];
  sortedHomeScenes: HassEntity[];
  homeQuickControls: HausAccessory[];
  hasHomeFavorites: boolean;
  homeAttention: HausModel['attention'];
  homeRooms: HausRoom[];
  scrollRef: RefObject<HTMLDivElement | null>;
  go: (route: Route) => void;
  renderGrid: (
    items: HausAccessory[],
    hidden?: boolean,
    className?: string,
    scope?: string,
    children?: ReactNode,
  ) => ReactNode;
  renderCameras: (items: HassEntity[], horizontal?: boolean) => ReactNode;
  renderScenes: (items: HassEntity[]) => ReactNode;
  homeCamerasForRoom: (areaId: string) => HassEntity[];
  setRoomIcon: (areaId: string, icon: string) => void;
  serverRooms: ServerRoom[];
  serverDevices: ServerDevicePreferences;
  onOpenServer: (id: string) => void;
  onServerDeviceChange: (id: string, value: ServerDevicePreference) => void | Promise<void>;
};
const isActive = (item: HausAccessory) => isEntityActive(item.state);
export function HomeOverview({
  mode,
  preferences,
  homeCameras,
  sortedHomeScenes,
  homeQuickControls,
  hasHomeFavorites,
  homeAttention,
  homeRooms,
  scrollRef,
  go,
  renderGrid,
  renderCameras,
  renderScenes,
  homeCamerasForRoom,
  setRoomIcon,
  serverRooms,
  serverDevices,
  onOpenServer,
  onServerDeviceChange,
}: Props) {
  const { status, fresh, now } = useServers(mode === 'demo');
  const sections = homeRoomSections(homeRooms, status?.servers ?? [], serverRooms, serverDevices);
  return (
    <HomeSections
      cameraCount={homeCameras.length}
      onCameras={() => go({ kind: 'cameras' })}
      onScenes={() => go({ kind: 'scenes' })}
      cameras={
        homeCameras.length ? (
          renderCameras(homeCameras, true)
        ) : (
          <Empty
            icon={<Radio />}
            title="No cameras on Home"
            description="Cameras you add to Home view will appear here."
          />
        )
      }
      scenes={sortedHomeScenes.length > 0 ? renderScenes(sortedHomeScenes) : undefined}
      quick={
        homeQuickControls.length
          ? {
              title: hasHomeFavorites ? 'Quick controls' : 'At your fingertips',
              subtitle: hasHomeFavorites
                ? 'Pinned for one-tap access.'
                : mode === 'demo'
                  ? 'Ranked by the changes you make here.'
                  : 'The controls you reach for most.',
              action: hasHomeFavorites ? 'Favorites' : 'Statistics',
              onAction: () => go(hasHomeFavorites ? { kind: 'favorites' } : { kind: 'statistics' }),
              content: renderGrid(
                homeQuickControls,
                false,
                'accessory-grid home-device-grid',
                'home:quick',
              ),
            }
          : undefined
      }
      attention={
        homeAttention.length > 0 && (
          <AttentionBanner
            titles={homeAttention.slice(0, 2).map((item) => item.title)}
            count={homeAttention.length}
            onOpen={() => go({ kind: 'attention' })}
          />
        )
      }
      rooms={
        sections.length ? (
          <VirtualSections
            items={sections}
            getKey={(item) => item.id}
            scrollRef={scrollRef}
            estimateHeight={(item, columns) =>
              100 +
              Math.ceil(
                (groupNumberedLights(
                  item.accessories.filter((a) => !a.primaryEntityId.startsWith('camera.')),
                  preferences.autoGroupLights !== false,
                  preferences.disabledLightGroups,
                ).length +
                  item.servers.length) /
                  columns,
              ) *
                137
            }
            renderSection={(item) => {
              const roomDevices = item.accessories.filter(
                (accessory) => !accessory.primaryEntityId.startsWith('camera.'),
              );
              const roomCameraCount = homeCamerasForRoom(item.id).length;
              const activeCount = roomDevices.filter(isActive).length;
              return (
                <RoomSection
                  key={item.id}
                  portable={false}
                  name={item.name}
                  caption={`${roomDevices.length + item.servers.length} devices${roomCameraCount > 0 ? ` · ${roomCameraCount} ${roomCameraCount === 1 ? 'camera' : 'cameras'}` : ''}${activeCount > 0 ? ` · ${activeCount} active` : ''}`}
                  onOpen={item.id ? () => go({ kind: 'room', id: item.id }) : undefined}
                  icon={
                    item.id ? (
                      <RoomIconPicker
                        name={item.name}
                        value={preferences.roomIcons?.[item.id]}
                        onChange={(icon) => setRoomIcon(item.id, icon)}
                      />
                    ) : (
                      <Text className="device-group-icon">
                        <LayoutGrid size={16} />
                      </Text>
                    )
                  }
                >
                  {(roomDevices.length > 0 || item.servers.length > 0) &&
                    renderGrid(
                      roomDevices,
                      false,
                      'accessory-grid',
                      `home:room:${item.id}`,
                      item.servers.map((server) => (
                        <ServerCard
                          key={server.id}
                          server={server}
                          room={item.name}
                          fresh={fresh}
                          now={now}
                          icon={serverDevices[server.id]?.icon}
                          rooms={serverRooms}
                          preference={serverDevices[server.id]}
                          onSavePreference={(value) => onServerDeviceChange(server.id, value)}
                          onOpen={() => onOpenServer(server.id)}
                        />
                      )),
                    )}
                </RoomSection>
              );
            }}
          />
        ) : (
          <Empty
            icon={<House />}
            title="No rooms yet"
            description="Rooms in your home will appear here."
          />
        )
      }
    />
  );
}
