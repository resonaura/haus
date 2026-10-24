import { describe, expect, it } from 'vitest';
import { serverSearchItems, serversForView } from './server-catalog';
import type { ServerDevicePreferences } from './server-rooms';
import type { HomeServer, ServerHost } from './types';

const servers: HomeServer[] = [
  {
    id: 'miku',
    kind: 'nvr',
    name: 'Home media server',
    online: true,
    host: {
      platform: 'linux',
      distribution: 'ubuntu',
      osName: 'Ubuntu 24.04 LTS',
      hostname: 'home-server',
    } as ServerHost,
  },
  {
    id: 'laptop',
    kind: 'nvr',
    name: 'Windows media server',
    online: false,
    host: {
      platform: 'linux',
      release: 'microsoft-standard-WSL2',
      distribution: 'ubuntu',
    } as ServerHost,
  },
  {
    id: 'home-assistant',
    kind: 'home-assistant',
    name: 'Home Assistant',
    online: true,
    host: null,
  },
];
const rooms = [{ id: 'narnia', name: 'Narnia' }];
const preferences: ServerDevicePreferences = {
  miku: { name: 'Miku', areaId: 'narnia', homeHidden: true, favorite: true, icon: 'windows' },
  laptop: { name: 'Black Laptop', areaId: 'narnia', favorite: true, appHidden: true },
  'home-assistant': { areaId: 'removed' },
};

describe('server view and search visibility', () => {
  it('keeps Home View hiding separate from app hiding, room access, and favorites', () => {
    expect(serversForView(servers, preferences, 'all').map((server) => server.id)).toEqual([
      'miku',
      'home-assistant',
    ]);
    expect(serversForView(servers, preferences, 'home').map((server) => server.id)).toEqual([
      'home-assistant',
    ]);
    expect(serversForView(servers, preferences, 'favorites').map((server) => server.id)).toEqual([
      'miku',
    ]);
    expect(serversForView(servers, preferences, 'hidden').map((server) => server.id)).toEqual([
      'laptop',
    ]);
  });
  it('restoring a hidden server retains its room, identity, and favorite', () => {
    const restored = { ...preferences, laptop: { ...preferences.laptop, appHidden: false } };
    const result = serverSearchItems(servers, rooms, restored, 'black narnia windows');
    expect(result.map((item) => [item.server.name, item.room, item.system, item.favorite])).toEqual(
      [['Black Laptop', 'Narnia', 'Windows', true]],
    );
    expect(restored.laptop).toEqual({
      name: 'Black Laptop',
      areaId: 'narnia',
      favorite: true,
      appHidden: false,
    });
    expect(preferences.laptop.appHidden).toBe(true);
  });
  it('matches individual server names, rooms, reported OS and original aliases without exposing hidden nodes', () => {
    for (const query of ['Miku', 'narnia ubuntu', '24.04 miku', 'home media server', 'home-server'])
      expect(
        serverSearchItems(servers, rooms, preferences, query).map((item) => item.server.id),
      ).toEqual(['miku']);
    expect(serverSearchItems(servers, rooms, preferences, 'black')).toEqual([]);
    expect(serverSearchItems(servers, rooms, preferences, 'windows')).toEqual([]);
    expect(serverSearchItems(servers, rooms, preferences, 'not-present')).toEqual([]);
    // A chosen artwork never changes the actual operating system or its search identity.
    expect(serverSearchItems(servers, rooms, preferences, 'miku')[0].system).toBe('Ubuntu');
  });
  it('keeps unavailable nodes searchable and does not invent a missing room or mutate original data', () => {
    const visible = { ...preferences, laptop: { ...preferences.laptop, appHidden: false } };
    const result = serverSearchItems(servers, rooms, visible, '');
    expect(result).toHaveLength(3);
    expect(result.find((item) => item.server.id === 'laptop')?.server.online).toBe(false);
    expect(result.find((item) => item.server.id === 'home-assistant')?.room).toBe('Unassigned');
    expect(servers[0].name).toBe('Home media server');
  });
});
