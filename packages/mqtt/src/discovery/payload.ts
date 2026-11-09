/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { DeviceBundleDiscoveryPayload, HaMqttComponentConfig } from '../types.js';
import { expandHaDiscoveryPayload } from './abbreviations.js';
import { supportedMqttComponent } from './topics.js';
import { bundleDiscovery, componentDiscovery, discoveryObject } from './validation.js';

export type DiscoveryConfiguration =
  | { readonly kind: 'single'; readonly payload: HaMqttComponentConfig }
  | { readonly kind: 'device'; readonly payload: DeviceBundleDiscoveryPayload };

/** Wire validation shared by runtime ingestion and the durable accepted projection. */
export function parseDiscoveryPayload(component: string, payload: string): DiscoveryConfiguration {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    throw Error('mqtt_discovery_invalid');
  }
  if (!discoveryObject(raw)) throw Error('mqtt_discovery_invalid');
  const parsed = expandHaDiscoveryPayload(raw);
  if (component === 'device') {
    if (!bundleDiscovery(parsed)) throw Error('mqtt_discovery_invalid');
    if (
      Object.values(parsed.components).some(
        (config) => !config.platform || !supportedMqttComponent(config.platform),
      )
    )
      throw Error('mqtt_discovery_unsupported_platform');
    const identities = new Set<string>();
    for (const [key, config] of Object.entries(parsed.components)) {
      if (Object.keys(config).length === 1) continue;
      const identity = JSON.stringify([config.platform, config.unique_id || key]);
      if (identities.has(identity)) throw Error('mqtt_discovery_identity_conflict');
      identities.add(identity);
    }
    return { kind: 'device', payload: parsed };
  }
  if (!supportedMqttComponent(component)) throw Error('mqtt_discovery_unsupported_platform');
  if (
    'components' in parsed ||
    !componentDiscovery(parsed) ||
    (parsed.platform && parsed.platform !== component)
  )
    throw Error('mqtt_discovery_invalid');
  return { kind: 'single', payload: parsed };
}
