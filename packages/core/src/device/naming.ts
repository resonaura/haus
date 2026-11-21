/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { Capability } from '../types.js';
import type { HausDevice, HausEndpoint } from './types.js';

/** Canonical display labels for standard HAP/Haus characteristic types. */
export const STANDARD_CHARACTERISTIC_LABELS: Readonly<Record<string, string>> = {
  on_off: 'Power',
  brightness: 'Brightness',
  color_temp: 'Color Temperature',
  color_temp_kelvin: 'Color Temperature',
  color_hsv: 'Color',
  color: 'Color',
  effect: 'Effect',
  climate: 'Climate',
  hvac_mode: 'Mode',
  fan_mode: 'Fan Mode',
  swing_mode: 'Swing Mode',
  swing_horizontal_mode: 'Horizontal Swing',
  target_temperature: 'Target Temperature',
  current_temperature: 'Temperature',
  water_heater: 'Water Heater',
  lock: 'Lock',
  lock_state: 'Lock',
  cover: 'Cover',
  position: 'Position',
  tilt: 'Tilt',
  video: 'Camera',
  camera: 'Camera',
  weather: 'Weather',
  media_playback: 'Media',
  volume: 'Volume',
  mute: 'Mute',
  source: 'Source',
  remote_key: 'Remote',
  remote: 'Remote',
  update: 'Firmware',
  device_tracker: 'Presence',
  temperature: 'Temperature',
  humidity: 'Humidity',
  motion: 'Motion',
  occupancy: 'Occupancy',
  presence: 'Presence',
  contact: 'Contact',
  door: 'Door',
  window: 'Window',
  opening: 'Opening',
  garage_door: 'Garage Door',
  leak: 'Leak',
  moisture: 'Leak',
  vibration: 'Vibration',
  smoke: 'Smoke',
  gas: 'Gas',
  carbon_monoxide: 'Carbon Monoxide',
  safety: 'Safety',
  tamper: 'Tamper',
  battery: 'Battery',
  battery_low: 'Low Battery',
  illuminance: 'Illuminance',
  power: 'Power',
  electrical_power: 'Power',
  energy: 'Energy',
  voltage: 'Voltage',
  current: 'Current',
  pressure: 'Pressure',
  co2: 'CO2',
  carbon_dioxide: 'CO2',
  tvoc: 'TVOC',
  pm25: 'PM2.5',
  pm10: 'PM10',
  aqi: 'Air Quality',
  connectivity: 'Connectivity',
  signal_strength: 'Signal Strength',
  linkquality: 'Link Quality',
};

/** Standard HAP sensor & diagnostic characteristic types that do not need custom entity names. */
export const STANDARD_SENSOR_TYPES: ReadonlySet<string> = new Set(
  [
    'temperature humidity motion occupancy presence contact door window opening garage_door',
    'leak moisture vibration smoke gas carbon_monoxide safety tamper battery battery_low',
    'illuminance power electrical_power energy voltage current pressure co2 carbon_dioxide',
    'tvoc pm25 pm10 aqi connectivity signal_strength linkquality',
  ]
    .join(' ')
    .split(' '),
);

const LIGHT_EXTRA_CAPS = new Set(['brightness', 'color', 'color_temp', 'color_hsv', 'effect']);

