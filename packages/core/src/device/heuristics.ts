/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { DeviceCategory } from './category.js';
import type { HausEndpoint } from './types.js';

const ENTITY_ROLE_SUFFIX_PATTERNS: readonly RegExp[] = [
  /\s+Power\s+Switch$/i,
  /\s+Request\s+Platform\s+API\s+State$/i,
  /\s+Segment\s+\d+$/i,
  /\s+Zone\s+\d+$/i,
  /\s+Pixel\s+\d+$/i,
  /\s+Tube\s+\d+$/i,
  /\s+All\s+Tubes$/i,
  /\s+Status$/i,
  /\s+Connectivity$/i,
  /\s+Linkquality$/i,
];

/**
 * Strips trailing entity-role suffixes from an entity label to recover the
 * physical device's base display name.
 */
export function stripEntityRoleSuffix(name: string): string {
  let cleaned = name.trim();
  for (const pattern of ENTITY_ROLE_SUFFIX_PATTERNS) {
    cleaned = cleaned.replace(pattern, '').trim();
  }
  return cleaned || name.trim();
}

export function slugifyIdentifier(raw: string): string {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unassigned'
  );
}

const STANDARD_ROOM_PREFIXES: readonly RegExp[] = [
  /^(living\s+room|family\s+room|dining\s+room|kids?\s+room|guest\s+room|laundry\s+room|utility\s+room|server\s+room|media\s+room)\b/i,
  /^(master\s+bedroom|bedroom|kitchen|bathroom|restroom|office|study|hallway|corridor|entryway|foyer|garage|basement|attic|balcony|patio|terrace|garden|outdoor|backyard|front\s+yard|nursery|closet|pantry|workshop|gym|studio|porch|sunroom|den|loft)\b/i,
];

const NON_ROOM_MODIFIERS = new Set([
  'smart',
  'wifi',
  'zigbee',
  'matter',
  'thread',
  'bluetooth',
  'ble',
  'mqtt',
  'rgb',
  'rgbic',
  'led',
  'ir',
  'rf',
  'hd',
  'ptz',
  'pro',
  'mini',
  'plus',
  'max',
  'ultra',
  'portable',
  'wireless',
  'digital',
  'automatic',
  'electric',
  'nixie',
  'tube',
  'clocteck',
  'govee',
  'aqara',
  'xiaomi',
  'mijia',
  'philips',
  'hue',
  'tuya',
  'sonoff',
  'shelly',
  'tapo',
  'kasa',
  'reolink',
  'eufy',
  'ring',
  'nest',
  'ecobee',
  'meross',
  'switchbot',
  'yeelight',
  'nanoleaf',
  'lifx',
  'ikea',
  'tradfri',
  'bosch',
  'dyson',
  'roborock',
  'dreame',
  'water',
  'leak',
  'flood',
  'moisture',
  'contact',
  'door',
  'window',
  'vibration',
  'tilt',
  'shock',
  'motion',
  'occupancy',
  'presence',
  'pir',
  'mmwave',
  'radar',
  'temperature',
  'humidity',
  'temp',
  'climate',
  'weather',
  'barometric',
  'pressure',
  'air',
  'quality',
  'voc',
  'tvoc',
  'co2',
  'co',
  'carbon',
  'monoxide',
  'dioxide',
  'smoke',
  'fire',
  'gas',
  'soil',
  'plant',
  'rain',
  'wind',
  'uv',
  'light',
  'illuminance',
  'lux',
  'ambient',
  'sound',
  'noise',
  'power',
  'energy',
  'voltage',
  'current',
  'battery',
  'security',
  'alarm',
  'siren',
  'bridge',
  'hub',
  'gateway',
  'homekit',
]);

/**
 * Matches "<Location Prefix> <Hardware Noun>" so any user's custom room name
 * (e.g. "Sunroom Fan", "Kids Playroom Camera", "Server Closet Switch") is
 * extracted without hardcoding household rooms.
 */
