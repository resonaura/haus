/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, Heading, Text } from '@haus/ui';
import { Server } from 'lucide-react';
import { ServerCard } from './ServerCard';
import { namedServer, type ServerDevicePreferences, type ServerRoom } from './server-rooms';
import { useServers } from './useServers';
import { serversForView } from './server-catalog';

export function RoomServers({
  demo,
  areaId,
  rooms,
  serverDevices,
  onServerDeviceChange,
  onOpen,
}: {
  demo: boolean;
  areaId: string;
  rooms: ServerRoom[];
  serverDevices: ServerDevicePreferences;
  onServerDeviceChange?: (
    serverId: string,
    value: import('../../model/preferences').ServerDevicePreference,
  ) => void | Promise<void>;
  onOpen: (serverId: string) => void;
}) {
  const { status, fresh, now } = useServers(demo);
  const servers = serversForView(status?.servers ?? [], serverDevices, 'all').filter(
    (server) => serverDevices[server.id]?.areaId === areaId,
  );
  const room = rooms.find((item) => item.id === areaId)?.name;
  if (!servers.length) return null;
  return (
    <Box
      semantic="section"
      className="device-group room-servers-section"
      ariaLabel="Servers in this room"
    >
      <Box className="device-group-heading">
        <Text className="device-group-icon">
          <Server size={19} />
        </Text>
        <Heading level={2}>Servers</Heading>
        <Text className="device-group-count">
          {servers.length} {servers.length === 1 ? 'server' : 'servers'}
        </Text>
        <Text className="device-group-rule" />
      </Box>
      <Box className="accessory-grid server-card-grid">
        {servers.map((server) => (
          <ServerCard
            key={server.id}
            server={namedServer(server, serverDevices)}
            icon={serverDevices[server.id]?.icon}
            room={room}
            fresh={fresh}
            now={now}
            rooms={rooms}
            preference={serverDevices[server.id]}
            onSavePreference={
              onServerDeviceChange ? (value) => onServerDeviceChange(server.id, value) : undefined
            }
            onOpen={() => onOpen(server.id)}
          />
        ))}
      </Box>
    </Box>
  );
}
