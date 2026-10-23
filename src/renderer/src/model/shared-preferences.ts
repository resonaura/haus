import type { Preferences } from './preferences';
export const sharedPreferenceKeys = [
  'favorites',
  'hiddenApp',
  'hiddenHome',
  'unhiddenApp',
  'deviceOrder',
  'autoGroupLights',
  'disabledLightGroups',
  'roomIcons',
  'serverDevices',
] as const;
export function sharedPreferences(preferences: Preferences) {
  return Object.fromEntries(
    sharedPreferenceKeys.map((key) => [
      key,
      preferences[key] ??
        (key === 'autoGroupLights'
          ? true
          : ['deviceOrder', 'roomIcons', 'serverDevices'].includes(key)
            ? {}
            : []),
    ]),
  );
}
export function changedPreferences(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  return Object.fromEntries(
    sharedPreferenceKeys
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .map((key) => [key, after[key]]),
  );
}