const ROLE_WORDS = new Set(
  [
    'segment tube all button rotary dimmer socket outlet switch sd ptz pan alarm keep wind',
    'total session connected rain snow air filter timer motion light water contact temperature',
    'humidity battery power status firmware request live native p2p rtsp wifi system human face',
    'package pets vehicle ai lens lingerer pir dew apparent cloud precipitation uv visibility',
    'weather block ad gaming illegal chat adult shopping social streaming violent paused',
    'safesearch youtube run backup band advanced dynamic local guest ipv6 smart thread upnp',
    'wpa3 input real weight',
  ]
    .join(' ')
    .split(' '),
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSpace(value: string): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function humanizeToken(token: string): string {
  const spaced = token.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!spaced) return '';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Resolves the canonical display label for a standard HAP characteristic type. */
export function standardCharacteristicLabel(
  capId: string,
  deviceClass?: string,
): string | undefined {
  if (deviceClass && STANDARD_CHARACTERISTIC_LABELS[deviceClass]) {
    return STANDARD_CHARACTERISTIC_LABELS[deviceClass];
  }
  return STANDARD_CHARACTERISTIC_LABELS[capId];
}

/** True when a capability represents a standard typed HAP characteristic. */
export function isStandardCharacteristicType(capId: string, deviceClass?: string): boolean {
  return Boolean(standardCharacteristicLabel(capId, deviceClass));
}

export interface StripPrefixOptions {
  readonly model?: string;
  readonly extraPrefixes?: readonly string[];
}

/**
 * Strips redundant device-name / model / node-slug prefixes from a custom characteristic name
 * and cleans parenthesized slug suffixes such as `(switch_1)` -> `Switch 1`. Idempotent.
 */
export function stripDeviceNamePrefix(
  rawName: string,
  deviceName: string,
  options?: StripPrefixOptions,
): string {
  let cleaned = normalizeSpace(rawName);
  if (!cleaned) return '';

  const candidates = new Set<string>();
  const devClean = normalizeSpace(deviceName);
  if (devClean.length >= 2) {
    candidates.add(devClean);
    const noHue = normalizeSpace(devClean.replace(/\(\s*hue\s*\)/gi, ''));
    if (noHue.length >= 2) candidates.add(noHue);
    const collapsed = devClean.replace(/\s+/g, '');
    if (collapsed.length >= 4 && collapsed.toLowerCase() !== devClean.toLowerCase()) {
      candidates.add(collapsed);
    }
  }
  if (options?.model) {
    const modelClean = normalizeSpace(options.model);
    if (modelClean.length >= 3) candidates.add(modelClean);
  }
  for (const extra of options?.extraPrefixes ?? []) {
    const extraClean = normalizeSpace(extra);
    if (extraClean.length >= 3) candidates.add(extraClean);
  }

  const ordered = [...candidates].sort((a, b) => b.length - a.length);
  for (const prefix of ordered) {
    const pattern = new RegExp(
      `^${escapeRegExp(prefix)}(?=$|[\\s:·|/–—\\-(])(?:[\\s:·|/–—-]+)?`,
      'iu',
    );
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, '').trim();
      break;
    }
  }

  const parenMatch = /^\(([a-z0-9][a-z0-9_\-\s]*)\)$/i.exec(cleaned);
  if (parenMatch?.[1]) {
    cleaned = humanizeToken(parenMatch[1]);
  }

  return normalizeSpace(cleaned);
}

function sensorTypeForCapability(cap: Capability): string | undefined {
  if (cap.deviceClass && STANDARD_SENSOR_TYPES.has(cap.deviceClass)) {
    return cap.deviceClass;
  }
  if (STANDARD_SENSOR_TYPES.has(cap.id)) {
    return cap.id;
  }
  return undefined;
}

function isWritableCap(cap: Capability): boolean {
  return (
    Array.isArray(cap.operations) &&
    cap.operations.some((op) =>
      ['set', 'turn_on', 'turn_off', 'press', 'lock', 'unlock', 'set_temperature'].includes(op),
    )
  );
}

/**
 * Classifies an endpoint into a canonical HAP role string when it represents a standard
 * typed service/characteristic, or `undefined` when it requires a custom label.
 */