const LOCATION_BEFORE_DEVICE_NOUN =
  /^([A-Za-z][A-Za-z0-9'-]*(?:\s+[A-Za-z][A-Za-z0-9'-]*){0,2}?)\s+(?:(?:bed|floor|corner|couch|window|desk|table|wall|ceiling|pendant|night|reading|grow|ambient|tv|projector|monitor|tube|nixie|smart|led|rgb|xbox|pc|vinyl|string|fairy|temperature|humidity|motion|occupancy|door|contact|water|leak|smoke|gas|air|plant|soil|light|sound|vibration)\s+)*(?:lamps?|lights?|lighting|strips?|garlands?|backlights?|bulbs?|sconces?|spotlights?|lanterns?|chandeliers?|cameras?|doorbells?|sensors?|monitors?|thermostats?|heaters?|air\s+purifiers?|air\s+conditioners?|humidifiers?|dehumidifiers?|fans?|kettles?|locks?|blinds?|curtains?|shades?|shutters?|covers?|plugs?|outlets?|sockets?|switches?|relays?|power|clocks?|vacuums?|speakers?|tvs?|projectors?)$/i;

const STANDARD_ROOM_TOKENS = new Set([
  'living_room',
  'bedroom',
  'kitchen',
  'bathroom',
  'office',
  'study',
  'hallway',
  'corridor',
  'entryway',
  'foyer',
  'garage',
  'basement',
  'attic',
  'balcony',
  'patio',
  'garden',
  'backyard',
  'outdoor',
  'nursery',
  'playroom',
  'laundry',
  'pantry',
  'closet',
  'wardrobe',
  'workshop',
  'gym',
]);

/**
 * Infers a canonical room ID from explicit metadata, known rooms, or
 * structural "<Room> <Device Type>" naming conventions.
 */
export function inferRoomIdFromLabels(params: {
  readonly suggestedArea?: string;
  readonly existingRoomId?: string;
  readonly candidateLabels: readonly string[];
  readonly knownRoomIds?: ReadonlySet<string>;
}): string {
  const { suggestedArea, existingRoomId, candidateLabels, knownRoomIds } = params;
  if (existingRoomId && existingRoomId !== 'unassigned') {
    if (knownRoomIds && knownRoomIds.size > 0) {
      for (const roomId of knownRoomIds) {
        if (
          roomId !== existingRoomId &&
          (existingRoomId.startsWith(`${roomId}_`) || existingRoomId.endsWith(`_${roomId}`))
        ) {
          return roomId;
        }
      }
    }
    return existingRoomId;
  }
  if (suggestedArea && suggestedArea.trim()) {
    return slugifyIdentifier(suggestedArea);
  }

  for (const rawLabel of candidateLabels) {
    const label = stripEntityRoleSuffix(rawLabel);
    if (!label) continue;

    for (const pattern of STANDARD_ROOM_PREFIXES) {
      const match = label.match(pattern);
      if (match?.[1]) return slugifyIdentifier(match[1]);
    }

    if (knownRoomIds && knownRoomIds.size > 0) {
      const lowerSlug = slugifyIdentifier(label);
      for (const roomId of knownRoomIds) {
        if (lowerSlug === roomId || lowerSlug.startsWith(`${roomId}_`)) return roomId;
      }
    }

    const nounMatch =
      label.match(LOCATION_BEFORE_DEVICE_NOUN) ??
      rawLabel.trim().match(LOCATION_BEFORE_DEVICE_NOUN);
    if (nounMatch?.[1]) {
      const tokens = nounMatch[1].trim().split(/\s+/);
      const validLocation =
        tokens.length > 0 &&
        tokens.length <= 3 &&
        tokens.every((t) => !NON_ROOM_MODIFIERS.has(t.toLowerCase()));
      if (validLocation) {
        const candidateSlug = slugifyIdentifier(nounMatch[1]);
        if (candidateSlug && candidateSlug !== 'unassigned') {
          return candidateSlug;
        }
      }
    }
  }

  for (const rawLabel of candidateLabels) {
    const slugTokens = slugifyIdentifier(rawLabel).split('_');
    for (const token of slugTokens) {
      if (STANDARD_ROOM_TOKENS.has(token) || knownRoomIds?.has(token)) {
        return token;
      }
    }
  }

  return 'unassigned';
}

