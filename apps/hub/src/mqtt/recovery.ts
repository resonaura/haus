/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Logger } from '@nestjs/common';
import { inferDeviceCategory, type MqttDiscoveryClaim } from '@haus/mqtt';
import type { StandaloneHomeService } from '../home/home.service.js';
import type { MqttIdentities } from './identity.js';
import { withoutMqttSource } from './sources.js';
import { MemoryMqttStaleStore, type MqttStaleStore } from './stale-store.js';
import {
  isMqttGoveeOutletSuppressionActive,
  pruneSupersededMqttGoveeOutlets,
} from './govee-hybrid.js';

export const DEFAULT_MQTT_STALE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_MQTT_STALE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export interface MqttRecoveryOptions {
  readonly staleStore?: MqttStaleStore;
  readonly hasLiveBinding?: (endpointId: string) => boolean;
  readonly staleGraceMs?: number;
  readonly staleSweepIntervalMs?: number;
  readonly now?: () => number;
  readonly logger?: Pick<Logger, 'log' | 'warn'>;
}

/**
 * Reconciles explicitly owned MQTT records after retained replay.
 * Explicit retained tombstones are applied immediately; unclaimed MQTT devices/endpoints
 * are preserved across restarts and only pruned after a generous persisted grace period.
 */
export class MqttRecovery {
  private readonly staleStore: MqttStaleStore;
  private readonly hasLiveBinding: (endpointId: string) => boolean;
  private readonly staleGraceMs: number;
  private readonly staleSweepIntervalMs: number;
  private readonly now: () => number;
  private readonly logger?: Pick<Logger, 'log' | 'warn'>;
  private readonly trackedStale = new Map<string, number>();
  private staleLoaded = false;
  private sweepTimer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    private readonly home: StandaloneHomeService,
    private readonly identities: MqttIdentities,
    private readonly synthetic: Set<string>,
    options: MqttRecoveryOptions = {},
  ) {
    this.staleStore = options.staleStore ?? new MemoryMqttStaleStore();
    this.hasLiveBinding = options.hasLiveBinding ?? (() => false);
    this.staleGraceMs = Math.max(0, options.staleGraceMs ?? DEFAULT_MQTT_STALE_GRACE_MS);
    this.staleSweepIntervalMs = Math.max(
      0,
      options.staleSweepIntervalMs ?? DEFAULT_MQTT_STALE_SWEEP_INTERVAL_MS,
    );
    this.now = options.now ?? (() => Date.now());
    this.logger = options.logger;
  }

  startSweep(): void {
    if (this.sweepTimer || this.staleSweepIntervalMs <= 0) return;
    this.sweepTimer = setInterval(() => {
      void this.sweepStale().catch(() => this.logger?.warn('mqtt_stale_sweep_failed'));
    }, this.staleSweepIntervalMs);
    this.sweepTimer.unref();
  }

  stopSweep(): void {
    if (!this.sweepTimer) return;
    clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
  }

  async markAlive(endpointIds: Iterable<string>): Promise<void> {
    const toClear: string[] = [];
    for (const id of endpointIds) {
      if (!this.staleLoaded || this.trackedStale.has(id)) {
        this.trackedStale.delete(id);
        toClear.push(id);
      }
    }
    if (toClear.length > 0) await this.staleStore.clear(toClear);
  }

  async run(
    claims: readonly MqttDiscoveryClaim[],
    tombstonedClaims: readonly MqttDiscoveryClaim[] = [],
  ): Promise<void> {
    const currentNow = this.now();
    const devices = this.home.listDevices();
    const managed = await this.identities.managedDevices();
    const owned = await this.identities.ownedEndpoints(
      new Set([
        ...Object.keys(this.home.listEndpointStates()),
        ...devices.flatMap((device) => device.endpoints.map((endpoint) => endpoint.id)),
      ]),
    );
    const canonical = await this.identities.canonicalDeviceIds([
      ...claims.map((claim) => claim.device),
      ...tombstonedClaims.map((claim) => claim.device),
      ...[...owned.values()].map((owner) => owner.device),
    ]);
    const deviceId = (rawId: string) => canonical.get(rawId) ?? rawId;
    const activeDevices = new Set(claims.map((claim) => deviceId(claim.device)));
    const activeEntities = new Set(
      claims
        .filter((claim) => claim.kind === 'endpoint')
        .map((claim) => JSON.stringify([deviceId(claim.device), claim.component, claim.uniqueId])),
    );
    const tombstonedDevices = new Set(tombstonedClaims.map((claim) => deviceId(claim.device)));
    const tombstonedEntities = new Set(
      tombstonedClaims
        .filter((claim) => claim.kind === 'endpoint')
        .map((claim) => JSON.stringify([deviceId(claim.device), claim.component, claim.uniqueId])),
    );

    const staleRecords = await this.staleStore.load();
    this.trackedStale.clear();
    for (const [id, firstMissingAt] of staleRecords) this.trackedStale.set(id, firstMissingAt);
    this.staleLoaded = true;

    const existingDeviceEndpoints = new Set(
      devices.flatMap((device) => device.endpoints.map((endpoint) => endpoint.id)),
    );
    const newlyMissing = new Map<string, number>();
    const clearedStale = new Set<string>();
    for (const id of staleRecords.keys()) {
      if (!existingDeviceEndpoints.has(id)) clearedStale.add(id);
    }

    for (const [id, ownership] of owned) if (ownership.kind === 'synthetic') this.synthetic.add(id);
    const removed = new Set<string>();
    let prunedStaleCount = 0;

    for (const device of devices) {
      if (!managed.has(device.id)) continue;
      const endpoints = device.endpoints.flatMap((endpoint) => {
        const owner = owned.get(endpoint.id);
        if (!owner) return [endpoint];
        const ownerDevice = deviceId(owner.device);
        const entityKey =
          owner.kind === 'entity'
            ? JSON.stringify([ownerDevice, owner.component, owner.uniqueId])
            : undefined;
        const claimed =
          owner.kind === 'synthetic'
            ? activeDevices.has(ownerDevice)
            : activeEntities.has(entityKey!) || this.hasLiveBinding(endpoint.id);
        if (claimed) {
          if (staleRecords.has(endpoint.id)) clearedStale.add(endpoint.id);
          return [endpoint];
        }
        const tombstoned =
          owner.kind === 'synthetic'
            ? tombstonedDevices.has(ownerDevice)
            : tombstonedEntities.has(entityKey!);
        if (tombstoned) {
          if (staleRecords.has(endpoint.id)) clearedStale.add(endpoint.id);
          return withoutMqttSource(endpoint) ?? [];
        }
        const firstMissingAt = staleRecords.get(endpoint.id) ?? currentNow;
        if (this.staleGraceMs > 0 && currentNow - firstMissingAt < this.staleGraceMs) {
          if (!staleRecords.has(endpoint.id)) {
            newlyMissing.set(endpoint.id, firstMissingAt);
            this.trackedStale.set(endpoint.id, firstMissingAt);
          }
          return [endpoint];
        }
        if (staleRecords.has(endpoint.id)) clearedStale.add(endpoint.id);
        prunedStaleCount += 1;
        return withoutMqttSource(endpoint) ?? [];
      });
      if (
        endpoints.every((endpoint, index) => endpoint === device.endpoints[index]) &&
        endpoints.length === device.endpoints.length
      )
        continue;
      for (const endpoint of device.endpoints)
        if (!endpoints.some((candidate) => candidate.id === endpoint.id)) removed.add(endpoint.id);
      this.applyUpdatedEndpoints(device, endpoints);
    }

    const retained = new Set(
      this.home.listDevices().flatMap((device) => device.endpoints.map((endpoint) => endpoint.id)),
    );
    for (const [id, owner] of owned) {
      const ownerDevice = deviceId(owner.device);
      const stillClaimed =
        owner.kind === 'synthetic'
          ? activeDevices.has(ownerDevice)
          : activeEntities.has(JSON.stringify([ownerDevice, owner.component, owner.uniqueId])) ||
            this.hasLiveBinding(id);
      if (!retained.has(id) && !stillClaimed) removed.add(id);
    }
    for (const id of removed) {
      this.home.removeEndpointState(id);
      this.synthetic.delete(id);
      if (staleRecords.has(id) || newlyMissing.has(id)) {
        newlyMissing.delete(id);
        clearedStale.add(id);
      }
    }
    for (const id of clearedStale) this.trackedStale.delete(id);
    await this.staleStore.markMissing(newlyMissing);
    await this.staleStore.clear(clearedStale);
    if (prunedStaleCount > 0) {
      this.logger?.log(`Pruned ${prunedStaleCount} stale MQTT endpoint(s) after grace period.`);
    }
    if (isMqttGoveeOutletSuppressionActive(this.home)) {
      pruneSupersededMqttGoveeOutlets(this.home);
    }
  }

  async sweepStale(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      if (!this.staleLoaded) {
        const staleRecords = await this.staleStore.load();
        this.trackedStale.clear();
        for (const [id, firstMissingAt] of staleRecords) this.trackedStale.set(id, firstMissingAt);
        this.staleLoaded = true;
      }
      if (this.trackedStale.size === 0) return 0;
      const currentNow = this.now();
      const aliveIds: string[] = [];
      const expiredIds = new Set<string>();
      for (const [id, firstMissingAt] of this.trackedStale) {
        if (this.hasLiveBinding(id)) {
          aliveIds.push(id);
        } else if (this.staleGraceMs <= 0 || currentNow - firstMissingAt >= this.staleGraceMs) {
          expiredIds.add(id);
        }
      }
      if (aliveIds.length > 0) {
        for (const id of aliveIds) this.trackedStale.delete(id);
        await this.staleStore.clear(aliveIds);
      }
      if (expiredIds.size === 0) return 0;

      const devices = this.home.listDevices();
      const managed = await this.identities.managedDevices();
      const owned = await this.identities.ownedEndpoints(expiredIds);
      const removed = new Set<string>();
      let prunedCount = 0;

      for (const device of devices) {
        if (!managed.has(device.id)) continue;
        if (!device.endpoints.some((endpoint) => expiredIds.has(endpoint.id))) continue;
        const endpoints = device.endpoints.flatMap((endpoint) => {
          if (!expiredIds.has(endpoint.id) || this.hasLiveBinding(endpoint.id)) return [endpoint];
          if (!owned.has(endpoint.id)) return [endpoint];
          prunedCount += 1;
          return withoutMqttSource(endpoint) ?? [];
        });
        if (
          endpoints.every((endpoint, index) => endpoint === device.endpoints[index]) &&
          endpoints.length === device.endpoints.length
        )
          continue;
        for (const endpoint of device.endpoints)
          if (!endpoints.some((candidate) => candidate.id === endpoint.id))
            removed.add(endpoint.id);
        this.applyUpdatedEndpoints(device, endpoints);
      }

      for (const id of removed) {
        this.home.removeEndpointState(id);
        this.synthetic.delete(id);
      }
      for (const id of expiredIds) this.trackedStale.delete(id);
      await this.staleStore.clear(expiredIds);
      if (prunedCount > 0) {
        this.logger?.log(`Pruned ${prunedCount} stale MQTT endpoint(s) after grace period.`);
      }
      return prunedCount;
    } finally {
      this.sweeping = false;
    }
  }

  private applyUpdatedEndpoints(
    device: ReturnType<StandaloneHomeService['listDevices']>[number],
    endpoints: ReturnType<StandaloneHomeService['listDevices']>[number]['endpoints'],
  ): void {
    if (!endpoints.length) {
      this.home.removeDevice(device.id);
      return;
    }
    this.home.registerDevice({
      ...device,
      endpoints,
      services: [],
      category: inferDeviceCategory({
        id: device.source.externalId,
        name: device.name,
        model: device.model,
        endpoints,
      }),
    });
  }
}