export function classifyEndpointHapRole(
  endpoint: HausEndpoint,
  deviceCategory: string | undefined,
  strippedName?: string,
  hasDimmableLightSibling = false,
): string | undefined {
  const caps = Array.isArray(endpoint.capabilities) ? endpoint.capabilities : [];
  if (caps.length === 0) return undefined;

  const ids = new Set(caps.map((cap) => cap.id));
  const isConfigOrDiag = caps.every(
    (cap) => cap.entityCategory === 'config' || cap.entityCategory === 'diagnostic',
  );

  // Standard diagnostic/firmware services that are always typed in HAP.
  if (ids.has('update')) return 'update';
  if (ids.has('device_tracker')) return 'device_tracker';

  // Primary functional device services.
  if (ids.has('climate') || (deviceCategory === 'climate' && ids.has('target_temperature'))) {
    return 'climate';
  }
  if (
    ids.has('water_heater') ||
    (deviceCategory === 'appliances' && ids.has('target_temperature'))
  ) {
    return 'water_heater';
  }
  if (ids.has('video') || ids.has('camera')) return 'camera';
  if (ids.has('lock') || ids.has('lock_state')) return 'lock';
  if (
    (ids.has('cover') || ids.has('position') || ids.has('tilt')) &&
    (deviceCategory === 'covers' || caps.some(isWritableCap))
  ) {
    return 'cover';
  }
  if (ids.has('weather')) return 'weather';
  if (ids.has('media_playback')) return 'media_player';
  if (ids.has('remote_key') || ids.has('remote')) return 'remote';

  // Lights: nameless on lighting/generic devices when not a config/diagnostic status LED.
  const hasRichLightCaps = caps.some((cap) => LIGHT_EXTRA_CAPS.has(cap.id));
  const isExplicitLightEndpoint =
    endpoint.category === 'lighting' ||
    endpoint.id.startsWith('light.') ||
    Boolean(endpoint.sourceRefs?.some((ref) => ref.metadata?.['entityDomain'] === 'light'));
  const hasLightControl =
    (ids.has('on_off') || ids.has('power')) &&
    (hasRichLightCaps ||
      isExplicitLightEndpoint ||
      (deviceCategory === 'lighting' && !hasDimmableLightSibling));
  if (hasLightControl) {
    if (isConfigOrDiag) return undefined;
    if (deviceCategory === 'lighting' || deviceCategory === 'generic' || isExplicitLightEndpoint) {
      return 'light';
    }
    return undefined;
  }

  // Writable switches / outlets: nameless ONLY as the sole primary switch on power/generic devices.
  const isWritableSwitch =
    caps.length === 1 &&
    (caps[0]?.id === 'on_off' || caps[0]?.id === 'power') &&
    isWritableCap(caps[0]);
  if (isWritableSwitch) {
    if (isConfigOrDiag) return undefined;
    if (deviceCategory === 'power' || deviceCategory === 'generic') return 'switch';
    return undefined;
  }

  // Standard sensor / multi-cap standard telemetry endpoints (e.g. [contact, battery], [power, running]).
  const sensorRoles = caps.map((cap) => sensorTypeForCapability(cap));
  const nonNullRoles = sensorRoles.filter((role): role is string => Boolean(role));
  if (nonNullRoles.length === caps.length) {
    const primaryRole =
      caps
        .filter((cap) => cap.entityCategory !== 'diagnostic' && cap.id !== 'battery')
        .map((cap) => sensorTypeForCapability(cap))
        .find((role): role is string => Boolean(role)) ?? nonNullRoles[0];
    if (
      primaryRole === 'presence' &&
      deviceCategory === 'appliances' &&
      strippedName &&
      strippedName.toLowerCase() !== 'presence'
    ) {
      return undefined;
    }
    return primaryRole;
  }

  // Tuya smart-plug telemetry bundle: [power, running] on a power device.
  if (
    caps.length === 2 &&
    ids.has('power') &&
    ids.has('running') &&
    (deviceCategory === 'power' || deviceCategory === 'energy')
  ) {
    return 'power';
  }

  return undefined;
}

