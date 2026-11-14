/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { buildHaDeviceRecord } from './flow-entries';
import { configEntryIdForDevice } from './flows';
import { buildCompatAreas } from './management/hub-registry';
import { privateMediaState, redactAttributes } from './redact.js';
import {
  SENSOR_CLASSES,
  NUMERIC_SENSOR_CLASSES,
  slug,
  colorOf,
  computeFriendlyName,
  truthy,
} from './sensor-classes';
import type {
  CompatEntity,
  CompatView,
  EndpointStates,
  EntityBinding,
  HubCapability,
  HubDevice,
  HubEndpoint,
} from './types';

export { slug };

/** Which HA-style domain the legacy renderer should use for a Hub capability. */
export function domainFor(device: HubDevice, endpoint: HubEndpoint, cap: HubCapability): string {
  const caps = new Set(endpoint.capabilities.map((item) => item.id));
  const writable = cap.operations.some((op) =>
    ['set', 'turn_on', 'turn_off', 'press'].includes(op),
  );

  if (cap.id === 'climate') return 'climate';
  if (
    (cap.id === 'hvac_mode' || cap.id === 'target_temperature') &&
    device.category === 'climate'
  ) {
    return caps.has('climate') ? '' : 'climate';
  }
  if (
    ['fan_mode', 'swing_mode', 'swing_horizontal_mode', 'current_temperature'].includes(cap.id) &&
    device.category === 'climate'
  ) {
    return '';
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
  if (cap.id === 'remote' || cap.id === 'remote_key') return 'remote';
  if (device.category === 'media' && (cap.id === 'on_off' || cap.id === 'media_player'))
    return 'media_player';
  if (cap.id === 'number') return 'number';
  if (cap.kind === 'enum' && cap.deviceClass === 'enum') return 'sensor';
  if (cap.id === 'select' || cap.kind === 'enum') return 'select';
  if (cap.id === 'scene' || (cap.kind === 'action' && endpoint.id.startsWith('scene.')))
    return 'scene';
  if (cap.id === 'device_tracker' || endpoint.id.startsWith('device_tracker.'))
    return 'device_tracker';
  if (cap.id === 'update' || cap.kind === 'update') return 'update';
  if (cap.id === 'event' || cap.kind === 'event') return 'event';
  if (cap.id === 'weather' || cap.kind === 'weather') return 'weather';
  if (cap.id === 'notify' || endpoint.id.startsWith('notify.')) return 'notify';

  if (
    cap.id === 'on_off' &&
    (caps.has('brightness') || caps.has('color') || caps.has('color_temp'))
  )
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

/** Translates a Hub capability + endpoint state snapshot into HA compat state and attributes. */
export function stateFor(
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
  if (domain === 'sensor' && cap.kind === 'enum') {
    attributes.options = cap.choices ?? [];
    if (cap.deviceClass) attributes.device_class = cap.deviceClass;
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
    let features = 1;
    attributes.hvac_modes = cap.choices ?? ['off', 'heat', 'cool', 'auto'];
    attributes.min_temp = cap.minimum ?? 7;
    attributes.max_temp = cap.maximum ?? 35;
    attributes.target_temp_step = cap.step ?? 0.5;
    if (!endpointState) {
      attributes.supported_features = features;
      return { state: 'off', attributes };
    }
    const currentTemp = endpointState.temperature ?? endpointState.current_temperature;
    const targetTemp = endpointState.target_temperature ?? endpointState.temperature;
    const mode =
      endpointState.hvac_mode ??
      endpointState.mode ??
      (truthy(endpointState.on_off ?? endpointState.state) ? 'heat' : 'off');
    if (typeof currentTemp === 'number') attributes.current_temperature = currentTemp;
    if (typeof targetTemp === 'number') attributes.temperature = targetTemp;
    if (typeof endpointState.fan_mode === 'string') attributes.fan_mode = endpointState.fan_mode;
    if (Array.isArray(endpointState.fan_modes)) attributes.fan_modes = endpointState.fan_modes;
    if (attributes.fan_mode || attributes.fan_modes) features |= 8;
    if (typeof endpointState.swing_mode === 'string')
      attributes.swing_mode = endpointState.swing_mode;
    if (Array.isArray(endpointState.swing_modes))
      attributes.swing_modes = endpointState.swing_modes;
    if (attributes.swing_mode || attributes.swing_modes) features |= 32;
    attributes.supported_features = features;
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
    const val = typeof raw === 'string' && raw ? raw : options.length > 0 ? options[0]! : 'unknown';
    return { state: val, attributes };
  }

  if (domain === 'scene') {
    if (endpointState?.group_name) attributes.group_name = endpointState.group_name;
    if (endpointState?.speed !== undefined) attributes.speed = endpointState.speed;
    if (endpointState?.brightness !== undefined) attributes.brightness = endpointState.brightness;
    if (endpointState?.is_dynamic !== undefined) attributes.is_dynamic = endpointState.is_dynamic;
    return { state: typeof raw === 'string' ? raw : 'available', attributes };
  }

  if (domain === 'event') {
    if (cap.choices) attributes.event_types = cap.choices;
    if (typeof endpointState?.event_type === 'string')
      attributes.event_type = endpointState.event_type;
    return { state: typeof raw === 'string' ? raw : new Date().toISOString(), attributes };
  }

  if (domain === 'update') {
    if (endpointState?.installed_version)
      attributes.installed_version = endpointState.installed_version;
    if (endpointState?.latest_version) attributes.latest_version = endpointState.latest_version;
    if (endpointState?.title) attributes.title = endpointState.title;
    const on = truthy(endpointState?.update ?? endpointState?.on_off ?? raw);
    return { state: on ? 'on' : 'off', attributes };
  }

  if (domain === 'device_tracker') {
    if (endpointState?.source_type) attributes.source_type = endpointState.source_type;
    const isHome = raw === 'home' || raw === true;
    return { state: isHome ? 'home' : 'not_home', attributes };
  }

  if (domain === 'weather') {
    if (typeof endpointState?.temperature === 'number')
      attributes.temperature = endpointState.temperature;
    attributes.temperature_unit = '°C';
    if (typeof endpointState?.humidity === 'number') attributes.humidity = endpointState.humidity;
    if (typeof endpointState?.pressure === 'number') attributes.pressure = endpointState.pressure;
    if (typeof endpointState?.wind_speed === 'number')
      attributes.wind_speed = endpointState.wind_speed;
    if (typeof endpointState?.wind_bearing === 'number')
      attributes.wind_bearing = endpointState.wind_bearing;
    if (typeof endpointState?.visibility === 'number')
      attributes.visibility = endpointState.visibility;
    const cond =
      typeof raw === 'string' && raw
        ? raw
        : typeof endpointState?.condition === 'string'
          ? endpointState.condition
          : 'cloudy';
    return { state: cond, attributes };
  }

  if (domain === 'notify') {
    return { state: typeof raw === 'string' ? raw : 'ready', attributes };
  }

  if (domain === 'camera') {
    attributes.haus_native_camera = 1;
    attributes.supported_features = 2;
    return { state: 'idle', attributes };
  }

  if (domain === 'media_player') {
    attributes.device_class = 'tv';
    attributes.supported_features = 450487;
    if (!endpointState) return { state: 'off', attributes };
    if (Array.isArray(endpointState.source_list))
      attributes.source_list = endpointState.source_list;
    if (typeof endpointState.source === 'string') attributes.source = endpointState.source;
    if (typeof endpointState.volume === 'number')
      attributes.volume_level = endpointState.volume / 100;
    if (typeof endpointState.mute === 'boolean') attributes.is_volume_muted = endpointState.mute;
    const on = truthy(endpointState.on_off ?? endpointState.state);
    return { state: on ? 'idle' : 'off', attributes };
  }

  if (domain === 'remote') {
    attributes.supported_features = 0;
    const on = truthy(endpointState?.on_off ?? endpointState?.state);
    return { state: on === false ? 'off' : 'on', attributes };
  }

  if (domain === 'button') {
    return { state: typeof raw === 'string' && raw ? raw : 'unknown', attributes };
  }

  if (domain === 'switch' || domain === 'binary_sensor') {
    const devClass = cap.deviceClass ?? SENSOR_CLASSES[cap.id];
    if (devClass) attributes.device_class = devClass;
    if (!endpointState) {
      return {
        state: domain === 'switch' && device.protocol === 'mqtt' ? 'off' : 'unknown',
        attributes,
      };
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
    if (privateMediaState(raw)) return { state: 'unknown', attributes };
    const numMeta =
      NUMERIC_SENSOR_CLASSES[cap.id] ??
      (cap.deviceClass ? NUMERIC_SENSOR_CLASSES[cap.deviceClass] : undefined);
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

/** Builds the HA-shaped snapshot the legacy renderer consumes from Hub devices and states. */
export function buildView(
  devices: HubDevice[],
  states: EndpointStates,
  now = new Date().toISOString(),
  configEntries?: ReadonlyArray<{ entry_id?: unknown; domain?: unknown }>,
  persistedRooms?: ReadonlyArray<{ id: string; name: string; icon?: string }>,
): CompatView {
  const used = new Set<string>();
  const bindings = new Map<string, EntityBinding>();
  const entities: Record<string, unknown>[] = [];
  const entityStates: CompatEntity[] = [];
  const rooms = new Set<string>();
  for (const device of devices) {
    const isSingle = device.endpoints.length === 1 && device.endpoints[0].capabilities.length === 1;
    for (const endpoint of device.endpoints) {
      for (const cap of endpoint.capabilities) {
        const domain = domainFor(device, endpoint, cap);
        if (!domain) continue;
        if (
          domain === 'camera' &&
          device.protocol === 'mqtt' &&
          !endpoint.mediaId &&
          !endpoint.hasCameraSource &&
          cap.operations.length === 0
        ) {
          continue;
        }
        const rawDeviceSlug = domain === 'camera' ? device.id.replace(/^camera\./, '') : device.id;
        const baseSlug =
          device.protocol === 'mqtt' && device.endpoints.length > 1
            ? slug(endpoint.id.replace(/^ep_(mqtt_)?/, ''))
            : slug(rawDeviceSlug);
        let id =
          domain === 'camera' && endpoint.mediaId ? endpoint.mediaId : `${domain}.${baseSlug}`;
        for (let n = 2; used.has(id); n += 1) id = `${domain}.${baseSlug}_${n}`;
        used.add(id);
        bindings.set(id, { deviceId: device.id, endpointId: endpoint.id, capability: cap, domain });
        const endpointState = states[endpoint.id];
        const { state, attributes } = stateFor(domain, cap, endpointState, {
          ...device,
          availability: endpoint.availability ?? device.availability,
        });
        const modes = endpoint.capabilities.map((item) => item.id);
        const colorTempCap = endpoint.capabilities.find((item) => item.id === 'color_temp');
        const friendlyName = computeFriendlyName(device, endpoint, cap, isSingle);
        const hasColor = modes.includes('color');
        const hasTemp = modes.includes('color_temp');
        const supportedColorModes = cap.supportedColorModes?.length
          ? cap.supportedColorModes
          : [
              ...(hasColor ? ['rgb'] : []),
              ...(hasTemp ? ['color_temp'] : []),
              ...(!hasColor && !hasTemp
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
                  ...(colorTempCap?.minimum ? { min_color_temp_kelvin: colorTempCap.minimum } : {}),
                  ...(colorTempCap?.maximum ? { max_color_temp_kelvin: colorTempCap.maximum } : {}),
                }
              : {}),
            ...attributes,
          },
          last_changed: now,
          last_updated: now,
        });
        const isMqtt = device.protocol === 'mqtt';
        const entryId = configEntryIdForDevice(device, configEntries);
        entities.push({
          entity_id: id,
          device_id: device.id,
          area_id: null,
          name: null,
          original_name: friendlyName,
          platform: isMqtt && domain !== 'camera' ? 'mqtt' : 'haus',
          unique_id: isMqtt ? endpoint.id.replace(/^ep_(mqtt_)?/, '') : `${endpoint.id}:${cap.id}`,
          ...(entryId ? { config_entry_id: entryId } : {}),
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
    devices: devices.map((device) =>
      buildHaDeviceRecord(device, configEntryIdForDevice(device, configEntries)),
    ),
    areas: buildCompatAreas(devices, persistedRooms),
  };
}
