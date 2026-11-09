/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import type { HausDevice } from '@haus/core/device';
import {
  hausDiscoveryNodeId,
  isHausExportTopic,
  parseDiscoveryPayload,
  projectMqttEndpoint,
} from '../src/index.js';
import { DiscoveryTopics } from '../src/discovery/topics.js';

function device(overrides: Partial<HausDevice> = {}): HausDevice {
  return {
    id: 'device-1',
    source: { instanceId: 'haus-matter', externalId: 'matter-node-1' },
    name: 'Workshop sensor',
    category: 'sensor',
    connectivity: { protocol: 'matter' },
    availability: 'online',
    endpoints: [
      {
        id: 'temperature',
        name: 'Temperature',
        availability: 'online',
        capabilities: [
          {
            id: 'temperature',
            kind: 'temperature',
            readable: true,
            operations: [],
            unit: '°C',
            displayPrecision: 1,
          },
        ],
        readings: { temperature: { value: 21.5, freshness: 'live' } },
      },
    ],
    sourceRefs: [{ protocol: 'matter', externalId: 'matter-node-1' }],
    ...overrides,
  };
}

const request = (
  target: HausDevice,
  selectedDeviceIds: ReadonlySet<string> = new Set([target.id]),
) =>
  ({
    device: target,
    endpointId: 'temperature',
    capabilityId: 'temperature',
    selectedDeviceIds,
    homeId: 'test-home',
  }) as const;

it('projects an explicitly selected read-only scalar using stable HA discovery and state topics', () => {
  const target = device();
  const result = projectMqttEndpoint(request(target));
  expect(result.kind).toBe('projected');
  if (result.kind !== 'projected') throw Error('expected_mqtt_export_projection');

  expect(result.projection.discoveryTopic).toMatch(
    /^homeassistant\/sensor\/haus_[a-f0-9]{24}\/haus_[a-f0-9]{24}\/config$/,
  );
  expect(result.projection.statePayload).toBe('21.5');
  expect(result.projection.availabilityPayload).toBe('online');
  expect(result.projection.discovery.origin).toEqual({ name: 'Haus' });
  expect(result.projection.discovery.unit_of_measurement).toBe('°C');
  expect(result.projection.discovery.suggested_display_precision).toBe(1);
  expect(new DiscoveryTopics().parse(result.projection.discoveryTopic)).toMatchObject({
    component: 'sensor',
    nodeId: expect.stringMatching(/^haus_[a-f0-9]{24}$/),
  });
  expect(parseDiscoveryPayload('sensor', JSON.stringify(result.projection.discovery)).kind).toBe(
    'single',
  );
  expect(projectMqttEndpoint(request(target))).toEqual(result);
});

it('keeps unselected, HA-origin, and MQTT-origin devices out of exports', () => {
  const target = device();
  expect(projectMqttEndpoint(request(target, new Set()))).toEqual({
    kind: 'omitted',
    reason: 'not_selected',
  });
  expect(
    projectMqttEndpoint(
      request(
        device({
          sourceRefs: [{ protocol: 'home-assistant', externalId: 'sensor.temperature' }],
        }),
      ),
    ),
  ).toEqual({ kind: 'omitted', reason: 'imported_source' });
  expect(
    projectMqttEndpoint(
      request(
        device({
          source: { instanceId: 'haus-mqtt', externalId: 'mqtt-node' },
          sourceRefs: [{ protocol: 'mqtt', externalId: 'mqtt-node' }],
        }),
      ),
    ),
  ).toEqual({ kind: 'omitted', reason: 'imported_source' });
});

it('rejects endpoints and capabilities outside the selected device graph', () => {
  const target = device();
  expect(projectMqttEndpoint({ ...request(target), endpointId: 'foreign-endpoint' })).toEqual({
    kind: 'omitted',
    reason: 'endpoint_not_found',
  });
  expect(projectMqttEndpoint({ ...request(target), capabilityId: 'foreign-capability' })).toEqual({
    kind: 'omitted',
    reason: 'capability_not_found',
  });
});

