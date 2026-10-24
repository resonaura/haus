import { describe, expect, it } from 'vitest';
import { serverContextItems, serverContextPreference } from './server-context-menu';
import { serversForView, serverSearchItems } from './server-catalog';
import { groupServersByRoom, namedServer } from './server-rooms';
import type { HomeServer, ServerHost } from './types';
import type { ServerDevicePreference, ServerDevicePreferences } from './server-rooms';

const testServers: HomeServer[] = [
  {
    id: 'miku',
    kind: 'nvr',
    name: 'Home media server',
    online: true,
    host: {
      platform: 'linux',
      distribution: 'ubuntu',
      osName: 'Ubuntu 24.04 LTS',
      hostname: 'miku-node',
      battery: { level: 85, charging: true },
      cpu: { usage: 12 },
      memory: { usedBytes: 4 * 1024 * 1024 * 1024, totalBytes: 16 * 1024 * 1024 * 1024 },
    } as ServerHost,
  },
  {
    id: 'black-laptop',
    kind: 'nvr',
    name: 'Windows media server',
    online: false,
    host: {
      platform: 'linux',
      release: 'microsoft-standard-WSL2',
      distribution: 'ubuntu',
      osName: 'Ubuntu 24.04 LTS',
      hostname: 'windows-node',
      cpu: { usage: 5 },
      memory: { usedBytes: 2 * 1024 * 1024 * 1024, totalBytes: 8 * 1024 * 1024 * 1024 },
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

const rooms = [
  { id: 'narnia', name: 'Narnia' },
  { id: 'office', name: 'Office' },
];

describe('server device feature parity and cross-view interactions', () => {
  it('shares context menu actions with ordinary accessories: details, room moves, favorites, home and app visibility', () => {
    const preference = { name: 'Miku', areaId: 'narnia', favorite: false, homeHidden: false };
    const items = serverContextItems(rooms, preference, true);

    expect(items.map((item) => item.id)).toEqual([
      'details',
      'move-room',
      'favorite',
      'home-visibility',
      'app-visibility',
    ]);

    const moveSubmenu = items.find((item) => item.id === 'move-room');
    expect(moveSubmenu?.type).toBe('submenu');
    expect(moveSubmenu?.items).toEqual([
      { id: 'move-room:narnia', label: 'Narnia', enabled: false },
      { id: 'move-room:office', label: 'Office', enabled: true },
      { id: 'move-room:unassigned', label: 'Unassigned', enabled: true },
    ]);
  });

  it('cycles through room moves, favorite toggle, and visibility changes cleanly', () => {
    let pref: ServerDevicePreference = {
      name: 'Miku',
      areaId: 'narnia',
      favorite: false,
      icon: 'miku-chibi',
    };

    // Move to Office
    pref = serverContextPreference('move-room:office', rooms, pref)!;
    expect(pref.areaId).toBe('office');
    expect(pref.name).toBe('Miku');
    expect(pref.icon).toBe('miku-chibi');

    // Add to Favorites
    pref = serverContextPreference('favorite', rooms, pref)!;
    expect(pref.favorite).toBe(true);

    // Hide from Home View
    pref = serverContextPreference('home-visibility', rooms, pref)!;
    expect(pref.homeHidden).toBe(true);

    // Hide from Haus
    pref = serverContextPreference('app-visibility', rooms, pref)!;
    expect(pref.appHidden).toBe(true);

    // Restore to Haus retains all properties
    pref = serverContextPreference('app-visibility', rooms, pref)!;
    expect(pref.appHidden).toBe(false);
    expect(pref.areaId).toBe('office');
    expect(pref.favorite).toBe(true);
    expect(pref.homeHidden).toBe(true);
    expect(pref.icon).toBe('miku-chibi');

    // Move to Unassigned
    pref = serverContextPreference('move-room:unassigned', rooms, pref)!;
    expect(pref.areaId).toBe('');
  });

  it('consistently routes server presence across Servers, Home, Favorites, and Hidden views', () => {
    const preferences: ServerDevicePreferences = {
      miku: { name: 'Miku', areaId: 'narnia', favorite: true, homeHidden: false },
      'black-laptop': { name: 'Black Laptop', areaId: 'narnia', favorite: true, homeHidden: true },
      'home-assistant': { areaId: 'office', appHidden: true },
    };

    // 1. Servers page ('all') shows non-appHidden servers
    const serversPageView = serversForView(testServers, preferences, 'all');
    expect(serversPageView.map((s) => s.id)).toEqual(['miku', 'black-laptop']);

    // 2. Home overview ('home') shows non-appHidden AND non-homeHidden servers
    const homeView = serversForView(testServers, preferences, 'home');
    expect(homeView.map((s) => s.id)).toEqual(['miku']);

    // 3. Favorites view ('favorites') shows non-appHidden favorite servers
    const favoritesView = serversForView(testServers, preferences, 'favorites');
    expect(favoritesView.map((s) => s.id)).toEqual(['miku', 'black-laptop']);

    // 4. Hidden view ('hidden') shows only appHidden servers
    const hiddenView = serversForView(testServers, preferences, 'hidden');
    expect(hiddenView.map((s) => s.id)).toEqual(['home-assistant']);

    // 5. Room grouping respects assigned rooms
    const groups = groupServersByRoom(serversPageView, rooms, preferences);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Narnia');
    expect(groups[0].servers.map((s) => s.name)).toEqual(['Miku', 'Black Laptop']);
  });

  it('preserves search discoverability when visible and hides servers from search when app-hidden', () => {
    const preferences: ServerDevicePreferences = {
      miku: { name: 'Miku', areaId: 'narnia', favorite: true },
      'black-laptop': { name: 'Black Laptop', areaId: 'narnia', appHidden: true },
    };

    // Active server found by alias, distribution, hostname, room
    expect(serverSearchItems(testServers, rooms, preferences, 'miku')).toHaveLength(1);
    expect(serverSearchItems(testServers, rooms, preferences, 'ubuntu')).toHaveLength(1);
    expect(serverSearchItems(testServers, rooms, preferences, 'miku-node')).toHaveLength(1);

    // App-hidden server is excluded from search
    expect(serverSearchItems(testServers, rooms, preferences, 'black laptop')).toHaveLength(0);
    expect(serverSearchItems(testServers, rooms, preferences, 'windows')).toHaveLength(0);

    // Restoring makes it searchable again
    const restoredPrefs = {
      ...preferences,
      'black-laptop': { ...preferences['black-laptop'], appHidden: false },
    };
    expect(serverSearchItems(testServers, rooms, restoredPrefs, 'black laptop')).toHaveLength(1);
  });

  it('honors namedServer aliases without mutating raw server payload', () => {
    const original = testServers[0];
    const customized = namedServer(original, { miku: { name: 'Custom Name' } });
    expect(customized.name).toBe('Custom Name');
    expect(original.name).toBe('Home media server');

    const unmodified = namedServer(original, {});
    expect(unmodified.name).toBe('Home media server');
  });
});
