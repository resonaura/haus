/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { Capability, Reading } from '../types.js';
import type {
  HausCharacteristic,
  HausService,
  HausValue,
  SourceCharacteristicRef,
  SourceServiceRef,
} from './graph.js';
import {
  classifyEndpointHapRole,
  deviceHasDimmableLightEndpoint,
  STANDARD_SENSOR_TYPES,
  stripDeviceNamePrefix,
} from './naming.js';
import { isMasterPowerOutlet } from './presentation.js';
import type { HausDevice, HausEndpoint } from './types.js';

const SENSOR_SERVICE_BY_TYPE: Readonly<Record<string, string>> = {
  temperature: 'TemperatureSensor',
  humidity: 'HumiditySensor',
  motion: 'MotionSensor',
  vibration: 'MotionSensor',
  occupancy: 'OccupancySensor',
  presence: 'OccupancySensor',
  contact: 'ContactSensor',
  door: 'ContactSensor',
  window: 'ContactSensor',
  opening: 'ContactSensor',
  garage_door: 'ContactSensor',
  tamper: 'ContactSensor',
  leak: 'LeakSensor',
  moisture: 'LeakSensor',
  smoke: 'SmokeSensor',
  carbon_monoxide: 'CarbonMonoxideSensor',
  co2: 'CarbonDioxideSensor',
  carbon_dioxide: 'CarbonDioxideSensor',
  gas: 'AirQualitySensor',
  tvoc: 'AirQualitySensor',
  pm25: 'AirQualitySensor',
  pm10: 'AirQualitySensor',
  aqi: 'AirQualitySensor',
  safety: 'SafetySensor',
  battery: 'Battery',
  battery_low: 'Battery',
  illuminance: 'LightSensor',
  power: 'PowerManagement',
  electrical_power: 'PowerManagement',
  energy: 'PowerManagement',
  voltage: 'PowerManagement',
  current: 'PowerManagement',
  pressure: 'AtmosphericPressureSensor',
  connectivity: 'Connectivity',
  signal_strength: 'Diagnostics',
  linkquality: 'Diagnostics',
};

const PRIMARY_SERVICE_BY_ROLE: Readonly<Record<string, string>> = {
  light: 'Lightbulb',
  switch: 'Switch',
  climate: 'Thermostat',
  water_heater: 'WaterHeater',
  lock: 'LockMechanism',
  cover: 'WindowCovering',
  camera: 'CameraRTPStreamManagement',
  weather: 'Weather',
  media_player: 'SmartSpeaker',
  remote: 'Remote',
  update: 'FirmwareUpdate',
  device_tracker: 'OccupancySensor',
};

function isWritableCap(cap: Capability): boolean {
  return (
    Array.isArray(cap.operations) &&
    cap.operations.some((op) =>
      [
        'set',
        'turn_on',
        'turn_off',
        'press',
        'lock',
        'unlock',
        'set_temperature',
        'select_option',
        'send_message',
        'notify',
        'activate',
        'install',
      ].includes(op),
    )
  );
}

/**
 * Maps an endpoint capability to its canonical HAP characteristic type:
 * - Boolean on/off power control becomes `power` (never `on_off`).
 * - Numeric wattage measurement (`power` sensor) becomes `electrical_power`.
 */
export function canonicalCharacteristicType(cap: Capability): string {
  if (cap.id === 'on_off') return 'power';
  if (cap.id === 'power') {
    const isWattSensor =
      !isWritableCap(cap) &&
      (cap.kind === 'numeric' || cap.deviceClass === 'power' || cap.unit === 'W');
    return isWattSensor ? 'electrical_power' : 'power';
  }
  if (cap.deviceClass && STANDARD_SENSOR_TYPES.has(cap.deviceClass)) {
    return cap.deviceClass === 'power' ? 'electrical_power' : cap.deviceClass;
  }
  return cap.id;
}

function buildCharSourceRef(endpoint: HausEndpoint, cap: Capability): SourceCharacteristicRef {
  const haRef = endpoint.sourceRefs?.find((ref) => ref.entityId);
  return {
    protocol: haRef?.protocol ?? endpoint.sourceOwner?.protocol ?? 'virtual',
    externalId: `${endpoint.id}:${cap.id}`,
    ...(haRef?.entityId ? { entityId: haRef.entityId } : { entityId: endpoint.id }),
    attributeKey: cap.id,
  };
}