function deriveExtraPrefixes(device: Pick<HausDevice, 'name' | 'endpoints'>): readonly string[] {
  const extra: string[] = [];
  const named = device.endpoints
    .map((ep) => ({ id: ep.id, name: normalizeSpace(ep.name) }))
    .filter((ep) => ep.name.length > 0);
  if (named.length < 2) return extra;

  // 1. Trailing multi-word device name suffix (e.g. "Hue Bridge" in "Narnia Hue Bridge").
  const devWords = normalizeSpace(device.name).split(' ');
  if (devWords.length >= 3) {
    for (let start = 1; start <= devWords.length - 2; start += 1) {
      const suffix = devWords.slice(start).join(' ');
      if (suffix.length < 4) continue;
      const re = new RegExp(`^${escapeRegExp(suffix)}(?=$|[\\s:·|/–—-])`, 'iu');
      if (named.every((ep) => re.test(ep.name))) {
        extra.push(suffix);
        break;
      }
    }
  }

  // 2. Shared ESPHome / HA entity-id host prefix (e.g. `backlight_*`, `foxydistance_*`).
  const firstTokens = named.map((ep) => {
    const objId = ep.id.includes('.') ? ep.id.split('.').slice(1).join('.') : ep.id;
    return objId.split('_')[0]?.toLowerCase() ?? '';
  });
  const sharedToken = firstTokens[0];
  if (
    sharedToken &&
    sharedToken.length >= 4 &&
    !ROLE_WORDS.has(sharedToken) &&
    firstTokens.every((token) => token === sharedToken)
  ) {
    const re = new RegExp(`^${escapeRegExp(sharedToken)}(?=$|[\\s:·|/–—-])`, 'iu');
    if (named.every((ep) => re.test(ep.name))) {
      extra.push(sharedToken);
    }
  }

  // 3. Shared multi-word hardware/model prefix present on 100% of a device's named endpoints
  //    (e.g. "Smart Scale P3 Real-time weight" & "Smart Scale P3 Weight" on renamed "Living Room Scale").
  const wordLists = named.map((ep) => ep.name.split(' '));
  let sharedWordCount = 0;
  const minWords = Math.min(...wordLists.map((words) => words.length));
  while (sharedWordCount < minWords - 1) {
    const candidate = wordLists[0]![sharedWordCount]!.toLowerCase();
    if (wordLists.every((words) => words[sharedWordCount]!.toLowerCase() === candidate)) {
      sharedWordCount += 1;
    } else {
      break;
    }
  }
  if (sharedWordCount >= 2) {
    const sharedWords = wordLists[0]!.slice(0, sharedWordCount);
    const hasRoleWord = sharedWords.some((word) => ROLE_WORDS.has(word.toLowerCase()));
    const hasModelIndicator = sharedWords.some(
      (word) => /\d/.test(word) || /scale|bridge|meter|hub/i.test(word),
    );
    if (!hasRoleWord || hasModelIndicator) {
      extra.push(sharedWords.join(' '));
    }
  }

  return extra;
}

export function deviceHasDimmableLightEndpoint(endpoints: readonly HausEndpoint[]): boolean {
  return endpoints.some(
    (ep) =>
      Array.isArray(ep.capabilities) &&
      ep.capabilities.some((cap) => cap.id === 'on_off') &&
      ep.capabilities.some((cap) => LIGHT_EXTRA_CAPS.has(cap.id)),
  );
}

/**
 * Normalizes `endpoint.name` across a device according to the HAP characteristic naming contract:
 * - Standard unique typed endpoints carry `name: ''` (their capability type IS their identity).
 * - Custom/generic or multi-instance sibling endpoints keep only their concise stripped label.
 * - Preserves 100% of `endpoint.id`, `address`, `capabilities`, `readings`, and `sourceRefs`.
 * - Strictly idempotent.
 */
export function normalizeDeviceEndpointsForHap(
  device: Pick<HausDevice, 'name' | 'category' | 'model' | 'endpoints'>,
): readonly HausEndpoint[] {
  if (device.endpoints.length === 0) return device.endpoints;

  const extraPrefixes = deriveExtraPrefixes(device);
  const stripOpts: StripPrefixOptions = { model: device.model, extraPrefixes };
  const hasDimmableLight = deviceHasDimmableLightEndpoint(device.endpoints);

  const strippedNames = device.endpoints.map((ep) =>
    stripDeviceNamePrefix(ep.name, device.name, stripOpts),
  );
  const roles = device.endpoints.map((ep, idx) =>
    classifyEndpointHapRole(ep, device.category, strippedNames[idx], hasDimmableLight),
  );

  const roleCounts = new Map<string, number>();
  for (const role of roles) {
    if (!role) continue;
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }

  let changed = false;
  const next = device.endpoints.map((ep, idx) => {
    const role = roles[idx];
    const desiredName = role && roleCounts.get(role) === 1 ? '' : (strippedNames[idx] ?? '');
    if (ep.name === desiredName) return ep;
    changed = true;
    return { ...ep, name: desiredName };
  });

  return changed ? next : device.endpoints;
}
