/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { sanitizeHomeLightMemories, type HomeLightMemories } from '../optimistic/light-memory.js';
import { sanitizeServerIcon } from '../transport/servers.js';
import {
  DEFAULT_ICON_STYLE,
  isIconAppearance,
  isIconTintColor,
  isIconVariation,
  type IconAppearance,
  type IconTintColor,
  type IconVariation,
} from './icon-style.js';

export type ManualUsage = Record<string, { count: number; lastUsed: number }>;

export type ServerDevicePreference = {
  name?: string;
  areaId?: string;
  icon?: string;
  favorite?: boolean;
  homeHidden?: boolean;
  appHidden?: boolean;
};

export type LiquidGlassRecipeId =
  | 'dock'
  | 'toolbar'
  | 'sidebar'
  | 'hud'
  | 'menu'
  | 'dockTooltip'
  | 'altTab'
  | 'appIcons'
  | 'notification';

export type LiquidGlassPreference = {
  enabled: boolean;
  recipe: LiquidGlassRecipeId;
  sliderMode: number;
  refractionStrength: number;
  edgeWidth: number;
  dispersion: number;
  saturation: number;
  specularDial: number;
  edgeHighlight: number;
  darkenedEdge: number;
  ior: number;
  nativeRim: boolean;
};

export const DEFAULT_LIQUID_GLASS_PREFERENCE: LiquidGlassPreference = {
  enabled: true,
  recipe: 'dock',
  sliderMode: 0.5,
  refractionStrength: 0.85,
  edgeWidth: 13.28,
  dispersion: 0.025,
  saturation: 1.25,
  specularDial: 0.65,
  edgeHighlight: 0.35,
  darkenedEdge: 0.0,
  ior: 1.5,
  nativeRim: true,
};

const VALID_GLASS_RECIPES = new Set<LiquidGlassRecipeId>([
  'dock',
  'toolbar',
  'sidebar',
  'hud',
  'menu',
  'dockTooltip',
  'altTab',
  'appIcons',
  'notification',
]);

function clampPrefNum(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(min, Math.min(max, num)) : fallback;
}

export function sanitizeLiquidGlassPreference(value: unknown): LiquidGlassPreference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_LIQUID_GLASS_PREFERENCE;
  }
  const raw = value as Record<string, unknown>;
  const recipe =
    typeof raw.recipe === 'string' && VALID_GLASS_RECIPES.has(raw.recipe as LiquidGlassRecipeId)
      ? (raw.recipe as LiquidGlassRecipeId)
      : DEFAULT_LIQUID_GLASS_PREFERENCE.recipe;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    recipe,
    sliderMode: clampPrefNum(raw.sliderMode, 0, 1, DEFAULT_LIQUID_GLASS_PREFERENCE.sliderMode),
    refractionStrength: clampPrefNum(
      raw.refractionStrength,
      0,
      1,
      DEFAULT_LIQUID_GLASS_PREFERENCE.refractionStrength,
    ),
    edgeWidth: clampPrefNum(raw.edgeWidth, 4, 28, DEFAULT_LIQUID_GLASS_PREFERENCE.edgeWidth),
    dispersion: clampPrefNum(raw.dispersion, 0, 0.35, DEFAULT_LIQUID_GLASS_PREFERENCE.dispersion),
    saturation: clampPrefNum(raw.saturation, 0.5, 2.2, DEFAULT_LIQUID_GLASS_PREFERENCE.saturation),
    specularDial: clampPrefNum(
      raw.specularDial,
      0,
      1,
      DEFAULT_LIQUID_GLASS_PREFERENCE.specularDial,
    ),
    edgeHighlight: clampPrefNum(
      raw.edgeHighlight,
      0,
      1,
      DEFAULT_LIQUID_GLASS_PREFERENCE.edgeHighlight,
    ),
    darkenedEdge: clampPrefNum(
      raw.darkenedEdge,
      0,
      0.15,
      DEFAULT_LIQUID_GLASS_PREFERENCE.darkenedEdge,
    ),
    ior: clampPrefNum(raw.ior, 1.1, 2.0, DEFAULT_LIQUID_GLASS_PREFERENCE.ior),
    nativeRim: typeof raw.nativeRim === 'boolean' ? raw.nativeRim : true,
  };
}

export type Preferences = {
  favorites: string[];
  hiddenApp: string[];
  hiddenHome: string[];
  unhiddenApp?: string[];
  theme: 'system' | 'light' | 'dark';
  iconAppearance?: IconAppearance;
  iconVariation?: IconVariation;
  iconTintColor?: IconTintColor;
  liquidGlass?: LiquidGlassPreference;
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
  iconAppearance: DEFAULT_ICON_STYLE.appearance,
  iconVariation: DEFAULT_ICON_STYLE.variation,
  iconTintColor: DEFAULT_ICON_STYLE.tintColor,
  liquidGlass: DEFAULT_LIQUID_GLASS_PREFERENCE,
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
          Object.entries(input.serverDevices).flatMap(([id, rawEntry]) => {
            if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return [];
            const entry = rawEntry as Record<string, unknown>;
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
                  ...(entry.appHidden === true ? { appHidden: true } : {}),
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
    iconAppearance: isIconAppearance(input.iconAppearance)
      ? input.iconAppearance
      : DEFAULT_ICON_STYLE.appearance,
    iconVariation: isIconVariation(input.iconVariation)
      ? input.iconVariation
      : DEFAULT_ICON_STYLE.variation,
    iconTintColor: isIconTintColor(input.iconTintColor)
      ? input.iconTintColor
      : DEFAULT_ICON_STYLE.tintColor,
    liquidGlass: sanitizeLiquidGlassPreference(input.liquidGlass),
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