function readingForCapability(endpoint: HausEndpoint, cap: Capability): Reading | undefined {
  const readings = endpoint.readings;
  if (!readings || typeof readings !== 'object') return undefined;
  return (
    readings[cap.id] ??
    (cap.deviceClass ? readings[cap.deviceClass] : undefined) ??
    readings['value'] ??
    readings['state']
  );
}

function buildCharacteristic(
  endpoint: HausEndpoint,
  cap: Capability,
  customName: string | undefined,
): HausCharacteristic {
  const type = canonicalCharacteristicType(cap);
  const reading = readingForCapability(endpoint, cap);
  const readable = cap.readable !== false;
  const writable = isWritableCap(cap);
  const validValues = cap.choices?.filter(
    (choice): choice is string | number | boolean =>
      typeof choice === 'string' || typeof choice === 'number' || typeof choice === 'boolean',
  );
  return {
    id: `${endpoint.id}_${type}`,
    stableKey: `${endpoint.id}:${cap.id}`,
    type,
    ...(customName ? { customName } : {}),
    value: (reading?.value ?? null) as HausValue,
    readable,
    writable,
    notifiable: true,
    ...(cap.unit ? { unit: cap.unit } : {}),
    ...(cap.minimum !== undefined ? { min: cap.minimum } : {}),
    ...(cap.maximum !== undefined ? { max: cap.maximum } : {}),
    ...(cap.step !== undefined ? { step: cap.step } : {}),
    ...(validValues?.length ? { validValues } : {}),
    sourceRefs: [buildCharSourceRef(endpoint, cap)],
    metadata: {
      endpointId: endpoint.id,
      sourceCapabilityId: cap.id,
      ...(cap.deviceClass ? { deviceClass: cap.deviceClass } : {}),
      ...(cap.entityCategory ? { entityCategory: cap.entityCategory } : {}),
      freshness: reading?.freshness ?? 'unknown',
      ...(reading?.observedAt ? { observedAt: reading.observedAt } : {}),
    },
  };
}

function endpointSourceRefs(endpoint: HausEndpoint): readonly SourceServiceRef[] {
  return endpoint.sourceRefs?.length
    ? endpoint.sourceRefs
    : [{ protocol: 'virtual', externalId: endpoint.id, entityId: endpoint.id }];
}

function resolveServiceTypeForRole(
  role: string,
  endpoint: HausEndpoint,
  isPowerStrip = false,
): string {
  if (role === 'switch') {
    const isOutlet =
      isPowerStrip ||
      endpoint.capabilities.some((cap) => cap.deviceClass === 'outlet') ||
      endpoint.id.toLowerCase().includes('outlet');
    return isOutlet ? 'Outlet' : 'Switch';
  }
  if (role === 'media_player') {
    const isTv = endpoint.capabilities.some((cap) => cap.deviceClass === 'tv');
    return isTv ? 'Television' : 'SmartSpeaker';
  }
  return PRIMARY_SERVICE_BY_ROLE[role] ?? SENSOR_SERVICE_BY_TYPE[role] ?? 'Generic';
}

interface MutableServiceBucket {
  readonly id: string;
  readonly stableKey: string;
  readonly type: string;
  readonly subtype?: string;
  readonly name?: string;
  readonly outletRole?: 'master' | 'outlet';
  readonly characteristics: HausCharacteristic[];
  readonly sourceRefs: SourceServiceRef[];
  sourceOwner?: SourceServiceRef;
  mediaId?: string;
}

function pushToBucket(
  buckets: Map<string, MutableServiceBucket>,
  key: string,
  create: () => MutableServiceBucket,
  char: HausCharacteristic,
  endpoint: HausEndpoint,
): void {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = create();
    buckets.set(key, bucket);
  }
  bucket.characteristics.push(char);
  for (const ref of endpointSourceRefs(endpoint)) {
    if (!bucket.sourceRefs.some((existing) => existing.externalId === ref.externalId)) {
      bucket.sourceRefs.push(ref);
    }
  }
  bucket.sourceOwner ??= endpoint.sourceOwner;
  bucket.mediaId ??= endpoint.mediaId;
}

/**
 * Collapses a device's endpoints into canonical HAP-style `HausService[]` + typed `HausCharacteristic[]`:
 * - Standard unique HAP services have `name: undefined` and typed characteristics without `customName`.
 * - Multi-channel sibling services (buttons, outlets, segments, tubes) carry a concise service `name`.
 * - Non-standard / custom HA entities collapse into `Generic` (or `Config`/`Diagnostics`) services
 *   where each characteristic carries `customName` and retains exact `sourceRefs` back to `endpoint.id`.
 * - Uses canonical `power` (not `on_off`) for boolean power controls and `electrical_power` for wattage.
 */
