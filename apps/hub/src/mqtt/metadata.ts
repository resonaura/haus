/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { DeviceRelationship, HausDevice, SourceDeviceRef } from '@haus/core';
import type { HaMqttDeviceBlock, HaMqttOriginBlock } from '@haus/mqtt';

type DiscoveryMetadata = Readonly<Record<string, unknown>>;

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  const output: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) output[key] = field;
  return output;
}

function previousDiscovery(reference: SourceDeviceRef | undefined): DiscoveryMetadata {
  return record(reference?.metadata?.discovery) ?? {};
}

function safeOrigin(origin: HaMqttOriginBlock | undefined): HaMqttOriginBlock | undefined {
  if (!origin) return;
  let supportUrl: string | undefined;
  if (origin.support_url) {
    try {
      const parsed = new URL(origin.support_url);
      if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) {
        parsed.search = '';
        parsed.hash = '';
        supportUrl = parsed.toString();
      }
    } catch {
      supportUrl = undefined;
    }
  }
  return {
    name: origin.name,
    ...(origin.sw_version ? { sw_version: origin.sw_version } : {}),
    ...(supportUrl ? { support_url: supportUrl } : {}),
  };
}

function safeConfigurationUrl(value: string | undefined): string | undefined {
  if (!value) return;
  try {
    const parsed = new URL(value);
    if (
      !['http:', 'https:', 'homeassistant:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      return;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return;
  }
}

export function mqttSourceReferences(
  current: readonly SourceDeviceRef[] | undefined,
  externalId: string,
  device: HaMqttDeviceBlock | undefined,
  origin: HaMqttOriginBlock | undefined,
): readonly SourceDeviceRef[] {
  const existing = current ?? [];
  const matching = existing.find(
    (reference) => reference.protocol === 'mqtt' && reference.externalId === externalId,
  );
  const previous = previousDiscovery(matching);
  const identifiers =
    device?.identifiers === undefined
      ? previous['identifiers']
      : typeof device.identifiers === 'string'
        ? [device.identifiers]
        : device.identifiers;
  const connections = device?.connections ?? previous['connections'];
  const viaDevice =
    device === undefined ? previous['viaDevice'] : device.via_device?.trim() || undefined;
  const serialNumber = device?.serial_number ?? previous['serialNumber'];
  const hardwareVersion = device?.hw_version ?? previous['hardwareVersion'];
  const modelId = device?.model_id ?? previous['modelId'];
  const configurationUrl =
    safeConfigurationUrl(device?.configuration_url) ?? previous['configurationUrl'];
  const discoveredOrigin = safeOrigin(origin) ?? previous['origin'];
  const discovery = {
    ...(Array.isArray(identifiers) && identifiers.every((item) => typeof item === 'string')
      ? { identifiers }
      : {}),
    ...(Array.isArray(connections) ? { connections } : {}),
    ...(typeof viaDevice === 'string' && viaDevice ? { viaDevice } : {}),
    ...(typeof serialNumber === 'string' && serialNumber ? { serialNumber } : {}),
    ...(typeof hardwareVersion === 'string' && hardwareVersion ? { hardwareVersion } : {}),
    ...(typeof modelId === 'string' && modelId ? { modelId } : {}),
    ...(typeof configurationUrl === 'string' && configurationUrl ? { configurationUrl } : {}),
    ...(record(discoveredOrigin) ? { origin: discoveredOrigin } : {}),
  };
  const reference: SourceDeviceRef = {
    protocol: 'mqtt',
    externalId,
    metadata: { ...matching?.metadata, discovery },
  };
  return [...existing.filter((item) => item !== matching), reference];
}

function viaDevice(device: HausDevice): string | undefined {
  for (const source of device.sourceRefs ?? []) {
    if (source.protocol !== 'mqtt') continue;
    const metadata = record(source.metadata?.discovery);
    const value = metadata?.['viaDevice'];
    if (typeof value === 'string' && value) return value;
  }
}

function mqttRelation(relationship: DeviceRelationship): boolean {
  return record(relationship.metadata)?.['source'] === 'mqtt-discovery';
}

export function resolveMqttRelationships(devices: readonly HausDevice[]): readonly HausDevice[] {
  const byIdentifier = new Map<string, Set<string>>();
  for (const device of devices) {
    for (const source of device.sourceRefs ?? []) {
      if (source.protocol !== 'mqtt') continue;
      const matches = byIdentifier.get(source.externalId) ?? new Set<string>();
      matches.add(device.id);
      byIdentifier.set(source.externalId, matches);
      const identifiers = record(source.metadata?.discovery)?.['identifiers'];
      if (!Array.isArray(identifiers)) continue;
      for (const identifier of identifiers) {
        if (typeof identifier !== 'string' || !identifier) continue;
        const identifierMatches = byIdentifier.get(identifier) ?? new Set<string>();
        identifierMatches.add(device.id);
        byIdentifier.set(identifier, identifierMatches);
      }
    }
    if (device.source.instanceId === 'haus-mqtt') {
      const matches = byIdentifier.get(device.source.externalId) ?? new Set<string>();
      matches.add(device.id);
      byIdentifier.set(device.source.externalId, matches);
    }
  }

  return devices.map((device) => {
    const via = viaDevice(device);
    const targets = via ? byIdentifier.get(via) : undefined;
    const target = targets?.size === 1 ? [...targets][0] : undefined;
    const relationships = (device.relationships ?? []).filter((item) => !mqttRelation(item));
    if (target && target !== device.id)
      relationships.push({
        type: 'bridged',
        targetDeviceId: target,
        metadata: { source: 'mqtt-discovery', viaDevice: via },
      });
    if (JSON.stringify(device.relationships ?? []) === JSON.stringify(relationships)) return device;
    return { ...device, relationships };
  });
}
