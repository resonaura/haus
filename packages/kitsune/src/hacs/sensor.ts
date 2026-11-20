/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import type { Capability } from '@haus/core/types';
import { CapabilityKind, createTemperatureCapability } from '@haus/core/device';
import type { HacsEntityPayload } from './types.js';

export function sensorCapabilities(payload?: Partial<HacsEntityPayload>): Capability[] {
  const attrs = payload?.attributes ?? {};
  if (attrs.device_class === 'carbon_dioxide' || attrs.unit_of_measurement === 'ppm') {
    return [
      {
        id: 'co2',
        kind: CapabilityKind.Temperature,
        readable: true,
        operations: [],
        unit: 'ppm',
      },
    ];
  }
  if (
    attrs.unit_of_measurement === 'ppb' ||
    String(attrs.friendly_name ?? '')
      .toLowerCase()
      .includes('tvoc')
  ) {
    return [
      {
        id: 'tvoc',
        kind: CapabilityKind.Temperature,
        readable: true,
        operations: [],
        unit: 'ppb',
      },
    ];
  }
  if (attrs.device_class === 'timestamp') {
    return [
      {
        id: 'timestamp',
        kind: CapabilityKind.Event,
        readable: true,
        operations: [],
      },
    ];
  }
  if (
    attrs.device_class === 'data_rate' ||
    attrs.unit_of_measurement === 'Mbit/s' ||
    attrs.unit_of_measurement === 'MB/s'
  ) {
    return [
      {
        id: 'data_rate',
        kind: 'numeric' as CapabilityKind,
        readable: true,
        operations: [],
        unit: String(attrs.unit_of_measurement ?? 'Mbit/s'),
      },
    ];
  }
  if (attrs.device_class === 'data_size' || attrs.unit_of_measurement === 'GiB') {
    return [
      {
        id: 'data_size',
        kind: 'numeric' as CapabilityKind,
        readable: true,
        operations: [],
        unit: String(attrs.unit_of_measurement ?? 'GiB'),
      },
    ];
  }
  if (attrs.device_class === 'duration' || attrs.unit_of_measurement === 'ms') {
    return [
      {
        id: 'duration',
        kind: 'numeric' as CapabilityKind,
        readable: true,
        operations: [],
        unit: String(attrs.unit_of_measurement ?? 'ms'),
      },
    ];
  }
  if (attrs.device_class === 'humidity') {
    return [
      {
        id: 'humidity',
        kind: CapabilityKind.Humidity,
        readable: true,
        operations: [],
        unit: '%',
      },
    ];
  }
  if (attrs.device_class === 'pressure' || attrs.unit_of_measurement === 'hPa') {
    return [
      {
        id: 'pressure',
        kind: 'numeric' as CapabilityKind,
        readable: true,
        operations: [],
        unit: 'hPa',
      },
    ];
  }
  if (attrs.device_class === 'wind_speed' || attrs.unit_of_measurement === 'km/h') {
    return [
      {
        id: 'wind_speed',
        kind: 'numeric' as CapabilityKind,
        readable: true,
        operations: [],
        unit: 'km/h',
      },
    ];
  }
  if (
    attrs.device_class === 'temperature' ||
    ['°C', '°F', 'K'].includes(String(attrs.unit_of_measurement))
  ) {
    return [{ ...createTemperatureCapability(), unit: String(attrs.unit_of_measurement ?? '°C') }];
  }
  if (isTextSensor(payload)) {
    return [
      {
        id: 'value',
        kind: 'string' as CapabilityKind,
        readable: true,
        operations: [],
        deviceClass: typeof attrs.device_class === 'string' ? attrs.device_class : undefined,
      },
    ];
  }
  return [
    {
      id: 'value',
      kind: 'numeric' as CapabilityKind,
      readable: true,
      operations: [],
      deviceClass: typeof attrs.device_class === 'string' ? attrs.device_class : undefined,
      unit: typeof attrs.unit_of_measurement === 'string' ? attrs.unit_of_measurement : undefined,
    },
  ];
}

function isTextSensor(payload?: Partial<HacsEntityPayload>): boolean {
  const attrs = payload?.attributes ?? {};
  if (
    attrs.device_class === 'enum' ||
    attrs.device_class === 'date' ||
    Array.isArray(attrs.options)
  )
    return true;
  if (
    attrs.device_class === 'weight' ||
    attrs.state_class ||
    (typeof attrs.unit_of_measurement === 'string' && attrs.unit_of_measurement.trim())
  )
    return false;
  const state = payload?.state;
  return (
    typeof state === 'string' &&
    !['unknown', 'unavailable'].includes(state) &&
    Number.isNaN(Number(state))
  );
}
