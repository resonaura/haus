/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { HubCapability, HubDevice, HubEndpoint } from './types';

export const SENSOR_CLASSES: Record<string, string> = {
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

export const NUMERIC_SENSOR_CLASSES: Record<string, { device_class: string; unit?: string }> = {
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
  data_rate: { device_class: 'data_rate', unit: 'Mbit/s' },
  data_size: { device_class: 'data_size', unit: 'GiB' },
  weight: { device_class: 'weight', unit: 'kg' },
  wind_speed: { device_class: 'wind_speed', unit: 'km/h' },
  precipitation_intensity: { device_class: 'precipitation_intensity', unit: 'mm/h' },
  distance: { device_class: 'distance', unit: 'm' },
};

export const truthy = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (
      ['on', 'true', 'open', 'detected', 'wet', 'heat', 'electric', 'performance'].includes(lower)
    )
      return true;
    if (['off', 'false', 'closed', 'clear', 'dry'].includes(lower)) return false;
  }
  if (typeof value === 'number') return value !== 0;
  return undefined;
};

export function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'device'
  );
}

export function colorOf(value: unknown): [number, number, number] | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { r, g, b } = value as Record<string, unknown>;
  return typeof r === 'number' && typeof g === 'number' && typeof b === 'number'
    ? [r, g, b]
    : undefined;
}

export function computeFriendlyName(
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
  const isOnlyPrimaryCap = primaryCaps.length === 1 && primaryCaps[0]?.id === cap.id;

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
