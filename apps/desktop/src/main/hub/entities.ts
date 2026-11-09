/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { configEntryIdForDevice } from './flows';
import { redactAttributes } from './redact.js';
import type {
  CompatEntity,
  CompatView,
  EndpointStates,
  EntityBinding,
  HubCapability,
  HubDevice,
  HubEndpoint,
} from './types';

const SENSOR_CLASSES: Record<string, string> = {
  leak: 'moisture',
  moisture: 'moisture',
  contact: 'opening',
  door: 'door',
  window: 'window',
  opening: 'opening',
  garage_door: 'garage_door',
  motion: 'motion',
  vibration: 'vibration',
  smoke: 'smoke',
  gas: 'gas',
  carbon_monoxide: 'carbon_monoxide',
  safety: 'safety',
  tamper: 'tamper',
  presence: 'presence',
  occupancy: 'occupancy',
  problem: 'problem',
  battery_low: 'battery_low',
  connectivity: 'connectivity',
};

const NUMERIC_SENSOR_CLASSES: Record<string, { device_class: string; unit?: string }> = {
  temperature: { device_class: 'temperature', unit: '°C' },
  humidity: { device_class: 'humidity', unit: '%' },
  battery: { device_class: 'battery', unit: '%' },
  power: { device_class: 'power', unit: 'W' },
  energy: { device_class: 'energy', unit: 'kWh' },
  voltage: { device_class: 'voltage', unit: 'V' },
  current: { device_class: 'current', unit: 'A' },
  illuminance: { device_class: 'illuminance', unit: 'lx' },
  pressure: { device_class: 'pressure', unit: 'hPa' },
  signal_strength: { device_class: 'signal_strength', unit: 'dBm' },
  carbon_dioxide: { device_class: 'carbon_dioxide', unit: 'ppm' },
  pm25: { device_class: 'pm25', unit: 'µg/m³' },
  pm10: { device_class: 'pm10', unit: 'µg/m³' },
  duration: { device_class: 'duration', unit: 'min' },
};

export function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'device'
  );
}

/** Which HA-style domain the legacy renderer should use for a Hub capability. */
export function domainFor(device: HubDevice, endpoint: HubEndpoint, cap: HubCapability): string {
  const caps = new Set(endpoint.capabilities.map((item) => item.id));
  const writable = cap.operations.some((op) =>
    ['set', 'turn_on', 'turn_off', 'press'].includes(op),
  );

  if (
    cap.id === 'climate' ||
    cap.id === 'hvac_mode' ||
    (cap.id === 'target_temperature' && device.category === 'climate')
  ) {
    return 'climate';
  }
  if (
    cap.id === 'water_heater' ||
    (cap.id === 'target_temperature' && device.category === 'appliances')
  ) {
    return 'water_heater';
  }
  if (
    ['position', 'tilt', 'cover'].includes(cap.id) &&
    (writable || device.category === 'covers')
  ) {
    return 'cover';
  }
  if (cap.id === 'lock' || cap.id === 'lock_state') return 'lock';
  if (cap.id === 'fan' || cap.id === 'fan_speed') return 'fan';
  if (cap.id === 'number') return 'number';
  if (cap.id === 'select' || cap.kind === 'enum') return 'select';

  if (cap.id === 'on_off' && (caps.has('brightness') || caps.has('color') || caps.has('color_temp')))
    return 'light';
  if (cap.id === 'on_off') return device.category === 'lighting' ? 'light' : 'switch';
  if (cap.id in SENSOR_CLASSES) return 'binary_sensor';
  if (cap.id === 'video') return 'camera';
  if (cap.id === 'press' || cap.kind === 'action') return 'button';
  if (cap.kind === 'binary') return writable ? 'switch' : 'binary_sensor';
  if (cap.kind === 'numeric' || cap.kind === 'string') {
    if (['brightness', 'color', 'color_temp', 'effect'].includes(cap.id) && caps.has('on_off'))
      return '';
    return 'sensor';
  }
  return '';
}

const truthy = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (['on', 'true', 'open', 'detected', 'wet', 'heat', 'electric', 'performance'].includes(lower))
      return true;
    if (['off', 'false', 'closed', 'clear', 'dry'].includes(lower)) return false;
  }
  if (typeof value === 'number') return value !== 0;
  return undefined;
};

function colorOf(value: unknown): [number, number, number] | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { r, g, b } = value as Record<string, unknown>;
  return [r, g, b].every((item) => typeof item === 'number')
    ? [r as number, g as number, b as number]
    : undefined;
}

