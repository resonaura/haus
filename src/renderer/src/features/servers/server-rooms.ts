import type { HomeServer } from './types';
import type { ServerDevicePreference } from '../../model/preferences';
export type { ServerDevicePreference } from '../../model/preferences';

export interface ServerRoom {
  id: string;
  name: string;
}
export type ServerDevicePreferences = Record<string, ServerDevicePreference>;

export function namedServer(server: HomeServer, preferences: ServerDevicePreferences = {}) {
  const name = preferences[server.id]?.name?.trim();
  return name ? { ...server, name } : server;
}

export function groupServersByRoom(
  servers: HomeServer[],
  rooms: ServerRoom[] = [],
  preferences: ServerDevicePreferences = {},
) {
  const groups = new Map<string, { id: string; name: string; servers: HomeServer[] }>();
  for (const server of servers) {
    const room = rooms.find((item) => item.id === preferences[server.id]?.areaId);
    const id = room?.id ?? '';
    if (!groups.has(id)) groups.set(id, { id, name: room?.name ?? 'Unassigned', servers: [] });
    groups.get(id)!.servers.push(namedServer(server, preferences));
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.id) return 1;
    if (!b.id) return -1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  });
}
