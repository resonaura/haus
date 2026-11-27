/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, Heading, Text } from '@haus/ui';
import { PresenceGrid } from '@haus/ui/web';
import { Server } from 'lucide-react';
import { useServers } from './useServers';
import { groupServersByRoom, type ServerDevicePreferences, type ServerRoom } from './server-rooms';
import { ServerCard } from './ServerCard';
import type { ServerDevicePreference } from '../../model/preferences';
import { serversForView } from './server-catalog';

export function ServerCollection({
  demo,
  rooms,
  preferences,
  mode,
  onOpen,
  onSave,
}: {
  demo: boolean;
  rooms: ServerRoom[];
  preferences: ServerDevicePreferences;
  mode: 'home' | 'favorites' | 'hidden';
  onOpen: (id: string) => void;
  onSave: (id: string, value: ServerDevicePreference) => void | Promise<void>;
}) {
  const { status, fresh, now, error } = useServers(demo);
  if (!status)
    return mode === 'hidden' && !demo ? (
      <Text semantic="p" className="page-tip" role={error ? 'alert' : 'status'}>
        <Server size={16} />
        {error || 'Loading hidden servers…'}
      </Text>
    ) : null;
  const visible = serversForView(status.servers, preferences, mode);
  if (!visible.length) return null;
  const groups = groupServersByRoom(visible, rooms, preferences);
  return (
    <Box className={`device-groups server-collections server-collections--${mode}`}>
      {groups.map((group) => (
        <Box semantic="section" className="device-group" key={group.id}>
          <Box className="device-group-heading">
            <Text className="device-group-icon" ariaHidden>
              <Server size={19} />
            </Text>
            <Heading level={2}>{group.name}</Heading>
            <Text className="device-group-count">
              {group.servers.length} {group.servers.length === 1 ? 'server' : 'servers'}
            </Text>
            <Text className="device-group-rule" />
          </Box>
          <PresenceGrid className="accessory-grid server-card-grid">
            {group.servers.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                room={group.name}
                fresh={fresh}
                now={now}
                icon={preferences[server.id]?.icon}
                rooms={rooms}
                preference={preferences[server.id]}
                hidden={mode === 'hidden'}
                onSavePreference={(value) => onSave(server.id, value)}
                onOpen={() => onOpen(server.id)}
              />
            ))}
          </PresenceGrid>
        </Box>
      ))}
    </Box>
  );
}
