/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { HausRoom } from '../../model';
import type { HomeServer } from '../servers/types';
import {
  groupServersByRoom,
  type ServerDevicePreferences,
  type ServerRoom,
} from '../servers/server-rooms';
import { serversForView } from '../servers/server-catalog';

export function homeRoomSections(
  homeRooms: HausRoom[],
  servers: HomeServer[],
  rooms: ServerRoom[],
  preferences: ServerDevicePreferences,
) {
  const sections = new Map(
    homeRooms.map((room) => [room.id, { ...room, servers: [] as HomeServer[] }]),
  );
  for (const group of groupServersByRoom(
    serversForView(servers, preferences, 'home'),
    rooms,
    preferences,
  )) {
    const section = sections.get(group.id);
    if (section) section.servers = group.servers;
    else sections.set(group.id, { ...group, accessories: [] });
  }
  // Preserve the ordinary room order, including rooms containing only servers.
  const orderedIds = new Set([...rooms.map((room) => room.id), ...sections.keys()]);
  return [...orderedIds].flatMap((id) => {
    const section = sections.get(id);
    return section ? [section] : [];
  });
}
