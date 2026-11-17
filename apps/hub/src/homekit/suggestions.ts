/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { HausDevice } from '@haus/core';
import {
  evaluatePublicationRoute,
  MAX_HAP_BRIDGE_ACCESSORIES,
  mapDeviceToHap,
} from '@haus/homekit';

interface SuggestedDevice {
  readonly id: string;
  readonly name: string;
}

export interface BridgeSuggestion {
  readonly name: string;
  readonly devices: readonly SuggestedDevice[];
}

function integrationGroup(device: HausDevice): string | undefined {
  const sources = [
    device.source.instanceId,
    device.manufacturer ?? '',
    ...(device.sourceRefs?.flatMap((source) => (source.instanceId ? [source.instanceId] : [])) ??
      []),
    ...device.endpoints.flatMap(
      (endpoint) =>
        endpoint.sourceRefs?.flatMap((source) =>
          typeof source.metadata?.platform === 'string' ? [source.metadata.platform] : [],
        ) ?? [],
    ),
  ];
  if (sources.some((source) => /(?:^|[:_.-])govee/i.test(source))) return 'Govee';
  if (sources.some((source) => /(?:^|[:_.-])(?:xiaomi|yeelight)/i.test(source))) {
    return 'Xiaomi & Yeelight';
  }
  const provider = sources.find(
    (source) =>
      /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/i.test(source) &&
      !['hacs', 'virtual', 'vendor', 'hub', 'haus'].includes(source),
  );
  if (!provider) return undefined;
  return provider
    .split('_')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

export function suggestBridges(devices: readonly HausDevice[]): readonly BridgeSuggestion[] {
  const byIntegration = new Map<string, SuggestedDevice[]>();
  for (const device of devices) {
    if (!evaluatePublicationRoute(device).eligibleForBridge) continue;
    const group = integrationGroup(device);
    if (!group || !mapDeviceToHap(device).characteristics.length) continue;
    const members = byIntegration.get(group) ?? [];
    members.push({ id: device.id, name: device.name });
    byIntegration.set(group, members);
  }

  return Array.from(byIntegration)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([group, members]) => {
      if (members.length < 2) return [];
      const sorted = members.sort(
        (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
      );
      const batches = Math.ceil(sorted.length / MAX_HAP_BRIDGE_ACCESSORIES);
      return Array.from({ length: batches }, (_, index) => ({
        name: batches === 1 ? group : `${group} ${index + 1}`,
        devices: sorted.slice(
          index * MAX_HAP_BRIDGE_ACCESSORIES,
          (index + 1) * MAX_HAP_BRIDGE_ACCESSORIES,
        ),
      }));
    });
}
