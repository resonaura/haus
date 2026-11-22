/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Category, HassEntity, HausAccessory } from '../../model';
import { lightColor } from '../../model/light-color';
import { lightEffects, lightProfile, lightStateDescription } from '../../model/light-profile';
import { describeAccessory, titleCase } from '../../model/presentation';
import {
  patchSceneTarget,
  SCENE_COLOR_KEYS,
  SCENE_COLOR_MODES,
  sceneTargetEntity,
  targetColorKey,
  targetConfig,
  type SceneTarget,
} from '../../model/scene-target';

const KNOWN_DOMAINS = new Set([
  'light',
  'switch',
  'climate',
  'cover',
  'media_player',
  'fan',
  'lock',
  'input_boolean',
  'water_heater',
]);

const DOMAIN_TO_CATEGORY: Readonly<Record<string, Category>> = {
  light: 'lights',
  switch: 'outlets',
  input_boolean: 'outlets',
  climate: 'climate',
  fan: 'climate',
  cover: 'covers',
  lock: 'security',
  media_player: 'media',
  water_heater: 'water',
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

function parseRgbString(css: string | undefined): [number, number, number] | undefined {
  if (!css) return undefined;
  const match = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(css.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function extractEmbeddedEntityId(id: string): string | undefined {
  const cleaned = id.startsWith('ep_') ? id.slice(3) : id;
  if (cleaned.includes('.') && KNOWN_DOMAINS.has(cleaned.split('.')[0])) return cleaned;
  const parts = id.split(':');
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (!part) continue;
    const candidate = part.startsWith('ep_') ? part.slice(3) : part;
    if (candidate.includes('.') && KNOWN_DOMAINS.has(candidate.split('.')[0])) return candidate;
  }
  return undefined;
}

export function inferSceneTargetDomain(id: string, setting: unknown): string {
  const embedded = extractEmbeddedEntityId(id);
  if (embedded) return embedded.split('.')[0];
  const value = targetConfig(setting);
  if (
    value.brightness != null ||
    SCENE_COLOR_KEYS.some((key) => value[key] != null) ||
    typeof value.effect === 'string'
  ) {
    return 'light';
  }
  if (value.temperature != null || typeof value.hvac_mode === 'string') return 'climate';
  if (value.current_position != null || value.state === 'open' || value.state === 'closed') {
    return 'cover';
  }
  if (value.state === 'locked' || value.state === 'unlocked') return 'lock';
  if (value.percentage != null) return 'fan';
  if (value.volume_level != null || value.state === 'playing' || value.state === 'paused') {
    return 'media_player';
  }
  if (value.state === 'on' || value.state === 'off') return 'switch';
  return 'other';
}

export function missingSceneTargetName(id: string): string {
  const embedded = extractEmbeddedEntityId(id);
  const rawSlug = embedded
    ? embedded.slice(embedded.indexOf('.') + 1)
    : (id.split(':').filter(Boolean).at(-1) ?? id);
  const cleaned = rawSlug
    .replace(/^ep_/, '')
    .replace(/[._-]+/g, ' ')
    .trim();
  return cleaned ? titleCase(cleaned) : id;
}

export function missingSceneTargetAccessory(id: string, setting: unknown): HausAccessory {
  const domain = inferSceneTargetDomain(id, setting);
  const category: Category = DOMAIN_TO_CATEGORY[domain] ?? 'other';
  const name = missingSceneTargetName(id);
  const entityId = `${domain === 'other' ? 'switch' : domain}.unavailable`;
  return {
    id: `missing:${id}`,
    primaryEntityId: entityId,
    entityIds: [entityId],
    category,
    name,
    availability: 'unavailable',
    capabilities: [],
    state: {
      entity_id: entityId,
      state: 'unavailable',
      attributes: { friendly_name: name },
      last_changed: '',
    },
    secondaryEntities: [],
  };
}

export function missingSceneTargetColor(id: string, setting: unknown): string | undefined {
  const value = targetConfig(setting);
  if (value.state === 'off' || inferSceneTargetDomain(id, setting) !== 'light') return undefined;
  const { state: _state, ...attributes } = value;
  return lightColor({ entity_id: 'light.unavailable', state: 'on', attributes, last_changed: '' });
}

export function scenePreviewAccessory(
  id: string,
  entity: HassEntity,
  owner: HausAccessory | undefined,
  setting: unknown,
  useSetting: boolean,
): HausAccessory {
  const rawDraft = useSetting ? sceneTargetEntity(entity, setting) : entity;
  const domain = id.split('.')[0];
  const attrs = { ...rawDraft.attributes };
  if (useSetting && domain === 'climate' && attrs.temperature != null) {
    delete attrs.current_temperature;
  }
  if (useSetting && domain === 'media_player' && targetConfig(setting).media_title == null) {
    delete attrs.media_title;
  }
  const name = String(entity.attributes.friendly_name ?? owner?.name ?? id);
  return {
    id: owner?.id ?? id,
    deviceId: owner?.deviceId,
    primaryEntityId: id,
    entityIds: [id],
    areaId: owner?.areaId,
    manufacturer: owner?.manufacturer,
    model: owner?.model,
    deviceType: owner?.deviceType,
    category: owner?.category ?? DOMAIN_TO_CATEGORY[domain] ?? 'other',
    name,
    availability: useSetting
      ? 'available'
      : entity.state === 'unavailable'
        ? 'unavailable'
        : entity.state === 'unknown'
          ? 'unknown'
          : 'available',
    capabilities: owner?.capabilities ?? [],
    state: { ...rawDraft, attributes: attrs },
    secondaryEntities: [],
  };
}

export function describeSavedTargetValues(id: string, setting: unknown): string {
  const value = targetConfig(setting);
  if (value.state === 'off') return 'Off';
  const parts = [titleCase(String(value.state ?? 'on'))];
  const domain = inferSceneTargetDomain(id, setting);
  const brightness = finite(value.brightness);
  if (domain === 'light' && brightness !== undefined) {
    parts.push(`${Math.round(clamp(brightness, 0, 255) / 2.55)}%`);
  }
  const kelvin =
    finite(value.color_temp_kelvin) ??
    (finite(value.color_temp) ? 1e6 / Number(value.color_temp) : 0);
  if (Number.isFinite(kelvin) && kelvin > 0) parts.push(`${Math.round(kelvin)} K`);
  if (typeof value.effect === 'string' && value.effect.trim()) parts.push(value.effect);
  if (finite(value.temperature) !== undefined) parts.push(`${value.temperature}°`);
  if (finite(value.current_position) !== undefined) parts.push(`${value.current_position}% open`);
  if (finite(value.percentage) !== undefined)
    parts.push(`${Math.round(Number(value.percentage))}%`);
  if (finite(value.volume_level) !== undefined) {
    parts.push(`${Math.round(Number(value.volume_level) * 100)}% vol`);
  }
  return parts.join(' · ');
}

export function describeSceneTarget(
  id: string,
  entity: HassEntity | undefined,
  setting: unknown,
): string {
  if (!entity) {
    const saved = describeSavedTargetValues(id, setting);
    return saved ? `Unavailable · ${saved}` : 'Unavailable';
  }
  const preview = sceneTargetEntity(entity, setting);
  const domain = id.split('.')[0];
  if (domain === 'light') return lightStateDescription(preview);
  const value = targetConfig(setting);
  if (domain === 'fan' && value.state !== 'off' && finite(value.percentage) !== undefined) {
    return `On · ${Math.round(Number(value.percentage))}%`;
  }
  if (
    domain === 'media_player' &&
    value.state !== 'off' &&
    finite(value.volume_level) !== undefined
  ) {
    return `${titleCase(String(preview.state))} · ${Math.round(Number(value.volume_level) * 100)}%`;
  }
  return describeAccessory(scenePreviewAccessory(id, entity, undefined, setting, true));
}

const PREFERRED_HVAC_MODES = ['auto', 'heat_cool', 'heat', 'cool'] as const;

function preferredHvacMode(modes: readonly string[], fallback: string): string {
  return (
    PREFERRED_HVAC_MODES.find((preferred) => modes.includes(preferred)) ??
    modes.find((mode) => mode !== 'off') ??
    fallback
  );
}

export function toggleSceneTargetState(
  id: string,
  entity: HassEntity | undefined,
  setting: unknown,
): SceneTarget {
  const config = targetConfig(setting);
  const domain = id.split('.')[0];
  const current = String(config.state ?? '');
  if (domain === 'cover') {
    return patchSceneTarget(config, 'state', current === 'closed' ? 'open' : 'closed');
  }
  if (domain === 'lock') {
    return patchSceneTarget(config, 'state', current === 'locked' ? 'unlocked' : 'locked');
  }
  if (domain === 'climate') {
    const modes = Array.isArray(entity?.attributes.hvac_modes)
      ? entity.attributes.hvac_modes.filter((m): m is string => typeof m === 'string')
      : [];
    return patchSceneTarget(
      config,
      'state',
      current === 'off' ? preferredHvacMode(modes, 'heat') : 'off',
    );
  }
  return patchSceneTarget(config, 'state', current === 'off' ? 'on' : 'off');
}

function normalizeStateForDomain(
  savedState: string | undefined,
  targetDomain: string,
  targetEntity: HassEntity,
): string {
  const offLike = savedState === 'off' || savedState === 'closed' || savedState === 'locked';
  if (targetDomain === 'cover') return offLike ? 'closed' : 'open';
  if (targetDomain === 'lock') return offLike ? 'locked' : 'unlocked';
  if (targetDomain === 'climate') {
    const modes = Array.isArray(targetEntity.attributes.hvac_modes)
      ? targetEntity.attributes.hvac_modes.filter((m): m is string => typeof m === 'string')
      : [];
    if (savedState && (!modes.length || modes.includes(savedState))) return savedState;
    if (offLike && (!modes.length || modes.includes('off'))) return 'off';
    return preferredHvacMode(modes, 'off');
  }
  if (targetDomain === 'media_player') {
    if (savedState && ['off', 'on', 'playing', 'paused'].includes(savedState)) return savedState;
    return offLike ? 'off' : 'on';
  }
  return offLike ? 'off' : 'on';
}

function preservePreset(saved: SceneTarget, attrs: Record<string, unknown>, next: SceneTarget) {
  if (typeof saved.preset_mode !== 'string' || !saved.preset_mode.trim()) return;
  const presets = Array.isArray(attrs.preset_modes)
    ? attrs.preset_modes.filter((p): p is string => typeof p === 'string')
    : [];
  if (!presets.length || presets.includes(saved.preset_mode)) {
    next.preset_mode = saved.preset_mode;
  }
}

/** Transfers saved values from a missing scene target onto a replacement device, adapting to its capabilities. */
export function transferSceneTarget(setting: unknown, targetEntity: HassEntity): SceneTarget {
  const saved = targetConfig(setting);
  const targetDomain = targetEntity.entity_id.split('.')[0];
  const attrs = targetEntity.attributes;
  const savedState = typeof saved.state === 'string' ? saved.state : undefined;
  const next: SceneTarget = {
    state: normalizeStateForDomain(savedState, targetDomain, targetEntity),
  };

  const transition = finite(saved.transition);
  if (transition !== undefined && transition >= 0) next.transition = transition;

  if (targetDomain === 'light') {
    const hasAdvertisedModes =
      Array.isArray(attrs.supported_color_modes) && attrs.supported_color_modes.length > 0;
    const profile = lightProfile(targetEntity);
    const allowBrightness = !hasAdvertisedModes || profile.brightness;
    const allowTemp = !hasAdvertisedModes || profile.temperature;
    const allowColor = !hasAdvertisedModes || profile.color;

    const brightness = finite(saved.brightness);
    if (allowBrightness && brightness !== undefined) {
      next.brightness = Math.round(clamp(brightness, 1, 255));
    }

    const activeColorKey = targetColorKey(saved);
    const savedKelvin =
      finite(saved.color_temp_kelvin) ??
      (finite(saved.color_temp) ? Math.round(1e6 / Number(saved.color_temp)) : undefined);
    const minKelvin =
      finite(attrs.min_color_temp_kelvin) ??
      (finite(attrs.max_mireds) ? Math.round(1e6 / Number(attrs.max_mireds)) : 1500);
    const maxKelvin =
      finite(attrs.max_color_temp_kelvin) ??
      (finite(attrs.min_mireds) ? Math.round(1e6 / Number(attrs.min_mireds)) : 9000);

    if (
      (activeColorKey === 'color_temp_kelvin' || activeColorKey === 'color_temp') &&
      savedKelvin !== undefined &&
      (allowTemp || allowColor)
    ) {
      if (allowTemp) {
        next.color_temp_kelvin = Math.round(clamp(savedKelvin, minKelvin, maxKelvin));
        next.color_mode = 'color_temp';
      } else {
        const rgb = parseRgbString(
          lightColor({
            entity_id: targetEntity.entity_id,
            state: 'on',
            attributes: { color_temp_kelvin: savedKelvin },
            last_changed: '',
          }),
        );
        if (rgb) {
          next.rgb_color = rgb;
          next.color_mode = 'rgb';
        }
      }
    } else if (activeColorKey && allowColor) {
      next[activeColorKey] = saved[activeColorKey];
      next.color_mode = SCENE_COLOR_MODES[activeColorKey];
    } else if (hasAdvertisedModes && !profile.brightness) {
      next.color_mode = 'onoff';
    } else if (
      hasAdvertisedModes &&
      !profile.color &&
      !profile.temperature &&
      next.brightness != null
    ) {
      next.color_mode = 'brightness';
    }

    if (typeof saved.effect === 'string' && saved.effect.trim()) {
      if (lightEffects(targetEntity).includes(saved.effect)) next.effect = saved.effect;
    }
    return next;
  }

  if (targetDomain === 'climate') {
    const temp = finite(saved.temperature);
    if (temp !== undefined) {
      next.temperature = clamp(temp, finite(attrs.min_temp) ?? 5, finite(attrs.max_temp) ?? 40);
    }
    preservePreset(saved, attrs, next);
    return next;
  }

  if (targetDomain === 'cover') {
    const pos = finite(saved.current_position);
    if (pos !== undefined) {
      const clamped = Math.round(clamp(pos, 0, 100));
      next.current_position = clamped;
      next.state = clamped > 0 ? 'open' : 'closed';
    }
    return next;
  }

  if (targetDomain === 'fan') {
    const pct = finite(saved.percentage);
    if (pct !== undefined) next.percentage = Math.round(clamp(pct, 0, 100));
    preservePreset(saved, attrs, next);
    return next;
  }

  if (targetDomain === 'media_player') {
    const vol = finite(saved.volume_level);
    if (vol !== undefined) next.volume_level = Number(clamp(vol, 0, 1).toFixed(2));
    return next;
  }

  return next;
}

export function replaceSceneEntity(
  entities: Record<string, unknown>,
  oldId: string,
  targetEntity: HassEntity,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(entities)) {
    if (id === oldId) continue;
    next[id] = value;
  }
  next[targetEntity.entity_id] = transferSceneTarget(entities[oldId], targetEntity);
  return next;
}
