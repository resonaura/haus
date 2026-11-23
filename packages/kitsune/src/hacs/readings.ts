/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import type { Json, Reading } from '@haus/core/types';
import { miredsToKelvin, normalizeHsv, rgbToHs } from '@haus/core/device';
import { safeMediaLabel } from './media.js';
import { binarySensorId } from './classification.js';

export function makeReading(value: Json): Reading {
  return {
    value,
    freshness: 'live',
    observedAt: new Date().toISOString(),
  };
}

export function parseReadings(
  domain: string,
  state: string | number | boolean | null,
  attributes: Record<string, unknown>,
): Record<string, Reading> {
  const readings: Record<string, Reading> = {};
  if (state === null || state === undefined || state === 'unavailable' || state === 'unknown') {
    return readings;
  }

  if (
    domain === 'light' ||
    domain === 'switch' ||
    domain === 'outlet' ||
    domain === 'input_boolean'
  ) {
    readings.on_off = makeReading(state === 'on' || state === true);
    if (typeof attributes.brightness === 'number') {
      readings.brightness = makeReading(Math.round((attributes.brightness / 255) * 100));
    }
    if (typeof attributes.effect === 'string') {
      readings.effect = makeReading(attributes.effect);
    } else if (attributes.effect === null || Array.isArray(attributes.effect_list)) {
      readings.effect = makeReading(null);
    }
    if (Array.isArray(attributes.effect_list)) {
      readings.effect_list = makeReading(attributes.effect_list as Json);
    }
    if (typeof attributes.color_temp_kelvin === 'number') {
      readings.color_temp = makeReading(attributes.color_temp_kelvin);
    } else if (typeof attributes.color_temp === 'number') {
      readings.color_temp = makeReading(miredsToKelvin(attributes.color_temp));
    }
    if (Array.isArray(attributes.hs_color) && attributes.hs_color.length >= 2) {
      const bri =
        typeof attributes.brightness === 'number'
          ? Math.round((attributes.brightness / 255) * 100)
          : 100;
      readings.color_hsv = makeReading(
        normalizeHsv(Number(attributes.hs_color[0]), Number(attributes.hs_color[1]), bri),
      );
    } else if (Array.isArray(attributes.rgb_color) && attributes.rgb_color.length >= 3) {
      const hs = rgbToHs(
        Number(attributes.rgb_color[0]),
        Number(attributes.rgb_color[1]),
        Number(attributes.rgb_color[2]),
      );
      const bri =
        typeof attributes.brightness === 'number'
          ? Math.round((attributes.brightness / 255) * 100)
          : 100;
      readings.color_hsv = makeReading(normalizeHsv(hs.h, hs.s, bri));
    }
    if (typeof attributes.guest_network_name === 'string') {
      readings.guest_network_name = makeReading(attributes.guest_network_name);
    }
    if (typeof attributes.connected_guest_clients === 'number') {
      readings.connected_guest_clients = makeReading(attributes.connected_guest_clients);
    }
    if (typeof attributes.domain === 'string') {
      readings.domain = makeReading(attributes.domain);
    }
  } else if (domain === 'media_player') {
    const mediaState = String(state);
    readings.media_playback = makeReading(mediaState);
    readings.state = makeReading(mediaState);
    if (['playing', 'paused', 'idle', 'buffering', 'on'].includes(mediaState)) {
      readings.on_off = makeReading(true);
    } else if (['off', 'standby'].includes(mediaState)) {
      readings.on_off = makeReading(false);
    }
    for (const key of ['media_title', 'media_artist', 'media_album_name', 'app_name', 'source']) {
      const value = safeMediaLabel(attributes[key]);
      if (value !== undefined) readings[key] = makeReading(value);
    }
    if (Array.isArray(attributes.source_list)) {
      readings.source_list = makeReading(
        attributes.source_list
          .map(safeMediaLabel)
          .filter((source): source is string => source !== undefined),
      );
    }
    if (typeof attributes.volume_level === 'number' && Number.isFinite(attributes.volume_level)) {
      readings.volume = makeReading(
        Math.round(Math.max(0, Math.min(1, attributes.volume_level)) * 100),
      );
    }
    if (typeof attributes.is_volume_muted === 'boolean') {
      readings.mute = makeReading(attributes.is_volume_muted);
    }
    if (typeof attributes.media_duration === 'number') {
      readings.duration = makeReading(attributes.media_duration);
    }
    if (typeof attributes.media_position === 'number') {
      readings.position = makeReading(attributes.media_position);
    }
  } else if (domain === 'remote') {
    readings.remote = makeReading(String(state));
    if (state === 'on' || state === 'off') readings.on_off = makeReading(state === 'on');
  } else if (domain === 'fan') {
    readings.on_off = makeReading(state === 'on' || state === true);
    if (typeof attributes.percentage === 'number') {
      readings.fan_speed = makeReading(attributes.percentage);
      readings.percentage = makeReading(attributes.percentage);
    }
    if (typeof attributes.preset_mode === 'string') {
      readings.preset_mode = makeReading(attributes.preset_mode);
    }
    if (typeof attributes.oscillating === 'boolean') {
      readings.oscillating = makeReading(attributes.oscillating);
    }
    if (typeof attributes.direction === 'string') {
      readings.direction = makeReading(attributes.direction);
    }
  } else if (domain === 'humidifier') {
    readings.on_off = makeReading(state === 'on' || state === true);
    if (typeof attributes.target_humidity === 'number') {
      readings.target_humidity = makeReading(attributes.target_humidity);
    } else if (typeof attributes.humidity === 'number') {
      readings.target_humidity = makeReading(attributes.humidity);
    }
    if (typeof attributes.current_humidity === 'number') {
      readings.humidity = makeReading(attributes.current_humidity);
    }
    if (typeof attributes.mode === 'string') {
      readings.mode = makeReading(attributes.mode);
    }
  } else if (domain === 'climate') {
    const mode = typeof state === 'string' ? state : 'off';
    readings.hvac_mode = makeReading(mode);
    readings.mode = makeReading(mode);
    readings.on_off = makeReading(mode !== 'off');

    if (typeof attributes.current_temperature === 'number') {
      readings.current_temperature = makeReading(attributes.current_temperature);
      readings.temperature = makeReading(attributes.current_temperature);
    }
    if (typeof attributes.temperature === 'number') {
      readings.target_temperature = makeReading(attributes.temperature);
    }
    if (typeof attributes.fan_mode === 'string') {
      readings.fan_mode = makeReading(attributes.fan_mode);
    }
    if (Array.isArray(attributes.fan_modes)) {
      readings.fan_modes = makeReading(attributes.fan_modes as Json);
    }
    if (typeof attributes.swing_mode === 'string') {
      readings.swing_mode = makeReading(attributes.swing_mode);
    }
    if (Array.isArray(attributes.swing_modes)) {
      readings.swing_modes = makeReading(attributes.swing_modes as Json);
    }
    if (typeof attributes.swing_horizontal_mode === 'string') {
      readings.swing_horizontal_mode = makeReading(attributes.swing_horizontal_mode);
    }
    if (Array.isArray(attributes.swing_horizontal_modes)) {
      readings.swing_horizontal_modes = makeReading(attributes.swing_horizontal_modes as Json);
    }
  } else if (domain === 'sensor') {
    const num = typeof state === 'number' ? state : parseFloat(String(state));
    if (!Number.isNaN(num)) {
      if (
        attributes.device_class === 'carbon_dioxide' ||
        attributes.unit_of_measurement === 'ppm'
      ) {
        readings.co2 = makeReading(num);
      } else if (
        attributes.unit_of_measurement === 'ppb' ||
        String(attributes.friendly_name ?? '')
          .toLowerCase()
          .includes('tvoc')
      ) {
        readings.tvoc = makeReading(num);
      } else if (
        attributes.device_class === 'weight' ||
        attributes.unit_of_measurement === 'kg' ||
        attributes.unit_of_measurement === 'lbs'
      ) {
        readings.weight = makeReading(num);
        readings.value = makeReading(num);
      } else if (
        attributes.unit_of_measurement === 'Ω' ||
        attributes.unit_of_measurement === 'ohm'
      ) {
        readings.impedance = makeReading(num);
        readings.value = makeReading(num);
      } else if (
        attributes.device_class === 'signal_strength' ||
        attributes.unit_of_measurement === 'dBm'
      ) {
        readings.signal_strength = makeReading(num);
        readings.value = makeReading(num);
      } else if (
        attributes.device_class === 'data_rate' ||
        attributes.unit_of_measurement === 'Mbit/s' ||
        attributes.unit_of_measurement === 'MB/s' ||
        attributes.unit_of_measurement === 'kB/s'
      ) {
        readings.data_rate = makeReading(num);
        readings.value = makeReading(num);
      } else if (
        attributes.device_class === 'data_size' ||
        attributes.unit_of_measurement === 'GiB' ||
        attributes.unit_of_measurement === 'GB' ||
        attributes.unit_of_measurement === 'MB'
      ) {
        readings.data_size = makeReading(num);
        readings.value = makeReading(num);
      } else if (
        attributes.device_class === 'duration' ||
        attributes.unit_of_measurement === 'ms' ||
        attributes.unit_of_measurement === 's'
      ) {
        readings.duration = makeReading(num);
        readings.value = makeReading(num);
      } else if (
        attributes.device_class === 'temperature' ||
        attributes.unit_of_measurement === '°C' ||
        attributes.unit_of_measurement === '°F' ||
        attributes.unit_of_measurement === 'K'
      ) {
        readings.temperature = makeReading(num);
        readings.value = makeReading(num);
      } else if (attributes.device_class === 'humidity') {
        readings.humidity = makeReading(num);
        readings.value = makeReading(num);
      } else if (
        attributes.device_class === 'pressure' ||
        attributes.unit_of_measurement === 'hPa' ||
        attributes.unit_of_measurement === 'mbar'
      ) {
        readings.pressure = makeReading(num);
        readings.value = makeReading(num);
      } else if (
        attributes.device_class === 'wind_speed' ||
        attributes.unit_of_measurement === 'km/h' ||
        attributes.unit_of_measurement === 'm/s' ||
        attributes.unit_of_measurement === 'mph'
      ) {
        readings.wind_speed = makeReading(num);
        readings.value = makeReading(num);
      } else {
        readings.value = makeReading(num);
      }
    } else {
      readings.value = makeReading(String(state));
      readings.timestamp = makeReading(String(state));
    }
    if (Array.isArray(attributes.clients)) {
      const clientNames = attributes.clients.filter(
        (item): item is string => typeof item === 'string',
      );
      if (clientNames.length > 0) readings.clients = makeReading(clientNames);
    }
    if (typeof attributes.mac_address === 'string') {
      readings.mac_address = makeReading(attributes.mac_address);
    }
    if (typeof attributes.subnet_mask === 'string') {
      readings.subnet_mask = makeReading(attributes.subnet_mask);
    }
    if (typeof attributes.last_updated === 'string') {
      readings.last_updated = makeReading(attributes.last_updated);
    }
  } else if (domain === 'binary_sensor') {
    const isTrue = state === 'on' || state === true;
    const id = binarySensorId(attributes.device_class);
    readings[id] = makeReading(id === 'contact' ? !isTrue : isTrue);
    readings.on_off = makeReading(isTrue);
  } else if (domain === 'lock') {
    readings.lock = makeReading(state === 'locked' ? 'locked' : 'unlocked');
  } else if (domain === 'alarm_control_panel') {
    readings.alarm_state = makeReading(String(state));
    readings.state = makeReading(String(state));
  } else if (domain === 'cover' || domain === 'valve') {
    if (domain === 'valve') {
      readings.on_off = makeReading(state === 'open' || state === 'opening' || state === true);
    }
    if (typeof attributes.current_position === 'number') {
      readings.cover = makeReading(attributes.current_position);
    } else {
      readings.cover = makeReading(state === 'open' || state === true ? 100 : 0);
    }
  } else if (domain === 'number' || domain === 'input_number') {
    const num = typeof state === 'number' ? state : parseFloat(String(state));
    if (!Number.isNaN(num)) {
      readings.number = makeReading(num);
      readings.value = makeReading(num);
    }
  } else if (domain === 'text' || domain === 'input_text') {
    readings.text = makeReading(String(state ?? ''));
    readings.value = makeReading(String(state ?? ''));
  } else if (domain === 'camera') {
    readings.camera = makeReading(String(state));
    readings.state = makeReading(String(state));
    readings.on_off = makeReading(state !== 'off');
  } else if (domain === 'button' || domain === 'input_button') {
    readings.press = makeReading(String(state));
  } else if (domain === 'scene') {
    readings.state = makeReading(typeof state === 'string' ? state : 'available');
    if (typeof attributes.group_name === 'string') {
      readings.group_name = makeReading(attributes.group_name);
    }
    if (typeof attributes.speed === 'number') {
      readings.speed = makeReading(attributes.speed);
    }
    if (typeof attributes.brightness === 'number') {
      readings.brightness = makeReading(attributes.brightness);
    }
    if (typeof attributes.is_dynamic === 'boolean') {
      readings.is_dynamic = makeReading(attributes.is_dynamic);
    }
  } else if (domain === 'event') {
    readings.event = makeReading(
      typeof state === 'string' ? state : String(attributes.event_type ?? 'press'),
    );
    if (typeof attributes.event_type === 'string') {
      readings.event_type = makeReading(attributes.event_type);
    }
  } else if (domain === 'select' || domain === 'input_select') {
    readings.select = makeReading(String(state ?? ''));
    readings.value = makeReading(String(state ?? ''));
    if (Array.isArray(attributes.options)) {
      readings.options = makeReading(attributes.options as Json);
    }
  } else if (domain === 'update') {
    const isUpdateAvailable = state === 'on' || state === true;
    readings.update = makeReading(isUpdateAvailable);
    readings.on_off = makeReading(isUpdateAvailable);
    if (typeof attributes.installed_version === 'string') {
      readings.installed_version = makeReading(attributes.installed_version);
    }
    if (typeof attributes.latest_version === 'string') {
      readings.latest_version = makeReading(attributes.latest_version);
    }
    if (typeof attributes.skipped_version === 'string' || attributes.skipped_version === null) {
      readings.skipped_version = makeReading(attributes.skipped_version);
    }
    if (typeof attributes.title === 'string') {
      readings.title = makeReading(attributes.title);
    }
    if (typeof attributes.in_progress === 'boolean' || typeof attributes.in_progress === 'number') {
      readings.in_progress = makeReading(attributes.in_progress);
    }
    if (typeof attributes.update_percentage === 'number' || attributes.update_percentage === null) {
      readings.update_percentage = makeReading(attributes.update_percentage);
    }
    if (typeof attributes.auto_update === 'boolean') {
      readings.auto_update = makeReading(attributes.auto_update);
    }
    if (typeof attributes.release_summary === 'string') {
      readings.release_summary = makeReading(attributes.release_summary);
    }
    if (typeof attributes.release_url === 'string') {
      readings.release_url = makeReading(attributes.release_url);
    }
    if (typeof attributes.supported_features === 'number') {
      readings.supported_features = makeReading(attributes.supported_features);
    }
    if (typeof attributes.entity_picture === 'string') {
      readings.entity_picture = makeReading(attributes.entity_picture);
    }
  } else if (domain === 'device_tracker') {
    const isHome = state === 'home';
    readings.device_tracker = makeReading(String(state ?? 'unknown'));
    readings.presence = makeReading(String(state ?? 'unknown'));
    readings.contact = makeReading(isHome);
    if (typeof attributes.source_type === 'string') {
      readings.source_type = makeReading(attributes.source_type);
    }
  } else if (domain === 'image') {
    readings.image = makeReading(String(state ?? ''));
    if (typeof attributes.entity_picture === 'string') {
      readings.entity_picture = makeReading(attributes.entity_picture);
    }
    if (typeof attributes.content_type === 'string') {
      readings.content_type = makeReading(attributes.content_type);
    }
    if (typeof attributes.image_last_updated === 'string') {
      readings.image_last_updated = makeReading(attributes.image_last_updated);
    }
  } else if (domain === 'weather') {
    readings.weather = makeReading(String(state ?? 'cloudy'));
    readings.condition = makeReading(String(state ?? 'cloudy'));
    if (typeof attributes.temperature === 'number') {
      readings.temperature = makeReading(attributes.temperature);
    }
    if (typeof attributes.humidity === 'number') {
      readings.humidity = makeReading(attributes.humidity);
    }
    if (typeof attributes.pressure === 'number') {
      readings.pressure = makeReading(attributes.pressure);
    }
    if (typeof attributes.wind_speed === 'number') {
      readings.wind_speed = makeReading(attributes.wind_speed);
    }
    if (typeof attributes.wind_bearing === 'number') {
      readings.wind_bearing = makeReading(attributes.wind_bearing);
    }
    if (typeof attributes.visibility === 'number') {
      readings.visibility = makeReading(attributes.visibility);
    }
  } else if (domain === 'notify') {
    readings.notify = makeReading(String(state ?? 'ready'));
    readings.value = makeReading(String(state ?? 'ready'));
  }

  return readings;
}
