/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import type { FlowDomainHandler, HausDevice } from '@haus/core';
import { ClusterStateStore } from '../../cluster/coordination/state.js';
import { STANDALONE_HOME_SERVICE, type StandaloneHomeService } from '../../home/home.service.js';
import type { PersistedIntegrationEntry } from '../entry-helpers.js';
import { createGenericNetworkFlowHandler } from './flow.js';
import { probeTcpReachability, type NetworkReachabilityProbe } from './probe.js';
import {
  GENERIC_NETWORK_DOMAIN,
  isNetworkDeviceType,
  networkDeviceTypeLabel,
  normalizeNetworkDeviceTarget,
  type NetworkDeviceEntryConfig,
} from './types.js';

const POLL_INTERVAL_MS = 60_000;

export function networkDeviceIdForEntry(entryId: string): string {
  return `net:${entryId}`;
}

export function networkEndpointIdForEntry(entryId: string): string {
  const safe = entryId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return `binary_sensor.${safe || 'network'}_status`;
}

export function extractNetworkEntryConfig(
  entry: PersistedIntegrationEntry,
): NetworkDeviceEntryConfig | undefined {
  const merged: Record<string, unknown> = { ...entry.data, ...entry.options };
  const normalized = normalizeNetworkDeviceTarget({
    host: merged.host ?? merged.management_url,
    scheme: merged.scheme,
    port: merged.port,
  });
  if (!normalized.ok) return undefined;
  const rawName = typeof merged.name === 'string' && merged.name.trim() ? merged.name.trim() : '';
  const name = rawName || entry.title || normalized.target.host;
  const deviceType = isNetworkDeviceType(merged.device_type) ? merged.device_type : 'router';
  return {
    ...normalized.target,
    name,
    deviceType,
  };
}

/** Manages Hub-native Generic Network Devices (routers, switches, repeaters, APs, NAS, etc.). */
@Injectable()
export class HubNetworkDeviceService implements OnModuleDestroy {
  private readonly tracked = new Map<
    string,
    { entry: PersistedIntegrationEntry; config: NetworkDeviceEntryConfig }
  >();
  private probe: NetworkReachabilityProbe = probeTcpReachability;
  private pollTimer?: NodeJS.Timeout;
  private destroyed = false;

  constructor(
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
    @Optional()
    @Inject(ClusterStateStore)
    private readonly clusterState?: ClusterStateStore,
  ) {}

  setProbeForTesting(probe: NetworkReachabilityProbe): void {
    this.probe = probe;
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.tracked.clear();
  }

  createFlowHandler(): FlowDomainHandler {
    return createGenericNetworkFlowHandler();
  }

  async restoreEntries(entries: readonly PersistedIntegrationEntry[]): Promise<void> {
    const networkEntries = entries.filter((entry) => entry.domain === GENERIC_NETWORK_DOMAIN);
    for (const entry of networkEntries) {
      await this.syncEntry(entry, { skipProbe: true });
    }
    if (networkEntries.length > 0 && !process.env.VITEST) {
      void this.pollAll().catch(() => undefined);
      this.ensurePollLoop();
    }
  }

  async syncEntry(
    entry: PersistedIntegrationEntry,
    options: { readonly skipProbe?: boolean } = {},
  ): Promise<HausDevice | undefined> {
    if (entry.domain !== GENERIC_NETWORK_DOMAIN || !this.homeService) return undefined;
    const config = extractNetworkEntryConfig(entry);
    if (!config) return undefined;

    this.tracked.set(entry.entry_id, { entry, config });
    const deviceId = networkDeviceIdForEntry(entry.entry_id);
    const endpointId = networkEndpointIdForEntry(entry.entry_id);
    const existing = this.homeService.getDevice(deviceId);
    const disabled = entry.disabled_by === 'user';
    const typeLabel = networkDeviceTypeLabel(config.deviceType);

    const device: HausDevice = {
      id: deviceId,
      name: config.name,
      category: 'network',
      deviceType: config.deviceType,
      availability: disabled ? 'offline' : 'online',
      manufacturer: 'Generic',
      model: typeLabel,
      roomId: existing?.roomId,
      areaId: existing?.areaId,
      connectivity: {
        protocol: 'local_ip',
        address: config.host,
      },
      source: {
        instanceId: entry.entry_id,
        externalId: config.managementUrl,
      },
      sourceRefs: [
        {
          protocol: 'virtual',
          instanceId: entry.entry_id,
          externalId: config.managementUrl,
        },
      ],
      opaqueMetadata: {
        managementUrl: config.managementUrl,
        host: config.host,
        scheme: config.scheme,
        ...(config.port !== undefined ? { port: config.port } : {}),
        networkDeviceType: config.deviceType,
      },
      endpoints: [
        {
          id: endpointId,
          name: 'Status',
          capabilities: [
            {
              id: 'connectivity',
              kind: 'binary',
              readable: true,
              operations: [],
              deviceClass: 'connectivity',
              name: 'Status',
            },
          ],
          readings: {},
        },
      ],
    };

    const registered = this.homeService.registerDevice(device);
    if (!disabled && !options.skipProbe) {
      await this.probeEntry(entry.entry_id);
    }
    if (!process.env.VITEST) {
      this.ensurePollLoop();
    }
    return registered;
  }

  async setEntryDisabled(entryId: string, disabled: boolean): Promise<void> {
    const record = this.tracked.get(entryId);
    if (!record) return;
    const nextEntry: PersistedIntegrationEntry = {
      ...record.entry,
      disabled_by: disabled ? 'user' : null,
      state: disabled ? 'not_loaded' : 'loaded',
    };
    await this.syncEntry(nextEntry, { skipProbe: disabled });
  }

  async removeEntry(entryId: string): Promise<void> {
    this.tracked.delete(entryId);
    this.homeService?.removeDevice(networkDeviceIdForEntry(entryId));
    if (this.tracked.size === 0 && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  async probeEntry(entryId: string): Promise<boolean> {
    if (this.destroyed || !this.homeService) return false;
    const record = this.tracked.get(entryId);
    if (!record || record.entry.disabled_by === 'user') return false;
    const reachable = await this.probe(record.config.host, record.config.probePort);
    if (this.destroyed || !this.tracked.has(entryId)) return reachable;
    const endpointId = networkEndpointIdForEntry(entryId);
    await this.homeService.updateEndpointState(endpointId, {
      connectivity: reachable,
      state: reachable ? 'on' : 'off',
      ip: record.config.host,
      url: record.config.managementUrl,
    });
    return reachable;
  }

  async pollAll(): Promise<void> {
    if (this.destroyed) return;
    const cluster = this.clusterState?.getStateSync();
    if (cluster && (cluster.fenced || cluster.role === 'fenced' || cluster.role === 'node')) {
      return;
    }
    const ids = Array.from(this.tracked.keys());
    await Promise.allSettled(ids.map((id) => this.probeEntry(id)));
  }

  private ensurePollLoop(): void {
    if (this.destroyed || this.pollTimer || this.tracked.size === 0) return;
    this.pollTimer = setInterval(() => {
      void this.pollAll().catch(() => undefined);
    }, POLL_INTERVAL_MS);
    this.pollTimer.unref?.();
  }
}
