import { describe, expect, it } from 'vitest';
import type { HausRoom } from '../../model';
import type { HomeServer } from '../servers/types';
import type { ServerDevicePreferences } from '../servers/server-rooms';
import { homeRoomSections } from './home-room-sections';

const servers: HomeServer[] = [
  { id: 'miku', kind: 'nvr', name: 'Home media server', online: true, host: null },
  { id: 'black-laptop', kind: 'nvr', name: 'Windows media server', online: false, host: null },
  { id: 'ha', kind: 'home-assistant', name: 'Home Assistant', online: true, host: null },
];
const rooms = [
  { id: 'office', name: 'Office' },
  { id: 'narnia', name: 'Narnia' },
];
const preferences: ServerDevicePreferences = {
  miku: { name: 'Miku', areaId: 'narnia' },
  'black-laptop': { name: 'Black Laptop', areaId: 'narnia' },
  ha: { areaId: 'narnia' },
};

describe('Home rooms with server devices', () => {
  it('joins servers to the existing Narnia section without replacing its ordinary devices', () => {
    const homeRooms: HausRoom[] = [
      {
        id: 'narnia',
        name: 'Narnia',
        accessories: [{ id: 'light.narnia' }] as HausRoom['accessories'],
      },
    ];
    const sections = homeRoomSections(homeRooms, servers, rooms, preferences);
    expect(sections).toHaveLength(1);
    expect(sections[0].accessories).toEqual(homeRooms[0].accessories);
    expect(sections[0].servers.map((server) => server.name)).toEqual([
      'Miku',
      'Black Laptop',
      'Home Assistant',
    ]);
    expect(homeRooms[0]).not.toHaveProperty('servers');
    expect(servers[0].name).toBe('Home media server');
  });

  it('updates shared visibility and room moves, including server-only and unassigned rooms', () => {
    const homeRooms = [{ id: 'narnia', name: 'Narnia', accessories: [] }];
    const sections = homeRoomSections(homeRooms, servers, rooms, {
      ...preferences,
      miku: { ...preferences.miku, areaId: 'office' },
      'black-laptop': { ...preferences['black-laptop'], homeHidden: true },
      ha: { ...preferences.ha, appHidden: true },
    });
    expect(sections.map((section) => section.id)).toEqual(['office', 'narnia']);
    expect(sections[0].servers.map((server) => server.id)).toEqual(['miku']);
    expect(sections[1].servers).toEqual([]);
    const unassigned = homeRoomSections([], servers, rooms, {
      miku: { areaId: 'deleted-room' },
      'black-laptop': { appHidden: true },
      ha: { homeHidden: true },
    });
    expect(unassigned).toMatchObject([
      { id: '', name: 'Unassigned', accessories: [], servers: [{ id: 'miku' }] },
    ]);
    expect(homeRoomSections([], [], rooms, preferences)).toEqual([]);
  });
});
