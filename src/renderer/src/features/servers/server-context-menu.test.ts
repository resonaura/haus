import { expect, it } from 'vitest';
import { serverContextItems, serverContextPreference } from './server-context-menu';

const rooms = [
  { id: 'narnia', name: 'Narnia' },
  { id: 'unassigned', name: 'Unassigned' },
];
const preference = { name: 'Miku', areaId: 'narnia', icon: 'ubuntu', favorite: true };

it('preserves identity and other choices when moving, hiding or changing a favorite', () => {
  expect(serverContextPreference('move-room:unassigned', rooms, preference)).toEqual({
    ...preference,
    areaId: '',
  });
  expect(serverContextPreference('favorite', rooms, preference)).toEqual({
    ...preference,
    favorite: false,
  });
  expect(serverContextPreference('home-visibility', rooms, preference)).toEqual({
    ...preference,
    homeHidden: true,
  });
  expect(serverContextPreference('move-room:missing', rooms, preference)).toBeUndefined();
  expect(serverContextPreference('unexpected', rooms, preference)).toBeUndefined();
});

it('offers one Unassigned destination and prevents editing without a save handler', () => {
  const items = serverContextItems(rooms, preference, false);
  expect(items.find((item) => item.id === 'move-room')?.items).toEqual([
    { id: 'move-room:narnia', label: 'Narnia', enabled: false },
    { id: 'move-room:unassigned', label: 'Unassigned', enabled: true },
  ]);
  expect(items.filter((item) => item.enabled !== false).map((item) => item.id)).toEqual([
    'details',
  ]);
});
