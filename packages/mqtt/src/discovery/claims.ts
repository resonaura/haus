/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { extractRawIdentifier, resolvePhysicalDeviceId, sanitizeMqttId } from './converter.js';
import { parseDiscoveryPayload } from './payload.js';
import type { DiscoveryTopic } from './topics.js';
import type { SingleEntityDiscoveryPayload } from '../types.js';

export type MqttDiscoveryClaim =
  | { readonly kind: 'device'; readonly device: string }
  | {
      readonly kind: 'endpoint';
      readonly device: string;
      readonly component: string;
      readonly uniqueId: string;
    };

export function singleDiscoveryIdentity(
  topic: DiscoveryTopic,
  payload: SingleEntityDiscoveryPayload,
) {
  const uniqueId =
    payload.unique_id ||
    sanitizeMqttId(
      topic.nodeId
        ? `${topic.component}_${topic.nodeId}_${topic.objectId}`
        : `${topic.component}_${topic.objectId}`,
    );
  return { uniqueId, rawDeviceId: resolvePhysicalDeviceId(uniqueId, payload.device, topic.nodeId) };
}

/** Identify exactly the endpoints present in this accepted retained projection. */
export function discoveryClaims(
  topic: DiscoveryTopic,
  payload: string,
): readonly MqttDiscoveryClaim[] {
  if (!payload.length) return [];
  const parsed = parseDiscoveryPayload(topic.component, payload);
  const claims: MqttDiscoveryClaim[] = [];
  if (parsed.kind === 'single') {
    const { uniqueId, rawDeviceId } = singleDiscoveryIdentity(topic, parsed.payload);
    claims.push(
      { kind: 'device', device: rawDeviceId },
      { kind: 'endpoint', device: rawDeviceId, component: topic.component, uniqueId },
    );
  } else {
    const rawDeviceId = extractRawIdentifier(parsed.payload.device) || 'device';
    claims.push({ kind: 'device', device: rawDeviceId });
    for (const [key, component] of Object.entries(parsed.payload.components)) {
      if (Object.keys(component).length === 1) continue;
      claims.push({
        kind: 'endpoint',
        device: rawDeviceId,
        component: component.platform || 'sensor',
        uniqueId: component.unique_id || `${rawDeviceId}_${key}`,
      });
    }
  }
  return claims;
}

export function parseDiscoveryClaims(encoded: string): readonly MqttDiscoveryClaim[] {
  if (Buffer.byteLength(encoded) > 1_000_000) throw Error('mqtt_retained_claims_invalid');
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded) as unknown;
  } catch {
    throw Error('mqtt_retained_claims_invalid');
  }
  if (!Array.isArray(parsed) || parsed.length > 10_000) throw Error('mqtt_retained_claims_invalid');
  const claims = parsed.map((value: unknown): MqttDiscoveryClaim => {
    if (
      !value ||
      typeof value !== 'object' ||
      !('kind' in value) ||
      !('device' in value) ||
      typeof value.device !== 'string' ||
      value.device.length === 0
    )
      throw Error('mqtt_retained_claims_invalid');
    if (value.kind === 'device' && Object.keys(value).length === 2)
      return { kind: 'device', device: value.device };
    if (
      value.kind === 'endpoint' &&
      Object.keys(value).length === 4 &&
      'component' in value &&
      typeof value.component === 'string' &&
      value.component.length > 0 &&
      'uniqueId' in value &&
      typeof value.uniqueId === 'string' &&
      value.uniqueId.length > 0
    )
      return {
        kind: 'endpoint',
        device: value.device,
        component: value.component,
        uniqueId: value.uniqueId,
      };
    throw Error('mqtt_retained_claims_invalid');
  });
  if (new Set(claims.map((claim) => JSON.stringify(claim))).size !== claims.length)
    throw Error('mqtt_retained_claims_invalid');
  return claims;
}
