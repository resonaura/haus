/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Bonjour, type Service } from 'bonjour-service';
import type { HubDevice } from './types';

export interface DiscoveredHomeKitItem {
  id: string;
  name: string;
  model?: string;
  address: string;
  port: number;
  category: number;
  paired: boolean;
  configNumber: number;
}

export interface PersistedHomeKitPairingItem {
  accessoryId: string;
  name: string;
  address: string;
  port: number;
}

export interface HubDiscoverySnapshot {
  discovered: DiscoveredHomeKitItem[];
  pairings: PersistedHomeKitPairingItem[];
}

export interface CommissioningSnapshot {
  commissioningId: string;
  state: string;
  error?: string;
  requiresCredentials?: { reason?: string; suggestedSsid?: string };
  selectedCandidate?: { identifier: string };
  pairedDevices?: Array<{ name?: string }>;
}

export function selectIPv4Address(service: Service): string | undefined {
  const addresses = service.addresses ?? [];
  return (
    addresses.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a) && !a.startsWith('127.')) ??
    addresses[0] ??
    service.host
  );
}

export function discoverLocalHomeKitAccessories(
  timeoutMs = 1500,
): Promise<DiscoveredHomeKitItem[]> {
  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredHomeKitItem>();
    let bonjour: Bonjour | undefined;
    try {
      bonjour = new Bonjour();
      const browser = bonjour.find({ type: 'hap' }, (service: Service) => {
        const txt = (service.txt ?? {}) as Record<string, string | undefined>;
        const id = (txt.id ?? txt.ID ?? '').toUpperCase();
        const address = selectIPv4Address(service);
        if (!id || !address || !service.port) return;
        const sf = parseInt(txt.sf ?? '1', 10);
        const ci = parseInt(txt.ci ?? '1', 10);
        const cNum = parseInt(txt['c#'] ?? '1', 10);
        found.set(id, {
          id,
          name: service.name || txt.md || id,
          model: txt.md,
          address,
          port: service.port,
          category: Number.isFinite(ci) ? ci : 1,
          paired: sf === 0,
          configNumber: Number.isFinite(cNum) ? cNum : 1,
        });
      });
      browser.start();
      setTimeout(() => {
        try {
          browser.stop();
          bonjour?.destroy();
        } catch {
          // ignore
        }
        resolve(Array.from(found.values()));
      }, timeoutMs);
    } catch {
      try {
        bonjour?.destroy();
      } catch {
        // ignore
      }
      resolve([]);
    }
  });
}

function matchEntryForDomain(
  domain: string,
  entries?: ReadonlyArray<{ entry_id?: unknown; domain?: unknown }>,
): string | undefined {
  if (!entries?.length) return undefined;
  const hit = entries.find((e) => e.domain === domain && typeof e.entry_id === 'string');
  return typeof hit?.entry_id === 'string' ? hit.entry_id : undefined;
}

