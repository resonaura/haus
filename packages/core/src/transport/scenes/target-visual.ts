/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  lightColor,
  lightProfile,
  lightTemperature,
} from '../../optimistic/index.js';
import {
  describeSceneTargetState,
  inferSceneTargetDomain,
  missingSceneTargetColor,
} from './editor-model.js';
import {
  sceneTargetEntity,
  targetColorKey,
  targetConfig,
  type SceneEntityLike,
} from './targets.js';

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export interface SceneTargetVisualDetails {
  readonly domain: string;
  readonly active: boolean;
  readonly stateText: string;
  readonly accentCss?: string;
  readonly swatchCss?: string;
  readonly stateValue: string;
  readonly stateChoices: readonly string[];
  readonly hasBrightness: boolean;
  readonly brightnessPct: number;
  readonly hasTemperature: boolean;
  readonly kelvin: number;
  readonly minKelvin: number;
  readonly maxKelvin: number;
  readonly hasColor: boolean;
  readonly temperature: number;
  readonly minTemp: number;
  readonly maxTemp: number;
  readonly tempStep: number;
  readonly hasLevel: boolean;
  readonly levelLabel: string;
  readonly levelPct: number;
}

/** Computes unified DeviceTile preview and target inspector controls for scene and automation targets. */
export function resolveSceneTargetVisual(
  id: string,
  entity: SceneEntityLike | undefined,
  setting: unknown,
): SceneTargetVisualDetails {
  const config = targetConfig(setting);
  const domain = entity ? (id.split('.')[0] ?? 'other') : inferSceneTargetDomain(id, config);
  const attrs = entity?.attributes ?? {};
  const preview = entity ? sceneTargetEntity(entity, config) : undefined;
  const profile = preview && domain === 'light' ? lightProfile(preview) : undefined;
  const stateValue = String(config.state ?? entity?.state ?? 'on');
  const active =
    domain === 'cover'
      ? stateValue !== 'closed'
      : domain === 'lock'
        ? stateValue === 'unlocked'
        : stateValue !== 'off' && stateValue !== 'unavailable' && stateValue !== 'unknown';

  const colorCss =
    domain === 'light' && active
      ? preview
        ? lightColor(preview)
        : missingSceneTargetColor(id, config)
      : undefined;

  const hvacModes = Array.isArray(attrs.hvac_modes)
    ? attrs.hvac_modes.filter((mode): mode is string => typeof mode === 'string')
    : [];
  const baseChoices: string[] =
    domain === 'climate'
      ? hvacModes.length > 0
        ? hvacModes
        : ['off', 'heat', 'cool', 'auto']
      : domain === 'cover'
        ? ['open', 'closed']
        : domain === 'lock'
          ? ['locked', 'unlocked']
          : domain === 'media_player'
            ? ['off', 'on', 'playing', 'paused']
            : ['on', 'off'];
  const stateChoices = [...new Set([...baseChoices, stateValue])].filter(Boolean);

  const minKelvin = Math.round(
    finite(attrs.min_color_temp_kelvin) ??
      (finite(attrs.max_mireds) ? 1e6 / Number(attrs.max_mireds) : 2000),
  );
  const maxKelvin = Math.round(
    finite(attrs.max_color_temp_kelvin) ??
      (finite(attrs.min_mireds) ? 1e6 / Number(attrs.min_mireds) : 6500),
  );
  const kelvin = Math.round(
    clamp(
      (preview && lightTemperature(preview)) ?? finite(config.color_temp_kelvin) ?? 3000,
      minKelvin,
      maxKelvin,
    ),
  );
  const rawBrightness = finite(preview?.attributes.brightness ?? config.brightness);
  const brightnessPct = Math.max(1, Math.min(100, Math.round((rawBrightness ?? 255) / 2.55)));
  const hasAdvertisedModes =
    Array.isArray(attrs.supported_color_modes) && attrs.supported_color_modes.length > 0;
  const hasBrightness =
    domain === 'light' &&
    (profile ? profile.brightness : !hasAdvertisedModes || rawBrightness !== undefined);
  const hasTemperature =
    domain === 'light' && (profile ? profile.temperature : finite(config.color_temp_kelvin) != null);
  const hasColor = domain === 'light' && (profile ? profile.color : targetColorKey(config) != null);

  const minTemp = finite(attrs.min_temp) ?? 7;
  const maxTemp = finite(attrs.max_temp) ?? 35;
  const tempStep = finite(attrs.target_temp_step) ?? 0.5;
  const temperature = clamp(
    finite(config.temperature) ?? finite(attrs.temperature) ?? 21,
    minTemp,
    maxTemp,
  );

  const hasLevel = domain === 'cover' || domain === 'fan' || domain === 'media_player';
  const levelLabel = domain === 'cover' ? 'Open position' : domain === 'fan' ? 'Speed' : 'Volume';
  const levelPct =
    domain === 'cover'
      ? Math.round(finite(config.current_position) ?? (stateValue === 'closed' ? 0 : 100))
      : domain === 'fan'
        ? Math.round(finite(config.percentage) ?? finite(attrs.percentage) ?? 100)
        : Math.round((finite(config.volume_level) ?? finite(attrs.volume_level) ?? 0.3) * 100);

  return {
    domain,
    active,
    stateText: describeSceneTargetState(id, entity, config),
    accentCss: colorCss,
    swatchCss: active ? colorCss : undefined,
    stateValue,
    stateChoices,
    hasBrightness,
    brightnessPct,
    hasTemperature,
    kelvin,
    minKelvin,
    maxKelvin,
    hasColor,
    temperature,
    minTemp,
    maxTemp,
    tempStep,
    hasLevel,
    levelLabel,
    levelPct,
  };
}