const DIAGNOSTIC_ID_OR_NAME_PATTERN =
  /(?:^|[_.\s-])(request[_-\s]platform|gv2mqtt[_-\s]status|purge[_-\s]caches?|global[_-\s]version|refresh|status[_-\s]code|heating[_-\s]mode|keep[_-\s]warm[_-\s]remaining|lift[_-\s]memory|temp[_-\s]set|connected|firmware|sw[_-\s]version|hw[_-\s]version|rssi|lqi|linkquality|signal[_-\s]strength|uptime|free[_-\s]space|sd[_-\s]card|sd[_-\s]free|wakeup[_-\s]num|ip[_-\s]address|mac[_-\s]address|ssid)(?:$|[_.\s-])/i;

const CONFIG_ID_OR_NAME_PATTERN =
  /(?:^|[_.\s-])(auto[_-\s]keep[_-\s]warm|keep[_-\s]warm[_-\s]refill|keep[_-\s]warm[_-\s]temperature|keep[_-\s]warm[_-\s]time|extended[_-\s]keep[_-\s]warm|timezone|time[_-\s]format|sync[_-\s]time|alarm[_-\s]hour|alarm[_-\s]minute|alarm[_-\s]duration|alarm[_-\s]volume|alarm[_-\s]sound|timer|flip|mirror|indicator[_-\s]light|status[_-\s]light|led[_-\s]indicator|timestamp[_-\s]watermark|watermark|booby[_-\s]trap|force[_-\s]night[_-\s]vision|night[_-\s]vision|motion[_-\s]alarm|sound[_-\s]alarm|human[_-\s]alarm|pets?[_-\s]alarm|gesture[_-\s]event|gesture[_-\s]type|sound[_-\s]level|resolution|start[_-\s]calibration|calibrate|ptz[_-\s](?:up|down|left|right|stop)|child[_-\s]lock|beep|mute|eco[_-\s]mode)(?:$|[_.\s-])/i;

/**
 * Classifies whether an endpoint/component is a secondary 'config' or
 * 'diagnostic' entity when the source integration omits `entity_category`.
 */
export function inferEntityCategory(params: {
  readonly component: string;
  readonly id: string;
  readonly name: string;
  readonly deviceClass?: string;
  readonly explicitCategory?: string;
  readonly isCameraSubEntity?: boolean;
}): 'config' | 'diagnostic' | undefined {
  const { component, id, name, deviceClass, explicitCategory, isCameraSubEntity } = params;
  if (explicitCategory === 'config' || explicitCategory === 'diagnostic') {
    return explicitCategory;
  }

  const label = `${id} ${name}`;

  if (
    deviceClass &&
    ['connectivity', 'signal_strength', 'timestamp', 'problem', 'duration'].includes(deviceClass)
  ) {
    return 'diagnostic';
  }

  if (DIAGNOSTIC_ID_OR_NAME_PATTERN.test(label)) {
    return 'diagnostic';
  }

  if (CONFIG_ID_OR_NAME_PATTERN.test(label)) {
    return 'config';
  }

  if (component === 'number' || component === 'select') {
    return 'config';
  }

  if (isCameraSubEntity && component !== 'camera') {
    if (component === 'sensor' || component === 'binary_sensor') return 'diagnostic';
    if (!/(?:^|[_.\s-])(sleep|power)(?:$|[_.\s-])/i.test(label)) return 'config';
  }

  return undefined;
}

/**
 * Determines the high-level `DeviceCategory` of a physical device from its
 * capabilities, model, and display name.
 */
