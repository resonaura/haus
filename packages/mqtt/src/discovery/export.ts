/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createHash } from 'node:crypto';
import type { HausDevice } from '@haus/core/device';
import type { HaMqttComponentConfig } from '../types.js';
import { hausDiscoveryNodeId } from './ownership.js';
import { DiscoveryTopics } from './topics.js';

export interface MqttExportRequest {
  readonly device: HausDevice;
  readonly endpointId: string;
  readonly capabilityId: string;
  readonly endpointState?: Readonly<Record<string, unknown>>;
  readonly selectedDeviceIds: ReadonlySet<string>;
  readonly allowCommands?: boolean;
  readonly homeId: string;
  readonly discoveryPrefix?: string;
}

export interface MqttExportProjection {
  readonly discoveryTopic: string;
  readonly discovery: HaMqttComponentConfig;
  readonly stateTopic: string;
  readonly statePayload?: string;
  readonly availabilityTopic: string;
  readonly availabilityPayload?: 'online' | 'offline';
  readonly commandTopic?: string;
}

export type MqttExportResult =
  | { readonly kind: 'projected'; readonly projection: MqttExportProjection }
  | {
      readonly kind: 'omitted';
      readonly reason:
        | 'not_selected'
        | 'imported_source'
        | 'endpoint_not_found'
        | 'capability_not_found'
        | 'capability_not_readable'
        | 'writable_capability_unsupported'
        | 'capability_kind_unsupported'
        | 'invalid_reading'
        | 'home_id_invalid'
        | 'discovery_prefix_invalid';
    };

const importedProtocols = new Set(['home-assistant', 'mqtt']);
const numericKinds = new Set(['numeric', 'temperature', 'humidity']);
const binaryKinds = new Set(['binary', 'motion', 'contact']);

/** Project one explicitly selected local endpoint into HA-compatible MQTT discovery. */
export function projectMqttEndpoint(request: MqttExportRequest): MqttExportResult {
  const { device } = request;
  if (!request.selectedDeviceIds.has(device.id)) return { kind: 'omitted', reason: 'not_selected' };
  if (
    device.source.instanceId === 'haus-mqtt' ||
    device.connectivity.protocol === 'ha' ||
    device.connectivity.protocol === 'mqtt' ||
    device.sourceRefs?.some((reference) => importedProtocols.has(reference.protocol))
  )
    return { kind: 'omitted', reason: 'imported_source' };

  const endpoint = device.endpoints.find((candidate) => candidate.id === request.endpointId);
  if (!endpoint) return { kind: 'omitted', reason: 'endpoint_not_found' };
  const capability = endpoint.capabilities.find(
    (candidate) => candidate.id === request.capabilityId,
  );
  if (!capability) return { kind: 'omitted', reason: 'capability_not_found' };
  if (!capability.readable) return { kind: 'omitted', reason: 'capability_not_readable' };
  const controllable =
    capability.kind === 'on_off' &&
    capability.operations.includes('turn_on') &&
    capability.operations.includes('turn_off');
  if (capability.operations.length > 0 && !controllable)
    return { kind: 'omitted', reason: 'writable_capability_unsupported' };

  const isNumeric = numericKinds.has(capability.kind);
  const isOnOff = capability.kind === 'on_off';
  const isBinary = binaryKinds.has(capability.kind) || isOnOff;
  if (!isNumeric && !isBinary) return { kind: 'omitted', reason: 'capability_kind_unsupported' };

  const hasCurrentValue =
    request.endpointState !== undefined && Object.hasOwn(request.endpointState, capability.id);
  const reading = hasCurrentValue
    ? parseCurrentReading(request.endpointState[capability.id])
    : endpoint.readings[capability.id];
  let statePayload: string | undefined;
  if (reading && reading.freshness !== 'unknown') {
    if (isNumeric && typeof reading.value === 'number' && Number.isFinite(reading.value)) {
      statePayload = String(reading.value);
    } else if (isBinary) {
      statePayload = parseBinaryReading(reading.value);
      if (statePayload === undefined) return { kind: 'omitted', reason: 'invalid_reading' };
    } else {
      return { kind: 'omitted', reason: 'invalid_reading' };
    }
  }

  let nodeId: string;
  try {
    nodeId = hausDiscoveryNodeId(request.homeId);
  } catch {
    return { kind: 'omitted', reason: 'home_id_invalid' };
  }
  const discoveryPrefix = request.discoveryPrefix ?? 'homeassistant';
  try {
    new DiscoveryTopics([discoveryPrefix]);
  } catch {
    return { kind: 'omitted', reason: 'discovery_prefix_invalid' };
  }

  const identity = stableHash(device.id, endpoint.id, capability.id);
  const objectId = `haus_${identity}`;
  const exposeCommands = controllable && request.allowCommands === true;
  const component = isNumeric ? 'sensor' : exposeCommands ? 'switch' : 'binary_sensor';
  const discoveryTopic = `${discoveryPrefix}/${component}/${nodeId}/${objectId}/config`;
  const stateTopic = `haus/${nodeId}/state/${objectId}`;
  const commandTopic = exposeCommands ? `haus/${nodeId}/command/${identity}` : undefined;
  const availabilityTopic = `haus/${nodeId}/availability/${stableHash(device.id, endpoint.id)}`;
  const availability = endpoint.availability ?? device.availability;
  const discovery: HaMqttComponentConfig = {
    origin: { name: 'Haus' },
    unique_id: `haus_${nodeId}_${identity}`,
    name: capability.name ?? endpoint.name,
    state_topic: stateTopic,
    command_topic: commandTopic,
    payload_on: isBinary ? 'ON' : undefined,
    payload_off: isBinary ? 'OFF' : undefined,
    availability_topic: availabilityTopic,
    payload_available: 'online',
    payload_not_available: 'offline',
    device_class: capability.deviceClass,
    entity_category: capability.entityCategory,
    icon: capability.icon,
    unit_of_measurement: isNumeric ? capability.unit : undefined,
    suggested_display_precision: isNumeric ? capability.displayPrecision : undefined,
    device: {
      identifiers: [`haus_${nodeId}_${stableHash(device.id)}`],
      name: device.name,
      manufacturer: device.manufacturer,
      model: device.model,
      sw_version: device.firmwareVersion,
      hw_version: device.hardwareVersion,
    },
  };

  return {
    kind: 'projected',
    projection: {
      discoveryTopic,
      discovery,
      stateTopic,
      statePayload,
      availabilityTopic,
      availabilityPayload:
        availability === 'online' || availability === 'offline' ? availability : undefined,
      commandTopic,
    },
  };
}

function parseBinaryReading(value: unknown): 'ON' | 'OFF' | undefined {
  if (value === true || value === 'on' || value === 'ON') return 'ON';
  if (value === false || value === 'off' || value === 'OFF') return 'OFF';
  return undefined;
}

function parseCurrentReading(
  value: unknown,
): { readonly value: unknown; readonly freshness: 'live' | 'cached' | 'unknown' } | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return { value, freshness: 'live' };
  if (!('value' in value)) return { value, freshness: 'live' };
  const freshness = 'freshness' in value ? value.freshness : 'live';
  if (freshness !== 'live' && freshness !== 'cached' && freshness !== 'unknown') return;
  return { value: value.value, freshness };
}

function stableHash(...parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex').slice(0, 24);
}
