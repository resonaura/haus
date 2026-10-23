import { resolveServerIcon, serverIconOptions } from '../../model/server-icon';
import { namedServer, type ServerDevicePreferences, type ServerRoom } from './server-rooms';
import type { HomeServer } from './types';

export type ServerView = 'all' | 'home' | 'favorites' | 'hidden';

/** App visibility takes precedence; Home View visibility only affects the overview. */
export function serversForView(
  servers: HomeServer[],
  preferences: ServerDevicePreferences,
  view: ServerView,
) {
  return servers.filter((server) => {
    const preference = preferences[server.id];
    if (view === 'hidden') return preference?.appHidden === true;
    if (preference?.appHidden) return false;
    if (view === 'home') return !preference?.homeHidden;
    if (view === 'favorites') return preference?.favorite === true;
    return true;
  });
}

export function serverSearchItems(
  servers: HomeServer[],
  rooms: ServerRoom[],
  preferences: ServerDevicePreferences,
  query: string,
) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return serversForView(servers, preferences, 'all').flatMap((original) => {
    const server = namedServer(original, preferences);
    const room =
      rooms.find((item) => item.id === preferences[server.id]?.areaId)?.name ?? 'Unassigned';
    const system =
      serverIconOptions.find((item) => item.id === resolveServerIcon(server))?.label ?? 'Server';
    const searchable = [
      server.name,
      original.name,
      room,
      system,
      server.host?.platform,
      server.host?.distribution,
      server.host?.osName,
      server.host?.hostname,
      'server',
    ]
      .join(' ')
      .toLocaleLowerCase();
    return words.every((word) => searchable.includes(word))
      ? [{ server, room, system, favorite: preferences[server.id]?.favorite === true }]
      : [];
  });
}
