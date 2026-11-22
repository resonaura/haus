/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { mediaPlayerState, mergeMediaCapabilities, remoteState } from './media';
import { buildHaDeviceRecord } from './flow-entries';
import { configEntryIdForDevice } from './flows';
import { domainFor } from './management/entity-domain';
import { buildCompatAreas } from './management/hub-registry';
import { privateMediaState, redactAttributes } from './redact.js';
import {
  SENSOR_CLASSES,
  NUMERIC_SENSOR_CLASSES,
  slug,
  colorOf,
  computeFriendlyName,
  resolveLightEffectList,
  truthy,
} from './sensor-classes';
import type {
  CompatEntity,
  CompatView,
  EndpointStates,
  EntityBinding,
  HubCapability,
  HubDevice,
} from './types';

export { domainFor, slug };

/** Translates a Hub capability + endpoint state snapshot into HA compat state and attributes. */
export function stateFor(
  domain: string,
  cap: HubCapability,
  endpointState: Record<string, unknown> | undefined,
  device: HubDevice,
): { state: string; attributes: Record<string, unknown> } {
  const attributes: Record<string, unknown> = cap.deviceClass
    ? { device_class: cap.deviceClass }
    : {};
  if (cap.icon) attributes.icon = cap.icon;
  if (domain === 'sensor' && cap.displayPrecision !== undefined) {
    attributes.suggested_display_precision = cap.displayPrecision;
  }
  if (domain === 'sensor' && cap.kind === 'enum') {
    attributes.options = cap.choices ?? [];
    if (cap.deviceClass) attributes.device_class = cap.deviceClass;
  }
  if (domain === 'camera') {
    attributes.haus_native_camera = 1;
    attributes.supported_features = 2;
    if (device.bridgeProvider) attributes.haus_bridge_provider = device.bridgeProvider;
    if (device.bridgeId) attributes.haus_bridge_id = device.bridgeId;
    if (device.authExpired) attributes.haus_auth_expired = true;
  }
  if (device.availability === 'offline') return { state: 'unavailable', attributes };

  const raw = endpointState
    ? (endpointState[cap.id] ?? endpointState.state ?? endpointState.value)
    : undefined;

  if (domain === 'light') {
    const effectList = resolveLightEffectList(cap, undefined, endpointState);
    if (effectList?.length) {
      attributes.effect_list = effectList;
      attributes.supported_features = Number(attributes.supported_features ?? 0) | 4;
    }
    if (!endpointState)
      return { state: device.protocol === 'mqtt' ? 'off' : 'unknown', attributes };
    const powerVal = typeof endpointState.power === 'boolean' ? endpointState.power : undefined;
    const on = truthy(powerVal ?? endpointState.on_off ?? endpointState.state);
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
    if (typeof endpointState.effect === 'string' && endpointState.effect.length > 0) {
      attributes.effect = endpointState.effect;
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
    const parsed =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim() !== ''
          ? Number(raw)
          : Number.NaN;
    const val = Number.isFinite(parsed) ? String(parsed) : 'unknown';
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
    return mediaPlayerState(cap, endpointState, attributes, device);
  }

  if (domain === 'remote') {
    return remoteState(endpointState, attributes);
  }

  if (domain === 'button') {
    return { state: typeof raw === 'string' && raw ? raw : 'unknown', attributes };
  }

  if (domain === 'switch' || domain === 'binary_sensor') {
    const devClass = cap.deviceClass ?? SENSOR_CLASSES[cap.id];
    if (devClass) attributes.device_class = devClass;
    const cameraDevice = device.category === 'cameras';
    if (!endpointState) {
      return {
        state:
          domain === 'switch' && device.protocol === 'mqtt' && !cameraDevice ? 'off' : 'unknown',
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
    const explicitNull =
      endpointState[cap.id] === null ||
      endpointState.state === null ||
      endpointState.value === null;
    const fallback =
      domain === 'switch' && device.protocol === 'mqtt' && !explicitNull && !cameraDevice
        ? 'off'
        : 'unknown';
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
  const usedHaEntityIdentities = new Set<string>();
  const bindings = new Map<string, EntityBinding>();
  const entities: Record<string, unknown>[] = [];
  const entityStates: CompatEntity[] = [];
  for (const device of devices) {
    const isSingle = device.endpoints.length === 1 && device.endpoints[0].capabilities.length === 1;
    for (const endpoint of device.endpoints) {
      let emittedMedia = false;
      for (const cap of endpoint.capabilities) {
        const domain = domainFor(device, endpoint, cap);
        if (!domain) continue;
        if (domain === 'media_player' && endpoint.haIdentity?.domain === domain) {
          if (emittedMedia) continue;
          emittedMedia = true;
        }
        if (
          domain === 'camera' &&
          ((device.protocol === 'mqtt' &&
            !endpoint.mediaId &&
            !endpoint.hasCameraSource &&
            cap.operations.length === 0) ||
            (device.id.startsWith('tuya:') && !endpoint.mediaId))
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
        const mergedEffects =
          domain === 'light' ? resolveLightEffectList(cap, endpoint) : undefined;
        const stateCapability =
          domain === 'media_player'
            ? mergeMediaCapabilities(endpoint, cap)
            : mergedEffects?.length
              ? { ...cap, effectList: mergedEffects }
              : cap;
        const { state, attributes } = stateFor(domain, stateCapability, endpointState, {
          ...device,
          availability: endpoint.availability ?? device.availability,
        });
        const modes = endpoint.capabilities.map((item) => item.id);
        const colorTempCap = endpoint.capabilities.find((item) => item.id === 'color_temp');
        const friendlyName = computeFriendlyName(device, endpoint, cap, isSingle);
        const identityKey = JSON.stringify([device.id, endpoint.id]);
        const haIdentity =
          endpoint.haIdentity?.domain === domain && !usedHaEntityIdentities.has(identityKey)
            ? endpoint.haIdentity
            : undefined;
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
        const lightRole =
          domain === 'light'
            ? device.segmentLightEndpoints?.includes(endpoint.id)
              ? 'segment'
              : device.independentLightEndpoints?.includes(endpoint.id)
                ? 'independent'
                : undefined
            : undefined;
        const outletRole =
          domain === 'switch' && device.powerStrip
            ? device.powerStrip.masterEndpointId === endpoint.id
              ? 'master'
              : device.powerStrip.outletEndpointIds.includes(endpoint.id)
                ? 'outlet'
                : undefined
            : undefined;
        entityStates.push({
          entity_id: id,
          state,
          attributes: {
            ...(device.protocol === 'mqtt' ? redactAttributes(endpointState?.attributes) : {}),
            friendly_name: friendlyName,
            ...(device.deviceType ? { haus_device_type: device.deviceType } : {}),
            ...(device.managementUrl ? { haus_management_url: device.managementUrl } : {}),
            ...(outletRole ? { haus_outlet_role: outletRole } : {}),
            ...(device.serviceDevice ? { haus_service_device: true } : {}),
            ...(domain === 'light'
              ? {
                  ...(lightRole ? { haus_light_role: lightRole } : {}),
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
        const epHausId =
          endpoint.address &&
          (endpoint.capabilities.length === 1 || endpoint.address.startsWith(`${domain}::`))
            ? endpoint.address
            : undefined;
        entities.push({
          entity_id: id,
          ...(epHausId ? { haus_id: epHausId } : {}),
          device_id: device.id,
          area_id: null,
          name: null,
          original_name: friendlyName,
          platform:
            haIdentity?.platform ??
            (device.id.startsWith('net:')
              ? 'generic_network'
              : isMqtt && domain !== 'camera'
                ? 'mqtt'
                : 'haus'),
          unique_id:
            haIdentity?.uniqueId ??
            (isMqtt ? endpoint.id.replace(/^ep_(mqtt_)?/, '') : `${endpoint.id}:${cap.id}`),
          ...(entryId ? { config_entry_id: entryId } : {}),
          ...(cap.entityCategory ? { entity_category: cap.entityCategory } : {}),
        });
        if (haIdentity) usedHaEntityIdentities.add(identityKey);
      }
    }
  }
  return {
    states: entityStates,
    bindings,
    entities,
    devices: devices
      .filter((device) => !(device.id.startsWith('tuya:') && device.category === 'cameras'))
      .map((device) => buildHaDeviceRecord(device, configEntryIdForDevice(device, configEntries))),
    areas: buildCompatAreas(devices, persistedRooms),
  };
}