export function configEntryIdForDevice(
  device: HubDevice,
  entries?: ReadonlyArray<{ entry_id?: unknown; domain?: unknown }>,
): string | undefined {
  const inst = device.sourceInstanceId ?? '';
  if (inst && entries?.some((e) => e.entry_id === inst)) return inst;

  if (inst.startsWith('app:')) {
    const domain = inst.slice('app:'.length);
    return matchEntryForDomain(domain, entries) ?? inst;
  }
  for (const prefix of ['homebridge:', 'scrypted:', 'hacs:'] as const) {
    if (inst.startsWith(prefix)) {
      const domain = inst.slice(prefix.length);
      return matchEntryForDomain(domain, entries) ?? inst;
    }
  }
  if (inst === 'kitsune') {
    const maybeDomain = device.id.split(':')[1];
    if (maybeDomain) {
      return matchEntryForDomain(maybeDomain, entries) ?? `app:${maybeDomain}`;
    }
  }

  if (device.protocol === 'mqtt') return matchEntryForDomain('mqtt', entries) ?? 'mqtt';
  if (device.protocol === 'zigbee') return matchEntryForDomain('zigbee', entries) ?? 'zigbee';
  if (device.protocol === 'thread') return matchEntryForDomain('thread', entries) ?? 'thread';
  const matterMatch = device.id.match(/^matter_node_(\d+)_/);
  if (matterMatch) return `matter_node_${matterMatch[1]}`;
  const hkMatch = device.id.match(/^hk_([a-f0-9]+)_aid_/i);
  if (hkMatch) return `homekit:${hkMatch[1].toLowerCase()}`;
  if (device.protocol === 'homekit' || device.protocol === 'hap-ip') {
    return matchEntryForDomain('homekit_controller', entries) ?? 'homekit_controller';
  }

  if (device.protocol) {
    const byProto = matchEntryForDomain(device.protocol, entries);
    if (byProto) return byProto;
  }
  const parts = device.id.split(':');
  if (parts[0] === 'tuya') {
    const byTuya = matchEntryForDomain('tuya', entries);
    if (byTuya) return byTuya;
  }
  if (parts.length > 1 && parts[1]) {
    const byIdDomain = matchEntryForDomain(parts[1], entries);
    if (byIdDomain) return byIdDomain;
  }
  if (inst && inst !== 'standalone' && inst !== 'hub') return inst;
  return undefined;
}

export function buildHubManifests(): Array<{ domain: string; name: string }> {
  return [
    { domain: 'homekit_controller', name: 'HomeKit Device' },
    { domain: 'matter', name: 'Matter' },
    { domain: 'mqtt', name: 'MQTT' },
    { domain: 'tuya', name: 'Tuya' },
    { domain: 'xiaomi_miot', name: 'Xiaomi Miot Auto' },
    { domain: 'yeelight', name: 'Yeelight' },
    { domain: 'meross_lan', name: 'Meross LAN' },
    { domain: 'govee', name: 'Govee' },
    { domain: 'homebridge-govee', name: 'Homebridge Govee' },
    { domain: 'sensibo', name: 'Sensibo' },
    { domain: 'hue', name: 'Philips Hue Bridge' },
    { domain: 'zigbee', name: 'Zigbee' },
    { domain: 'thread', name: 'Thread' },
    { domain: 'eero', name: 'Eero Mesh Router' },
    { domain: 'transmission', name: 'Transmission Torrent' },
    { domain: 'speedtestdotnet', name: 'SpeedTest.net' },
    { domain: 'openweathermap', name: 'OpenWeatherMap' },
    { domain: 'telegram_bot', name: 'Telegram Bot' },
  ];
}