function stateFor(
  domain: string,
  cap: HubCapability,
  endpointState: Record<string, unknown> | undefined,
  device: HubDevice,
): { state: string; attributes: Record<string, unknown> } {
  const attributes: Record<string, unknown> = {};
  if (cap.icon) attributes.icon = cap.icon;
  if (domain === 'sensor' && cap.displayPrecision !== undefined) {
    attributes.suggested_display_precision = cap.displayPrecision;
  }
  if (device.availability === 'offline') return { state: 'unavailable', attributes };

  const raw = endpointState
    ? (endpointState[cap.id] ?? endpointState.state ?? endpointState.value)
    : undefined;

  if (domain === 'light') {
    if (!endpointState) {
      return { state: device.protocol === 'mqtt' ? 'off' : 'unknown', attributes };
    }
    const on = truthy(endpointState.on_off ?? endpointState.state);
    const rgb = colorOf(endpointState.color);
    if (typeof endpointState.brightness === 'number') {
      attributes.brightness = Math.round(endpointState.brightness);
    }
    if (rgb) {
      attributes.rgb_color = rgb;
      attributes.color_mode = 'rgb';
    }
    if (Array.isArray(endpointState.hs_color) && endpointState.hs_color.length === 2) {
      attributes.hs_color = endpointState.hs_color;
    }
    if (typeof endpointState.color_temp_kelvin === 'number') {
      attributes.color_temp_kelvin = endpointState.color_temp_kelvin;
      if (!rgb) attributes.color_mode = 'color_temp';
    }
    if (typeof endpointState.effect === 'string') {
      attributes.effect = endpointState.effect;
    }
    if (cap.effectList?.length) {
      attributes.effect_list = cap.effectList;
    }
    const fallbackState = device.protocol === 'mqtt' ? 'off' : 'unknown';
    return { state: on === undefined ? fallbackState : on ? 'on' : 'off', attributes };
  }

  if (domain === 'climate') {
    attributes.supported_features = 1;
    attributes.hvac_modes = cap.choices ?? ['off', 'heat', 'cool', 'auto'];
    attributes.min_temp = cap.minimum ?? 7;
    attributes.max_temp = cap.maximum ?? 35;
    attributes.target_temp_step = cap.step ?? 0.5;
    if (!endpointState) return { state: 'off', attributes };
    const currentTemp = endpointState.temperature ?? endpointState.current_temperature;
    const targetTemp = endpointState.target_temperature ?? endpointState.temperature;
    const mode =
      endpointState.hvac_mode ??
      endpointState.mode ??
      (truthy(endpointState.on_off ?? endpointState.state) ? 'heat' : 'off');
    if (typeof currentTemp === 'number') attributes.current_temperature = currentTemp;
    if (typeof targetTemp === 'number') attributes.temperature = targetTemp;
    return { state: typeof mode === 'string' ? mode : 'off', attributes };
  }

  if (domain === 'water_heater') {
    const modes = cap.choices ?? ['off', 'electric', 'performance'];
    attributes.supported_features = 3;
    attributes.operation_list = modes;
    attributes.min_temp = cap.minimum ?? 40;
    attributes.max_temp = cap.maximum ?? 99;
    attributes.target_temp_step = cap.step ?? 1;
    attributes.icon = cap.icon ?? 'mdi:kettle-steam-outline';
    if (!endpointState) {
      attributes.operation_mode = 'off';
      return { state: 'off', attributes };
    }
    const currentTemp = endpointState.current_temperature ?? endpointState.temperature;
    const targetTemp = endpointState.target_temperature ?? endpointState.temperature;
    if (typeof currentTemp === 'number') attributes.current_temperature = currentTemp;
    if (typeof targetTemp === 'number') attributes.temperature = targetTemp;
    if (typeof endpointState.activity === 'string') attributes.activity = endpointState.activity;
    const explicitMode =
      typeof endpointState.operation_mode === 'string'
        ? endpointState.operation_mode
        : typeof endpointState.mode === 'string'
          ? endpointState.mode
          : undefined;
    const on = truthy(endpointState.on_off ?? endpointState.state);
    const mode = explicitMode ?? (on ? 'electric' : 'off');
    attributes.operation_mode = mode;
    return { state: mode, attributes };
  }

  if (domain === 'cover') {
    attributes.supported_features = 15;
    if (!endpointState) return { state: 'unknown', attributes };
    const position = endpointState.position ?? endpointState.current_position;
    if (typeof position === 'number') {
      attributes.current_position = position;
      return { state: position > 0 ? 'open' : 'closed', attributes };
    }
    const stateStr = String(raw ?? 'closed').toLowerCase();
    return { state: stateStr === 'open' ? 'open' : 'closed', attributes };
  }

  if (domain === 'lock') {
    if (!endpointState) return { state: 'unknown', attributes };
    const locked = truthy(raw) ?? raw === 'locked';
    return { state: locked ? 'locked' : 'unlocked', attributes };
  }

  if (domain === 'fan') {
    attributes.supported_features = 1;
    if (!endpointState) return { state: 'off', attributes };
    const on = truthy(endpointState.on_off ?? endpointState.state);
    if (typeof endpointState.percentage === 'number') {
      attributes.percentage = endpointState.percentage;
    }
    return { state: on ? 'on' : 'off', attributes };
  }

  if (domain === 'number') {
    attributes.min = cap.minimum ?? 0;
    attributes.max = cap.maximum ?? 100;
    attributes.step = cap.step ?? 1;
    attributes.mode = 'slider';
    if (cap.unit) attributes.unit_of_measurement = cap.unit;
    if (cap.deviceClass) attributes.device_class = cap.deviceClass;
    const val = raw !== undefined && raw !== null ? String(raw) : String(cap.minimum ?? 0);
    return { state: val, attributes };
  }

  if (domain === 'select') {
    const options = cap.choices ?? [];
    attributes.options = options;
    if (cap.deviceClass) attributes.device_class = cap.deviceClass;
    const val =
      typeof raw === 'string' && raw
        ? raw
        : options.length > 0
          ? options[0]!
          : 'unknown';
    return { state: val, attributes };
  }

  if (domain === 'camera') {
    attributes.haus_native_camera = 1;
    attributes.supported_features = 2;
    return { state: 'idle', attributes };
  }

  if (domain === 'button') {
    return { state: typeof raw === 'string' && raw ? raw : 'unknown', attributes };
  }

  if (domain === 'switch' || domain === 'binary_sensor') {
    const devClass = cap.deviceClass ?? SENSOR_CLASSES[cap.id];
    if (devClass) attributes.device_class = devClass;
    if (!endpointState) {
      return { state: domain === 'switch' && device.protocol === 'mqtt' ? 'off' : 'unknown', attributes };
    }
    let on: boolean | undefined;
    if (cap.id === 'contact') {
      // In Zigbee/HomeKit/Matter, boolean `contact: true` means magnet contact is made (CLOSED),
      // whereas in HA `binary_sensor` (`device_class: door`), `'on'` means OPEN and `'off'` means CLOSED.
      if (typeof endpointState.state === 'string') {
        on = truthy(endpointState.state);
      } else if (typeof raw === 'boolean') {
        on = !raw;
      } else {
        on = truthy(raw);
      }
    } else {
      on = truthy(raw);
    }
    const fallback = domain === 'switch' && device.protocol === 'mqtt' ? 'off' : 'unknown';
    return { state: on === undefined ? fallback : on ? 'on' : 'off', attributes };
  }

  if (domain === 'sensor') {
    const numMeta = NUMERIC_SENSOR_CLASSES[cap.id] ?? (cap.deviceClass ? NUMERIC_SENSOR_CLASSES[cap.deviceClass] : undefined);
    if (numMeta) {
      attributes.device_class = cap.deviceClass ?? numMeta.device_class;
      attributes.unit_of_measurement =
        (typeof endpointState?.unit === 'string' ? endpointState.unit : undefined) ??
        cap.unit ??
        numMeta.unit;
    } else {
      if (cap.deviceClass) attributes.device_class = cap.deviceClass;
      if (typeof endpointState?.unit === 'string') {
        attributes.unit_of_measurement = endpointState.unit;
      } else if (cap.unit) {
        attributes.unit_of_measurement = cap.unit;
      }
    }
    return { state: raw === undefined || raw === null ? 'unknown' : String(raw), attributes };
  }

  return { state: 'unknown', attributes };
}

