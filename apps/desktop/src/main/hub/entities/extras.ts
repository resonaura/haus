/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { truthy } from '../sensor-classes';

/** Translates a Hub `update.*` endpoint snapshot into full official HA UpdateEntity attributes. */
export function updateStateFor(
  endpointState: Record<string, unknown> | undefined,
  raw: unknown,
  attributes: Record<string, unknown>,
): { state: string; attributes: Record<string, unknown> } {
  if (typeof endpointState?.installed_version === 'string') {
    attributes.installed_version = endpointState.installed_version;
  }
  if (typeof endpointState?.latest_version === 'string') {
    attributes.latest_version = endpointState.latest_version;
  }
  if (
    typeof endpointState?.skipped_version === 'string' ||
    endpointState?.skipped_version === null
  ) {
    attributes.skipped_version = endpointState.skipped_version;
  }
  if (typeof endpointState?.title === 'string') attributes.title = endpointState.title;
  if (
    typeof endpointState?.in_progress === 'boolean' ||
    typeof endpointState?.in_progress === 'number'
  ) {
    attributes.in_progress = endpointState.in_progress;
  }
  if (
    typeof endpointState?.update_percentage === 'number' ||
    endpointState?.update_percentage === null
  ) {
    attributes.update_percentage = endpointState.update_percentage;
  }
  if (typeof endpointState?.auto_update === 'boolean') {
    attributes.auto_update = endpointState.auto_update;
  }
  if (typeof endpointState?.release_summary === 'string') {
    attributes.release_summary = endpointState.release_summary;
  }
  if (typeof endpointState?.release_url === 'string') {
    attributes.release_url = endpointState.release_url;
  }
  if (typeof endpointState?.supported_features === 'number') {
    attributes.supported_features = endpointState.supported_features;
  } else {
    attributes.supported_features = 1;
  }
  if (typeof endpointState?.entity_picture === 'string') {
    attributes.entity_picture = endpointState.entity_picture;
  }
  const on = truthy(endpointState?.update ?? endpointState?.on_off ?? raw);
  return { state: on ? 'on' : 'off', attributes };
}

/** Translates a Hub `image.*` endpoint snapshot (e.g. Wi-Fi QR codes) into HA ImageEntity state. */
export function imageStateFor(
  endpointState: Record<string, unknown> | undefined,
  raw: unknown,
  attributes: Record<string, unknown>,
): { state: string; attributes: Record<string, unknown> } {
  if (typeof endpointState?.entity_picture === 'string') {
    attributes.entity_picture = endpointState.entity_picture;
  }
  if (typeof endpointState?.content_type === 'string') {
    attributes.content_type = endpointState.content_type;
  }
  if (typeof endpointState?.image_last_updated === 'string') {
    attributes.image_last_updated = endpointState.image_last_updated;
  }
  const value =
    typeof endpointState?.image === 'string' && endpointState.image
      ? endpointState.image
      : typeof raw === 'string' && raw
        ? raw
        : 'unknown';
  return { state: value, attributes };
}

/** Copies safe, non-secret network telemetry attributes (clients list, MAC, subnet, guest SSID). */
export function attachNetworkExtraAttributes(
  endpointState: Record<string, unknown> | undefined,
  attributes: Record<string, unknown>,
): void {
  if (!endpointState) return;
  if (Array.isArray(endpointState.clients)) {
    const names = endpointState.clients.filter((item): item is string => typeof item === 'string');
    if (names.length > 0) attributes.clients = names;
  }
  for (const key of [
    'mac_address',
    'subnet_mask',
    'last_updated',
    'guest_network_name',
    'domain',
  ] as const) {
    if (typeof endpointState[key] === 'string' && endpointState[key]) {
      attributes[key] = endpointState[key];
    }
  }
  if (typeof endpointState.connected_guest_clients === 'number') {
    attributes.connected_guest_clients = endpointState.connected_guest_clients;
  }
}

/** Translates a Hub `weather.*` endpoint snapshot into HA WeatherEntity state and attributes. */
export function weatherStateFor(
  endpointState: Record<string, unknown> | undefined,
  raw: unknown,
  attributes: Record<string, unknown>,
): { state: string; attributes: Record<string, unknown> } {
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