export function buildHubConfigEntries(
  devices: readonly HubDevice[],
  pairings: readonly PersistedHomeKitPairingItem[],
  appsInventory?: unknown,
  integrationsPayload?: unknown,
): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];
  const seenIds = new Set<string>();

  if (
    integrationsPayload &&
    typeof integrationsPayload === 'object' &&
    'entries' in integrationsPayload &&
    Array.isArray((integrationsPayload as { entries?: unknown }).entries)
  ) {
    for (const raw of (integrationsPayload as { entries: unknown[] }).entries) {
      if (!raw || typeof raw !== 'object') continue;
      const entry = raw as Record<string, unknown>;
      const entryId = typeof entry.entry_id === 'string' ? entry.entry_id : undefined;
      const domain = typeof entry.domain === 'string' ? entry.domain : undefined;
      if (!entryId || !domain || seenIds.has(entryId)) continue;
      seenIds.add(entryId);
      entries.push({
        supports_options: true,
        supports_reconfigure: true,
        supports_remove_device: true,
        supports_unload: true,
        ...entry,
      });
    }
  }

  if (devices.some((d) => d.protocol === 'mqtt') && !seenIds.has('mqtt')) {
    seenIds.add('mqtt');
    entries.push({
      entry_id: 'mqtt',
      domain: 'mqtt',
      title: 'MQTT Broker',
      state: 'loaded',
      disabled_by: null,
      supports_unload: false,
    });
  }

  if (
    appsInventory &&
    typeof appsInventory === 'object' &&
    'apps' in appsInventory &&
    Array.isArray((appsInventory as { apps?: unknown }).apps)
  ) {
    for (const rawApp of (appsInventory as { apps: unknown[] }).apps) {
      if (!rawApp || typeof rawApp !== 'object') continue;
      const app = rawApp as {
        id?: unknown;
        name?: unknown;
        state?: unknown;
        version?: unknown;
        source?: { externalId?: unknown; runtime?: unknown };
      };
      const externalId =
        typeof app.source?.externalId === 'string'
          ? app.source.externalId
          : typeof app.id === 'string'
            ? app.id
            : undefined;
      if (!externalId) continue;
      const entryId = `app:${externalId}`;
      if (seenIds.has(entryId) || entries.some((e) => e.domain === externalId)) continue;
      seenIds.add(entryId);
      entries.push({
        entry_id: entryId,
        domain: externalId,
        title: typeof app.name === 'string' && app.name ? app.name : externalId,
        state: app.state === 'stopped' ? 'not_loaded' : 'loaded',
        disabled_by: app.state === 'stopped' ? 'user' : null,
        supports_options: true,
        supports_reconfigure: true,
        supports_unload: true,
        ...(typeof app.version === 'string' ? { version: app.version } : {}),
        ...(typeof app.source?.runtime === 'string' ? { runtimeType: app.source.runtime } : {}),
      });
    }
  }

  const matterNodes = new Map<string, string>();
  for (const dev of devices) {
    const m = dev.id.match(/^matter_node_(\d+)_/);
    if (m) {
      const nodeId = m[1];
      if (!matterNodes.has(nodeId) || dev.id.endsWith('_bridge')) {
        matterNodes.set(nodeId, dev.name || `Matter Node ${nodeId}`);
      }
    }
  }
  for (const [nodeId, title] of matterNodes) {
    const entryId = `matter_node_${nodeId}`;
    if (seenIds.has(entryId)) continue;
    seenIds.add(entryId);
    entries.push({
      entry_id: entryId,
      domain: 'matter',
      title,
      state: 'loaded',
      disabled_by: null,
      supports_unload: true,
    });
  }

  for (const p of pairings) {
    const slug = p.accessoryId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const entryId = `homekit:${slug}`;
    if (seenIds.has(entryId)) continue;
    seenIds.add(entryId);
    entries.push({
      entry_id: entryId,
      domain: 'homekit_controller',
      title: `${p.name} (${p.address})`,
      state: 'loaded',
      disabled_by: null,
      supports_unload: true,
    });
  }

  for (const dev of devices) {
    const derived = configEntryIdForDevice(dev, entries);
    if (!derived || seenIds.has(derived)) continue;
    seenIds.add(derived);
    const colon = derived.indexOf(':');
    const domain = colon > 0 ? derived.slice(colon + 1) : derived;
    entries.push({
      entry_id: derived,
      domain,
      title: dev.manufacturer || domain,
      state: 'loaded',
      disabled_by: null,
      supports_unload: true,
    });
  }

  return entries;
}

export function buildHaDeviceRecord(
  device: HubDevice,
  entryId: string | undefined,
): {
  id: string;
  name: string;
  name_by_user: null;
  area_id: string | null;
  manufacturer: string | null;
  model: string | null;
  sw_version?: string;
  hw_version?: string;
  category: string | null;
  config_entries?: string[];
} {
  return {
    id: device.id,
    name: device.name,
    name_by_user: null,
    area_id: device.roomId && device.roomId !== 'unassigned' ? device.roomId : null,
    manufacturer: device.manufacturer ?? null,
    model: device.model ?? null,
    ...(device.firmwareVersion && { sw_version: device.firmwareVersion }),
    ...(device.hardwareVersion && { hw_version: device.hardwareVersion }),
    category: device.category ?? null,
    ...(entryId && { config_entries: [entryId] }),
  };
}
