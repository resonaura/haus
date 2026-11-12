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

export function configEntryIdForDevice(device: HubDevice): string | undefined {
  if (device.protocol === 'mqtt') return 'mqtt';
  const matterMatch = device.id.match(/^matter_node_(\d+)_/);
  if (matterMatch) return `matter_node_${matterMatch[1]}`;
  const hkMatch = device.id.match(/^hk_([a-f0-9]+)_aid_/i);
  if (hkMatch) return `homekit:${hkMatch[1].toLowerCase()}`;
  if (device.protocol === 'homekit' || device.protocol === 'hap-ip') return 'homekit_controller';
  return undefined;
}

export function buildHubManifests(): Array<{ domain: string; name: string }> {
  return [
    { domain: 'homekit_controller', name: 'HomeKit Device' },
    { domain: 'matter', name: 'Matter' },
    { domain: 'mqtt', name: 'MQTT' },
    { domain: 'meross_lan', name: 'Meross Smart Plug' },
    { domain: 'homebridge-govee', name: 'Govee Lights' },
    { domain: 'sensibo', name: 'Sensibo AirQ' },
    { domain: 'hue', name: 'Philips Hue Bridge' },
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
): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];

  if (devices.some((d) => d.protocol === 'mqtt')) {
    entries.push({
      entry_id: 'mqtt',
      domain: 'mqtt',
      title: 'MQTT Broker',
      state: 'loaded',
      disabled_by: null,
      supports_unload: false,
    });
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
    entries.push({
      entry_id: `matter_node_${nodeId}`,
      domain: 'matter',
      title,
      state: 'loaded',
      disabled_by: null,
      supports_unload: true,
    });
  }

  for (const p of pairings) {
    const slug = p.accessoryId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    entries.push({
      entry_id: `homekit:${slug}`,
      domain: 'homekit_controller',
      title: `${p.name} (${p.address})`,
      state: 'loaded',
      disabled_by: null,
      supports_unload: true,
    });
  }

  return entries;
}