it('omits writable, unsupported, and malformed scalar capabilities explicitly', () => {
  const target = device();
  const writable = device({
    endpoints: [
      {
        ...target.endpoints[0]!,
        capabilities: [{ ...target.endpoints[0]!.capabilities[0]!, operations: ['set'] }],
      },
    ],
  });
  expect(projectMqttEndpoint(request(writable))).toEqual({
    kind: 'omitted',
    reason: 'writable_capability_unsupported',
  });
  const unreadable = device({
    endpoints: [
      {
        ...target.endpoints[0]!,
        capabilities: [{ ...target.endpoints[0]!.capabilities[0]!, readable: false }],
      },
    ],
  });
  expect(projectMqttEndpoint(request(unreadable))).toEqual({
    kind: 'omitted',
    reason: 'capability_not_readable',
  });
  const composite = device({
    endpoints: [
      {
        ...target.endpoints[0]!,
        capabilities: [{ ...target.endpoints[0]!.capabilities[0]!, kind: 'composite' }],
      },
    ],
  });
  expect(projectMqttEndpoint(request(composite))).toEqual({
    kind: 'omitted',
    reason: 'capability_kind_unsupported',
  });
  const malformed = device({
    endpoints: [
      {
        ...target.endpoints[0]!,
        readings: { temperature: { value: 'warm', freshness: 'live' } },
      },
    ],
  });
  expect(projectMqttEndpoint(request(malformed))).toEqual({
    kind: 'omitted',
    reason: 'invalid_reading',
  });
});

it('projects read-only binary readings to HA binary sensor states', () => {
  const target = device({
    endpoints: [
      {
        id: 'motion',
        name: 'Motion',
        capabilities: [{ id: 'motion', kind: 'motion', readable: true, operations: [] }],
        readings: { motion: { value: true, freshness: 'live' } },
      },
    ],
  });
  const result = projectMqttEndpoint({
    ...request(target),
    endpointId: 'motion',
    capabilityId: 'motion',
  });
  expect(result.kind).toBe('projected');
  if (result.kind !== 'projected') throw Error('expected_mqtt_export_projection');
  expect(result.projection.discoveryTopic).toContain('/binary_sensor/');
  expect(result.projection.statePayload).toBe('ON');
});

it('uses live endpoint state over the registration-time reading', () => {
  const target = device();
  const result = projectMqttEndpoint({
    ...request(target),
    endpointState: { temperature: 22.25 },
  });
  expect(result.kind).toBe('projected');
  if (result.kind !== 'projected') throw Error('expected_mqtt_export_projection');
  expect(result.projection.statePayload).toBe('22.25');
});

it('announces unknown readings without inventing state or availability', () => {
  const target = device({
    availability: 'unknown',
    endpoints: [
      {
        ...device().endpoints[0]!,
        availability: 'unknown',
        readings: { temperature: { value: 0, freshness: 'unknown' } },
      },
    ],
  });
  const result = projectMqttEndpoint(request(target));
  expect(result.kind).toBe('projected');
  if (result.kind !== 'projected') throw Error('expected_mqtt_export_projection');
  expect(result.projection.statePayload).toBeUndefined();
  expect(result.projection.availabilityPayload).toBeUndefined();
});

it('omits projections with invalid home identity or discovery prefix', () => {
  const target = device();
  expect(projectMqttEndpoint({ ...request(target), homeId: '  ' })).toEqual({
    kind: 'omitted',
    reason: 'home_id_invalid',
  });
  expect(projectMqttEndpoint({ ...request(target), discoveryPrefix: 'bad/#' })).toEqual({
    kind: 'omitted',
    reason: 'discovery_prefix_invalid',
  });
});

it('recognizes only this home’s scalar export state and availability topics', () => {
  const nodeId = hausDiscoveryNodeId('test-home');
  const hash = 'a'.repeat(24);
  expect(isHausExportTopic(`haus/${nodeId}/state/${hash}`, nodeId)).toBe(true);
  expect(isHausExportTopic(`haus/${nodeId}/availability/${hash}`, nodeId)).toBe(true);
  expect(isHausExportTopic(`haus/${nodeId}/state/${hash}/extra`, nodeId)).toBe(false);
  expect(isHausExportTopic(`haus/${'haus_' + 'b'.repeat(24)}/state/${hash}`, nodeId)).toBe(false);
});
