import { expect, it } from 'vitest';
import { defaults, sanitizePreferences } from './preferences';
import { changedPreferences, sharedPreferences } from './shared-preferences';
it('follows system appearance by default and keeps deliberate light/dark choices', () => {
  expect(defaults.theme).toBe('system');
  expect(sanitizePreferences({}).theme).toBe('system');
  expect(sanitizePreferences({ theme: 'invalid' }).theme).toBe('system');
  expect(sanitizePreferences({ theme: 'light' }).theme).toBe('light');
  expect(sanitizePreferences({ theme: 'dark' }).theme).toBe('dark');
});

it('preserves server identity and room assignments in shared home settings', () => {
  const next = sanitizePreferences({
    serverDevices: {
      main: { name: ' Miku ', areaId: 'narnia', password: 'discard' },
      laptop: { name: 'Black Laptop', areaId: '' },
      invalid: null,
    },
  });
  expect(next.serverDevices).toEqual({
    main: { name: 'Miku', areaId: 'narnia' },
    laptop: { name: 'Black Laptop', areaId: '' },
  });
  expect(changedPreferences(sharedPreferences(defaults), sharedPreferences(next))).toEqual({
    serverDevices: next.serverDevices,
  });
  expect(sanitizePreferences({ serverDevices: [] }).serverDevices).toEqual({});
});

it('keeps distinct server app and Home View visibility alongside identity preferences', () => {
  const next = sanitizePreferences({
    serverDevices: {
      main: { name: 'Miku', areaId: 'narnia', favorite: true, homeHidden: true, appHidden: true },
      laptop: { name: 'Black Laptop', favorite: false, homeHidden: false, appHidden: false },
      invalid: { appHidden: 'true', homeHidden: 1 },
    },
  });
  expect(next.serverDevices).toEqual({
    main: { name: 'Miku', areaId: 'narnia', favorite: true, homeHidden: true, appHidden: true },
    laptop: { name: 'Black Laptop' },
    invalid: {},
  });
  expect(sharedPreferences(next).serverDevices).toEqual(next.serverDevices);
});

it('synchronizes server icon overrides and resets to automatic without losing identity', () => {
  const selected = sanitizePreferences({
    serverDevices: { main: { name: 'Miku', areaId: 'narnia', icon: 'linux' } },
  });
  expect(selected.serverDevices?.main).toEqual({ name: 'Miku', areaId: 'narnia', icon: 'linux' });
  const reset = sanitizePreferences({
    ...selected,
    serverDevices: { main: { name: 'Miku', areaId: 'narnia' } },
  });
  expect(changedPreferences(sharedPreferences(selected), sharedPreferences(reset))).toEqual({
    serverDevices: { main: { name: 'Miku', areaId: 'narnia' } },
  });
  for (const icon of ['auto', 'not-an-icon', 'https://example.com/icon.svg', {}, null]) {
    expect(sanitizePreferences({ serverDevices: { main: { icon } } }).serverDevices?.main).toEqual(
      {},
    );
  }
});