function computeFriendlyName(
  device: HubDevice,
  endpoint: HubEndpoint,
  cap: HubCapability,
  isSingle: boolean,
): string {
  if (isSingle) return device.name;
  const epName = endpoint.name?.trim();
  let base = device.name;
  if (epName && epName !== device.name) {
    base = epName.toLowerCase().startsWith(device.name.toLowerCase())
      ? epName
      : `${device.name} ${epName}`;
  }
  const primaryCaps = endpoint.capabilities.filter(
    (c) => !c.entityCategory && c.id !== 'battery' && c.id !== 'linkquality',
  );
  const isOnlyPrimaryCap =
    primaryCaps.length === 1 && primaryCaps[0]?.id === cap.id;

  if (
    endpoint.capabilities.length > 1 &&
    !isOnlyPrimaryCap &&
    !['on_off', 'water_heater', 'climate', 'video'].includes(cap.id)
  ) {
    const capLabel = cap.name ?? cap.id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    if (base.toLowerCase().includes(capLabel.toLowerCase())) {
      return base;
    }
    return `${base} ${capLabel}`;
  }
  return base;
}

/** Builds the HA-shaped snapshot the legacy renderer consumes from Hub devices and states. */
export function buildView(
  devices: HubDevice[],
  states: EndpointStates,
  now = new Date().toISOString(),
): CompatView {
  const used = new Set<string>();
  const bindings = new Map<string, EntityBinding>();
  const entities: Record<string, unknown>[] = [];
  const entityStates: CompatEntity[] = [];
  const rooms = new Set<string>();
  for (const device of devices) {
    const isSingle =
      device.endpoints.length === 1 && device.endpoints[0].capabilities.length === 1;
    for (const endpoint of device.endpoints) {
      for (const cap of endpoint.capabilities) {
        const domain = domainFor(device, endpoint, cap);
        if (!domain) continue;
        const baseSlug =
          device.protocol === 'mqtt' && device.endpoints.length > 1
            ? slug(endpoint.id.replace(/^ep_(mqtt_)?/, ''))
            : slug(device.id);
        let id = `${domain}.${baseSlug}`;
        for (let n = 2; used.has(id); n += 1) id = `${domain}.${baseSlug}_${n}`;
        used.add(id);
        bindings.set(id, { deviceId: device.id, endpointId: endpoint.id, capability: cap, domain });
        const endpointState = states[endpoint.id];
        const { state, attributes } = stateFor(domain, cap, endpointState, device);
        const modes = endpoint.capabilities.map((item) => item.id);
        const colorTempCap = endpoint.capabilities.find((item) => item.id === 'color_temp');
        const friendlyName = computeFriendlyName(device, endpoint, cap, isSingle);
        const supportedColorModes =
          cap.supportedColorModes?.length
            ? cap.supportedColorModes
            : [
                ...(modes.includes('color') ? ['rgb'] : []),
                ...(modes.includes('color_temp') ? ['color_temp'] : []),
                ...(!modes.includes('color') && !modes.includes('color_temp')
                  ? [modes.includes('brightness') ? 'brightness' : 'onoff']
                  : []),
              ];
        entityStates.push({
          entity_id: id,
          state,
          attributes: {
            ...(device.protocol === 'mqtt' ? redactAttributes(endpointState?.attributes) : {}),
            friendly_name: friendlyName,
            ...(domain === 'light'
              ? {
                  supported_color_modes: supportedColorModes,
                  ...(colorTempCap?.minimum
                    ? { min_color_temp_kelvin: colorTempCap.minimum }
                    : {}),
                  ...(colorTempCap?.maximum
                    ? { max_color_temp_kelvin: colorTempCap.maximum }
                    : {}),
                }
              : {}),
            ...attributes,
          },
          last_changed: now,
          last_updated: now,
        });
        const isMqtt = device.protocol === 'mqtt';
        entities.push({
          entity_id: id,
          device_id: device.id,
          area_id: null,
          name: null,
          original_name: friendlyName,
          platform: isMqtt && domain !== 'camera' ? 'mqtt' : 'haus',
          unique_id: isMqtt ? endpoint.id.replace(/^ep_(mqtt_)?/, '') : `${endpoint.id}:${cap.id}`,
          ...(cap.entityCategory ? { entity_category: cap.entityCategory } : {}),
        });
      }
    }
    if (device.roomId && device.roomId !== 'unassigned') rooms.add(device.roomId);
  }
  return {
    states: entityStates,
    bindings,
    entities,
    devices: devices.map((device) => {
      const entryId = configEntryIdForDevice(device);
      return {
        id: device.id,
        name: device.name,
        name_by_user: null,
        area_id: device.roomId && device.roomId !== 'unassigned' ? device.roomId : null,
        manufacturer: device.manufacturer ?? null,
        model: device.model ?? null,
        category: device.category ?? null,
        ...(entryId ? { config_entries: [entryId] } : {}),
      };
    }),
    areas: [...rooms].map((room) => ({
      area_id: room,
      name: room.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    })),
  };
}
