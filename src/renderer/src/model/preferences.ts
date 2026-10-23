import { sanitizeHomeLightMemories, type HomeLightMemories } from './light-memory';
import { sanitizeServerIcon } from './server-icon';
export type ManualUsage = Record<string, { count: number; lastUsed: number }>;
export type ServerDevicePreference = {
  name?: string;
  areaId?: string;
  icon?: string;
  favorite?: boolean;
  homeHidden?: boolean;
};
export type Preferences = {
  favorites: string[];
  hiddenApp: string[];
  hiddenHome: string[];
  unhiddenApp?: string[];
  theme: 'system' | 'light' | 'dark';
  manualUsage: ManualUsage;
  deviceOrder?: Record<string, string[]>;
  autoGroupLights?: boolean;
  disabledLightGroups?: string[];
  roomIcons?: Record<string, string>;
  serverDevices?: Record<string, ServerDevicePreference>;
  lightMemories?: HomeLightMemories;
  hausDashboard?: { urlPath: string; lastGenerated: Record<string, unknown> };
};
export const defaults: Preferences = {
  favorites: [],
  hiddenApp: [],
  hiddenHome: [],
  unhiddenApp: [],
  theme: 'system',
  manualUsage: {},
  deviceOrder: {},
  autoGroupLights: true,
  disabledLightGroups: [],
  serverDevices: {},
};
const legacyStarterFavorites = [
  'light.living_room_pendant',
  'climate.home',
  'light.kitchen_pendants',
  'media_player.living_room',
];
export const sanitizePreferences = (value: unknown): Preferences => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const input = value as Record<string, unknown>;
  const manualUsage =
    input.manualUsage && typeof input.manualUsage === 'object' && !Array.isArray(input.manualUsage)
      ? Object.fromEntries(
          Object.entries(input.manualUsage).flatMap(([entityId, entry]) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
            const usage = entry as Record<string, unknown>;
            const count = Number(usage.count);
            const lastUsed = Number(usage.lastUsed);
            return Number.isFinite(count) && count > 0 && Number.isFinite(lastUsed)
              ? [[entityId, { count: Math.floor(count), lastUsed }]]
              : [];
          }),
        )
      : {};
  const deviceOrder =
    input.deviceOrder && typeof input.deviceOrder === 'object' && !Array.isArray(input.deviceOrder)
      ? Object.fromEntries(
          Object.entries(input.deviceOrder).flatMap(([key, list]) => {
            if (!Array.isArray(list)) return [];
            return [[key, list.filter((id): id is string => typeof id === 'string')]];
          }),
        )
      : {};
  const roomIcons =
    input.roomIcons && typeof input.roomIcons === 'object' && !Array.isArray(input.roomIcons)
      ? Object.fromEntries(
          Object.entries(input.roomIcons).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : {};
  const storedFavorites = Array.isArray(input.favorites)
    ? input.favorites.filter((id): id is string => typeof id === 'string')
    : defaults.favorites;
  const serverDevices =
    input.serverDevices &&
    typeof input.serverDevices === 'object' &&
    !Array.isArray(input.serverDevices)
      ? Object.fromEntries(
          Object.entries(input.serverDevices).flatMap(([id, value]) => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
            const entry = value as Record<string, unknown>;
            const icon = sanitizeServerIcon(entry.icon);
            return [
              [
                id,
                {
                  ...(typeof entry.name === 'string' && entry.name.trim()
                    ? { name: entry.name.trim().slice(0, 120) }
                    : {}),
                  ...(typeof entry.areaId === 'string'
                    ? { areaId: entry.areaId.slice(0, 128) }
                    : {}),
                  ...(icon ? { icon } : {}),
                  ...(entry.favorite === true ? { favorite: true } : {}),
                  ...(entry.homeHidden === true ? { homeHidden: true } : {}),
                },
              ],
            ];
          }),
        )
      : {};
  // These were automatically seeded by Haus; they were never explicit user choices.
  const favorites =
    storedFavorites.length === legacyStarterFavorites.length &&
    storedFavorites.every((id, index) => id === legacyStarterFavorites[index])
      ? []
      : storedFavorites;
  return {
    favorites,
    hiddenApp: Array.isArray(input.hiddenApp)
      ? input.hiddenApp.filter((id): id is string => typeof id === 'string')
      : Array.isArray(input.hidden)
        ? input.hidden.filter((id): id is string => typeof id === 'string')
        : [],
    hiddenHome: Array.isArray(input.hiddenHome)
      ? input.hiddenHome.filter((id): id is string => typeof id === 'string')
      : [],
    unhiddenApp: Array.isArray(input.unhiddenApp)
      ? input.unhiddenApp.filter((id): id is string => typeof id === 'string')
      : [],
    theme: input.theme === 'dark' || input.theme === 'light' ? input.theme : 'system',
    manualUsage,
    deviceOrder,
    roomIcons,
    serverDevices,
    autoGroupLights: input.autoGroupLights !== false,
    disabledLightGroups: Array.isArray(input.disabledLightGroups)
      ? input.disabledLightGroups.filter((key): key is string => typeof key === 'string')
      : [],
    lightMemories: sanitizeHomeLightMemories(input.lightMemories),
    ...(input.hausDashboard &&
    typeof input.hausDashboard === 'object' &&
    !Array.isArray(input.hausDashboard)
      ? { hausDashboard: input.hausDashboard as Preferences['hausDashboard'] }
      : {}),
  };
};