export function collapseEndpointsToServices(
  device: Pick<HausDevice, 'id' | 'name' | 'category' | 'deviceType' | 'model' | 'endpoints'>,
): readonly HausService[] {
  if (device.endpoints.length === 0) return [];

  const hasDimmableLight = deviceHasDimmableLightEndpoint(device.endpoints);
  const roles = device.endpoints.map((ep) => {
    const rawName = typeof ep.name === 'string' ? ep.name : '';
    return classifyEndpointHapRole(
      ep,
      device.category,
      rawName || stripDeviceNamePrefix(rawName, device.name, { model: device.model }),
      hasDimmableLight,
    );
  });
  const roleCounts = new Map<string, number>();
  for (const role of roles) {
    if (!role) continue;
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }

  const switchEndpoints = device.endpoints.filter((_, idx) => roles[idx] === 'switch');
  const isPowerStrip =
    device.deviceType === 'power_strip' ||
    (switchEndpoints.length >= 2 &&
      (device.category === 'power' ||
        switchEndpoints.every((ep) =>
          ep.capabilities.some((cap) => cap.deviceClass === 'outlet'),
        )));
  const masterCandidates = isPowerStrip
    ? switchEndpoints.filter((ep) => isMasterPowerOutlet(ep.id, ep.name))
    : [];
  const masterEndpointId =
    masterCandidates.length === 1 && switchEndpoints.length - 1 >= 2
      ? masterCandidates[0]!.id
      : undefined;

  const buckets = new Map<string, MutableServiceBucket>();

  for (let i = 0; i < device.endpoints.length; i += 1) {
    const endpoint = device.endpoints[i]!;
    const role = roles[i];
    const rawName = typeof endpoint.name === 'string' ? endpoint.name : '';
    const customLabel =
      rawName.trim() || stripDeviceNamePrefix(rawName, device.name, { model: device.model });
    const caps = Array.isArray(endpoint.capabilities) ? endpoint.capabilities : [];

    // 1. Standard unique HAP service/sensor endpoint.
    if (role && roleCounts.get(role) === 1) {
      // Multi-cap sensor/camera endpoints split cleanly into their HAP services (e.g. ContactSensor + Battery).
      const isMultiServiceBundle =
        caps.length > 1 &&
        (role === 'camera' ||
          role === 'power' ||
          caps.every((cap) => {
            const type = canonicalCharacteristicType(cap);
            return type in SENSOR_SERVICE_BY_TYPE || cap.id === 'running';
          }));

      if (isMultiServiceBundle) {
        for (const cap of caps) {
          const charType = canonicalCharacteristicType(cap);
          const serviceType =
            cap.id === 'video' || cap.id === 'camera'
              ? 'CameraRTPStreamManagement'
              : (SENSOR_SERVICE_BY_TYPE[charType] ?? 'PowerManagement');
          const key = `std:${serviceType}`;
          pushToBucket(
            buckets,
            key,
            () => ({
              id: `service_${serviceType.toLowerCase()}`,
              stableKey: `${device.id}:hap:${serviceType}`,
              type: serviceType,
              characteristics: [],
              sourceRefs: [],
            }),
            buildCharacteristic(endpoint, cap, undefined),
            endpoint,
          );
        }
        continue;
      }

      const serviceType = resolveServiceTypeForRole(role, endpoint, isPowerStrip);
      const key = `std:${serviceType}`;
      for (const cap of caps) {
        pushToBucket(
          buckets,
          key,
          () => ({
            id: `service_${serviceType.toLowerCase()}`,
            stableKey: `${device.id}:hap:${serviceType}`,
            type: serviceType,
            ...(isPowerStrip && role === 'switch' ? { outletRole: 'outlet' as const } : {}),
            characteristics: [],
            sourceRefs: [],
          }),
          buildCharacteristic(endpoint, cap, undefined),
          endpoint,
        );
      }
      continue;
    }

    // 2. Multi-instance standard services (power strip outlets, light segments/tubes, multi-temp sensors).
    if (role && (roleCounts.get(role) ?? 0) > 1) {
      const serviceType = resolveServiceTypeForRole(role, endpoint, isPowerStrip);
      const serviceName = customLabel || undefined;
      const outletRole =
        isPowerStrip && role === 'switch'
          ? endpoint.id === masterEndpointId
            ? ('master' as const)
            : ('outlet' as const)
          : undefined;
      const key = `multi:${endpoint.id}`;
      for (const cap of caps) {
        pushToBucket(
          buckets,
          key,
          () => ({
            id: `service_${endpoint.id}`,
            stableKey: endpoint.address ?? `${device.id}:hap:${endpoint.id}`,
            type: serviceType,
            subtype: endpoint.id,
            ...(serviceName ? { name: serviceName } : {}),
            ...(outletRole ? { outletRole } : {}),
            characteristics: [],
            sourceRefs: [],
          }),
          buildCharacteristic(endpoint, cap, undefined),
          endpoint,
        );
      }
      continue;
    }

    // 3. Stateless programmable switch / button events (`event` endpoints).
    const isEventEndpoint =
      caps.some((cap) => cap.id === 'event') &&
      !caps.some((cap) => cap.id === 'button' || cap.id === 'press');
    if (isEventEndpoint) {
      const key = `event:${endpoint.id}`;
      for (const cap of caps) {
        pushToBucket(
          buckets,
          key,
          () => ({
            id: `service_${endpoint.id}`,
            stableKey: endpoint.address ?? `${device.id}:hap:${endpoint.id}`,
            type: 'StatelessProgrammableSwitch',
            subtype: endpoint.id,
            ...(customLabel ? { name: customLabel } : {}),
            characteristics: [],
            sourceRefs: [],
          }),
          buildCharacteristic(endpoint, cap, undefined),
          endpoint,
        );
      }
      continue;
    }

    // 4. Custom / Generic HA entities collapse by entityCategory into `Generic`, `Config`, or `Diagnostics`.
    const isConfig = caps.length > 0 && caps.every((cap) => cap.entityCategory === 'config');
    const isDiagnostic =
      caps.length > 0 && caps.every((cap) => cap.entityCategory === 'diagnostic');
    const groupType = isConfig ? 'Config' : isDiagnostic ? 'Diagnostics' : 'Generic';
    const key = `custom:${groupType}`;

    if (caps.length === 0) {
      const fallbackChar: HausCharacteristic = {
        id: `${endpoint.id}_state`,
        stableKey: `${endpoint.id}:state`,
        type: 'generic',
        ...(customLabel ? { customName: customLabel } : {}),
        value: (endpoint.readings['state']?.value ?? null) as HausValue,
        readable: true,
        writable: false,
        notifiable: true,
        sourceRefs: [{ protocol: 'virtual', externalId: endpoint.id, entityId: endpoint.id }],
        metadata: { endpointId: endpoint.id },
      };
      pushToBucket(
        buckets,
        key,
        () => ({
          id: `service_${groupType.toLowerCase()}`,
          stableKey: `${device.id}:hap:${groupType}`,
          type: groupType,
          characteristics: [],
          sourceRefs: [],
        }),
        fallbackChar,
        endpoint,
      );
      continue;
    }

    for (const cap of caps) {
      pushToBucket(
        buckets,
        key,
        () => ({
          id: `service_${groupType.toLowerCase()}`,
          stableKey: `${device.id}:hap:${groupType}`,
          type: groupType,
          characteristics: [],
          sourceRefs: [],
        }),
        buildCharacteristic(endpoint, cap, customLabel || undefined),
        endpoint,
      );
    }
  }

  return [...buckets.values()].map((bucket) => ({
    id: bucket.id,
    stableKey: bucket.stableKey,
    type: bucket.type,
    ...(bucket.subtype ? { subtype: bucket.subtype } : {}),
    ...(bucket.name ? { name: bucket.name } : {}),
    characteristics: bucket.characteristics,
    linkedServiceIds: [],
    sourceRefs: bucket.sourceRefs,
    ...(bucket.sourceOwner ? { sourceOwner: bucket.sourceOwner } : {}),
    ...(bucket.mediaId ? { mediaId: bucket.mediaId } : {}),
    opaqueMetadata: {
      derivedFromEndpoints: true,
      ...(bucket.outletRole ? { outletRole: bucket.outletRole } : {}),
    },
  }));
}

/** True when a device's `services` were automatically derived from `endpoints` (legacy or HAP). */
export function isDerivedEndpointServices(services: readonly HausService[] | undefined): boolean {
  if (!Array.isArray(services) || services.length === 0) return true;
  return services.every(
    (service) =>
      service !== null &&
      typeof service === 'object' &&
      (service.opaqueMetadata?.['derivedFromEndpoints'] === true ||
        (typeof service.id === 'string' && service.id.startsWith('service_'))),
  );
}