export function inferDeviceCategory(params: {
  readonly id: string;
  readonly name: string;
  readonly model?: string;
  readonly endpoints: readonly HausEndpoint[];
}): DeviceCategory {
  const { id, name, model, endpoints } = params;
  const context = `${id} ${name} ${model ?? ''}`;

  const caps = new Set(endpoints.flatMap((ep) => ep.capabilities.map((c) => c.id)));

  if (
    caps.has('video') ||
    /\b(camera|doorbell|nvr|ipcam|g2h|g3|ch-h0[1-9]|onvif)\b/i.test(context)
  ) {
    return 'cameras';
  }
  if (
    caps.has('water_heater') ||
    /\b(kettle|water\s*heater|boiler|coffee|dishwasher|washer|dryer|oven|microwave)\b/i.test(
      context,
    )
  ) {
    return 'appliances';
  }
  if (
    caps.has('climate') ||
    caps.has('fan') ||
    /\b(thermostat|hvac|air\s*conditioner|air\s*purifier|humidifier|dehumidifier|heater|cooler|fan)\b/i.test(
      context,
    )
  ) {
    return 'climate';
  }
  if (
    caps.has('brightness') ||
    caps.has('color') ||
    caps.has('color_temp') ||
    caps.has('effect') ||
    endpoints.some((ep) => ep.category === 'lighting') ||
    /\b(lamps?|lights?|lighting|bulbs?|strips?|garlands?|backlights?|spotlights?|downlights?|sconces?|lanterns?|chandeliers?|tube\s*clocks?|nixie)\b/i.test(
      context,
    )
  ) {
    return 'lighting';
  }
  if (
    caps.has('position') ||
    /\b(blind|curtain|shade|shutter|roller|awning|cover)\b/i.test(context)
  ) {
    return 'covers';
  }
  if (caps.has('lock') || /\b(lock|deadbolt|latch)\b/i.test(context)) {
    return 'security';
  }
  if (
    /\b(bridge|gateway|router|mqtt|zigbee2mqtt|govee2mqtt)\b/i.test(context) &&
    endpoints.every((ep) =>
      ep.capabilities.every((c) => c.entityCategory === 'diagnostic' || c.kind === 'action'),
    )
  ) {
    return 'network';
  }
  if (caps.has('on_off') || caps.has('power')) {
    return 'power';
  }
  if (
    caps.has('smoke') ||
    caps.has('leak') ||
    caps.has('gas') ||
    endpoints.some((ep) => ep.category === 'safety_sensors')
  ) {
    return 'safety_sensors';
  }
  if (
    caps.has('occupancy') ||
    caps.has('motion') ||
    endpoints.some((ep) => ep.category === 'occupancy_sensors') ||
    /\b(motion|occupancy|presence)\s*sensor\b/i.test(context)
  ) {
    return 'occupancy_sensors';
  }
  if (
    caps.has('temperature') ||
    caps.has('humidity') ||
    caps.has('illuminance') ||
    endpoints.some((ep) => ep.category === 'environmental_sensors') ||
    /\b(sensor|thermometer|hygrometer)\b/i.test(context)
  ) {
    return 'environmental_sensors';
  }
  if (endpoints.some((ep) => ep.category === 'security')) {
    return 'security';
  }
  return 'generic';
}

export function endpointSortRank(ep: HausEndpoint): number {
  const cap = ep.capabilities[0];
  const entityCat = cap?.entityCategory;
  if (entityCat === 'diagnostic') return 90;
  if (entityCat === 'config') return 80;
  if (/(?:segment|zone|pixel|tube)[_\s-]*\d+|-\d+$/i.test(`${ep.id} ${ep.name}`)) return 50;
  if (cap?.id === 'video') return 0;
  if (cap?.id === 'water_heater' || cap?.id === 'climate') return 1;
  if (ep.category === 'lighting' || cap?.id === 'brightness' || ep.capabilities.length > 1)
    return 2;
  if (cap?.id === 'on_off' || cap?.id === 'power') return 10;
  if (cap?.id === 'select' || cap?.id === 'number') return 20;
  if (cap?.id === 'press') return 30;
  return 40;
}

export function sortDeviceEndpoints(endpoints: readonly HausEndpoint[]): HausEndpoint[] {
  return [...endpoints].sort(
    (a, b) => endpointSortRank(a) - endpointSortRank(b) || a.id.localeCompare(b.id),
  );
}
