/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Logger } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import type { SourceServiceRef } from '@haus/core';
import {
  HacsVirtualizer,
  type HaFlowRuntime,
  type HaRuntimeEntity,
  type HaRuntimeEvent,
  type HaSyncEntryInput,
} from '@haus/kitsune';
import type { StandaloneHomeService } from '../../home/home.service.js';
import type { IntegrationEntryState } from '../entry-helpers.js';
import {
  deviceStructureChanged,
  mapHaEntryState,
  normalizeHaDevice,
  pruneSupersededHaDevices,
} from './projection.js';

type IntegrationRuntime = Pick<
  HaFlowRuntime,
  'setupEntry' | 'entitySnapshot' | 'entityCommand' | 'unloadEntry'
> &
  Partial<Pick<HaFlowRuntime, 'onEvent' | 'onEntityStates'>>;

const PUSH_RECONCILE_INTERVAL_MS = 60_000;
const POLL_FALLBACK_INTERVAL_MS = 2_000;
const FAST_SETUP_RECHECK_MS = 1_500;
const SETUP_CONCURRENCY = 6;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 300_000;

/** Projects observations from the integration owner and routes commands back to that owner. */
export class HaIntegrationEntities {
  private readonly logger = new Logger(HaIntegrationEntities.name);
  private timer?: NodeJS.Timeout;
  private fastPollTimer?: NodeJS.Timeout;
  private timerIntervalMs = 0;
  private polling?: Promise<void>;
  private readonly pushQueues = new Map<string, Promise<void>>();
  private runtime?: IntegrationRuntime;
  private readonly unsubPush: (() => void)[] = [];
  private readonly projections = new Map<string, HacsVirtualizer>();
  private readonly unregister = new Map<string, () => void>();
  private readonly activated = new Set<string>();
  private readonly retryAt = new Map<string, number>();
  private readonly failureCounts = new Map<string, number>();
  private readonly fingerprints = new Map<string, string>();
  private readonly states = new Map<string, IntegrationEntryState>();
  private readonly configs = new Map<string, string>();
  private readonly observed = new Set<string>();
  private readonly latestEntities = new Map<string, HaRuntimeEntity>();
  private readonly entitiesByDevice = new Map<string, Map<string, HaRuntimeEntity>>();
  private entries: readonly HaSyncEntryInput[] = [];
  private enabledEntries = new Set<string>();
  private eventSequence = 0;
  private stopped = false;

  constructor(
    private readonly home?: StandaloneHomeService,
    private readonly onState?: (entryId: string, state: IntegrationEntryState) => Promise<void>,
    private readonly onEntry?: (entry: HaSyncEntryInput) => Promise<void>,
    private readonly ensureReady?: () => Promise<unknown>,
  ) {}

  sync(runtime: IntegrationRuntime, entries: readonly HaSyncEntryInput[]): void {
    if (this.runtime !== runtime) {
      this.detachPushListeners();
      this.runtime = runtime;
      this.activated.clear();
      this.fingerprints.clear();
      this.retryAt.clear();
      this.failureCounts.clear();
      this.states.clear();
      this.configs.clear();
      this.latestEntities.clear();
      this.entitiesByDevice.clear();
      this.eventSequence = 0;
      this.observed.clear();
      this.attachPushListeners(runtime);
    }
    this.entries = entries.filter((entry) => !entry.disabledBy && entry.domain !== 'tuya');
    this.enabledEntries = new Set(this.entries.map((entry) => entry.entryId));
    for (const [id, unregister] of this.unregister) {
      if (this.enabledEntries.has(id)) continue;
      unregister();
      this.unregister.delete(id);
      this.projections.delete(id);
      this.activated.delete(id);
      this.retryAt.delete(id);
      this.failureCounts.delete(id);
      this.clearEntryCaches(id);
      this.markOffline(id);
      void runtime
        .unloadEntry(id)
        .catch(() => this.logger.warn('Could not unload an integration.'));
    }
    const desiredInterval =
      this.unsubPush.length > 0 ? PUSH_RECONCILE_INTERVAL_MS : POLL_FALLBACK_INTERVAL_MS;
    if (!this.timer || this.timerIntervalMs !== desiredInterval) {
      if (this.timer) clearInterval(this.timer);
      this.timerIntervalMs = desiredInterval;
      this.timer = setInterval(() => void this.poll(), desiredInterval);
      this.timer.unref();
    }
    void this.poll();
  }

  async close(): Promise<void> {
    this.stopped = true;
    this.detachPushListeners();
    clearInterval(this.timer);
    clearTimeout(this.fastPollTimer);
    for (const unregister of this.unregister.values()) unregister();
    await Promise.allSettled([this.polling, ...this.pushQueues.values()]);
  }

  private attachPushListeners(runtime: IntegrationRuntime): void {
    if (typeof runtime.onEvent === 'function') {
      this.unsubPush.push(runtime.onEvent((event) => this.handlePushedEvent(event)));
    }
    if (typeof runtime.onEntityStates === 'function') {
      this.unsubPush.push(
        runtime.onEntityStates((entities) => {
          if (this.stopped || this.runtime !== runtime || entities.length === 0) return;
          const byDevice = new Map<string, HaRuntimeEntity[]>();
          for (const entity of entities) {
            const key = `ha:${entity.entryId}:${entity.deviceId}`;
            const list = byDevice.get(key);
            if (list) list.push(entity);
            else byDevice.set(key, [entity]);
          }
          for (const [key, batch] of byDevice) {
            const prev = this.pushQueues.get(key) ?? Promise.resolve();
            const next = prev
              .then(() => this.applyEntities(batch, false))
              .catch(() => this.logger.warn('Integration state push failed.'));
            this.pushQueues.set(key, next);
            void next.finally(() => {
              if (this.pushQueues.get(key) === next) this.pushQueues.delete(key);
            });
          }
        }),
      );
    }
  }

  private detachPushListeners(): void {
    for (const unsub of this.unsubPush.splice(0)) unsub();
  }

  private clearEntryCaches(entryId: string): void {
    for (const [entityId, entity] of this.latestEntities) {
      if (entity.entryId !== entryId) continue;
      this.latestEntities.delete(entityId);
      this.fingerprints.delete(entityId);
      const devKey = `ha:${entity.entryId}:${entity.deviceId}`;
      this.entitiesByDevice.delete(devKey);
    }
  }

  private handlePushedEvent(event: HaRuntimeEvent): void {
    if (this.stopped || !this.home) return;
    if (event.sequence <= this.eventSequence) return;
    this.eventSequence = event.sequence;
    const entryId = event.entryId ?? this.latestEntities.get(event.entityId)?.entryId;
    if (!entryId || !this.enabledEntries.has(entryId)) return;
    void this.home
      .dispatchAutomationEvent({
        type: 'event',
        eventType: event.eventType,
        endpointId: event.entityId,
      })
      .catch(() => this.logger.warn('Integration event dispatch failed.'));
  }

  private source(entryId: string): SourceServiceRef {
    return { protocol: 'vendor', externalId: entryId, domain: 'ha' };
  }

  private projection(entryId: string): HacsVirtualizer {
    let projection = this.projections.get(entryId);
    if (projection) return projection;
    const created = new HacsVirtualizer(undefined, async (payload) => {
      const entityId = payload.serviceData?.entity_id;
      if (!this.runtime || typeof entityId !== 'string') throw Error('integration_unavailable');
      await this.runtime.entityCommand(
        entryId,
        entityId,
        payload.service,
        payload.serviceData ?? {},
      );
    });
    this.projections.set(entryId, created);
    const unregister = this.home?.registerCommandHandler(
      this.source(entryId),
      async (endpointId, capability, command, parameters) => {
        const deviceId =
          this.home?.devices.getDeviceByEndpointId(endpointId)?.id ??
          created
            .getDevices()
            .find((item) => item.endpoints.some((endpoint) => endpoint.id === endpointId))?.id;
        if (!deviceId) throw Error('integration_entity_unavailable');
        let value: unknown = parameters?.value;
        if (command === 'turn_on') value = true;
        if (command === 'turn_off') value = false;
        if (command === 'toggle') value = !this.home?.getEndpointProperty(endpointId, 'power');
        await created.executeCommand({
          deviceId,
          endpointId,
          capability,
          value,
          operation: command,
          parameters,
        });
      },
      { optimistic: false },
    );
    if (unregister) this.unregister.set(entryId, unregister);
    projection = created;
    return projection;
  }

  private poll(): Promise<void> {
    if (this.stopped || !this.home) return Promise.resolve();
    this.polling ??= this.refresh()
      .catch((error: unknown) => {
        this.markOffline();
        this.fingerprints.clear();
        this.latestEntities.clear();
        this.entitiesByDevice.clear();
        this.activated.clear();
        this.retryAt.clear();
        this.failureCounts.clear();
        this.eventSequence = 0;
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Integration entity refresh unavailable: ${detail}`);
      })
      .finally(() => {
        this.polling = undefined;
      });
    return this.polling;
  }

  private scheduleFastRecheck(): void {
    if (this.stopped || this.fastPollTimer) return;
    this.fastPollTimer = setTimeout(() => {
      this.fastPollTimer = undefined;
      void this.poll();
    }, FAST_SETUP_RECHECK_MS);
    this.fastPollTimer.unref();
  }

  private async setupPendingEntries(runtime: IntegrationRuntime): Promise<boolean> {
    const now = Date.now();
    const pending = this.entries.filter(
      (entry) =>
        !this.activated.has(entry.entryId) && (this.retryAt.get(entry.entryId) ?? 0) <= now,
    );
    let hasInProgress = false;
    for (let i = 0; i < pending.length; i += SETUP_CONCURRENCY) {
      if (this.stopped || runtime !== this.runtime) return false;
      const chunk = pending.slice(i, i + SETUP_CONCURRENCY);
      await Promise.allSettled(
        chunk.map(async (entry) => {
          try {
            const setup = await runtime.setupEntry(entry.entryId);
            if (runtime !== this.runtime || !this.enabledEntries.has(entry.entryId)) return;
            if (setup.ok) {
              this.activated.add(entry.entryId);
              this.failureCounts.delete(entry.entryId);
              this.retryAt.delete(entry.entryId);
              this.projection(entry.entryId);
            } else if (setup.state === 'setup_in_progress') {
              hasInProgress = true;
              this.retryAt.set(entry.entryId, Date.now() + FAST_SETUP_RECHECK_MS);
            } else {
              const fails = (this.failureCounts.get(entry.entryId) ?? 0) + 1;
              this.failureCounts.set(entry.entryId, fails);
              const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (fails - 1));
              this.retryAt.set(entry.entryId, Date.now() + delay);
            }
          } catch (error: unknown) {
            const fails = (this.failureCounts.get(entry.entryId) ?? 0) + 1;
            this.failureCounts.set(entry.entryId, fails);
            const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (fails - 1));
            this.retryAt.set(entry.entryId, Date.now() + delay);
            const detail = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Integration setup unavailable for ${entry.domain}: ${detail}`);
          }
        }),
      );
    }
    return hasInProgress;
  }

  private async refresh(): Promise<void> {
    await this.ensureReady?.();
    const runtime = this.runtime;
    if (!runtime) return;
    const hasInProgress = await this.setupPendingEntries(runtime);
    if (this.stopped || runtime !== this.runtime) return;
    const snapshot = await runtime.entitySnapshot(this.eventSequence);
    if (this.stopped || runtime !== this.runtime) return;
    const inProgressInstances = new Set(
      (snapshot.entries ?? [])
        .filter((entry) => entry.state === 'setup_in_progress')
        .map((entry) => `ha:${entry.entryId}`),
    );
    const present = new Set(
      snapshot.entities.map((entity) => `ha:${entity.entryId}:${entity.deviceId}`),
    );
    this.markOffline(undefined, present, inProgressInstances);
    for (const entry of snapshot.entries ?? []) {
      if (!this.enabledEntries.has(entry.entryId)) continue;
      if (entry.config) {
        const fingerprint = JSON.stringify(entry.config);
        if (this.configs.get(entry.entryId) !== fingerprint) {
          await this.onEntry?.(entry.config);
          this.configs.set(entry.entryId, fingerprint);
          this.states.delete(entry.entryId);
        }
      }
      const state = mapHaEntryState(entry.state);
      if (this.states.get(entry.entryId) !== state) {
        await this.onState?.(entry.entryId, state);
        this.states.set(entry.entryId, state);
      }
      if (entry.state === 'setup_in_progress') continue;
      if (state !== 'loaded') {
        this.activated.delete(entry.entryId);
        this.markOffline(entry.entryId);
        this.clearEntryCaches(entry.entryId);
      }
    }
    if (hasInProgress || inProgressInstances.size > 0) this.scheduleFastRecheck();
    await this.applyEntities(snapshot.entities, true);
    pruneSupersededHaDevices(this.home, this.enabledEntries, present, inProgressInstances);
    const missedEvents: HaRuntimeEvent[] = [];
    for (const event of snapshot.events) {
      if (event.sequence <= this.eventSequence) continue;
      this.eventSequence = event.sequence;
      const entryId = event.entryId ?? this.latestEntities.get(event.entityId)?.entryId;
      if (entryId && this.enabledEntries.has(entryId)) {
        missedEvents.push(event);
      }
    }
    if (snapshot.sequence > this.eventSequence) {
      this.eventSequence = snapshot.sequence;
    }
    if (missedEvents.length > 0 && !this.stopped) {
      await Promise.allSettled(
        missedEvents.map((event) =>
          this.home?.dispatchAutomationEvent({
            type: 'event',
            eventType: event.eventType,
            endpointId: event.entityId,
          }),
        ),
      );
    }
  }

  private async applyEntities(
    entities: readonly HaRuntimeEntity[],
    fullSnapshot: boolean,
  ): Promise<void> {
    const home = this.home;
    if (this.stopped || !home) return;
    if (fullSnapshot) {
      const seen = new Set(entities.map((e) => e.entityId));
      for (const [entityId, prev] of this.latestEntities) {
        if (!seen.has(entityId)) {
          this.latestEntities.delete(entityId);
          this.fingerprints.delete(entityId);
          this.entitiesByDevice.get(`ha:${prev.entryId}:${prev.deviceId}`)?.delete(entityId);
        }
      }
    }

    const changed = new Map<string, HaRuntimeEntity>();
    for (const entity of entities) {
      if (!this.enabledEntries.has(entity.entryId)) continue;
      const devKey = `ha:${entity.entryId}:${entity.deviceId}`;
      this.latestEntities.set(entity.entityId, entity);
      let bucket = this.entitiesByDevice.get(devKey);
      if (!bucket) {
        bucket = new Map();
        this.entitiesByDevice.set(devKey, bucket);
      }
      bucket.set(entity.entityId, entity);

      const fingerprint = JSON.stringify(entity);
      const existingDevice = home.devices.getDevice(devKey);
      const needsDeviceReconcile =
        fullSnapshot &&
        (!existingDevice ||
          (existingDevice.availability === 'offline' && entity.state !== 'unavailable'));
      if (this.fingerprints.get(entity.entityId) === fingerprint && !needsDeviceReconcile) continue;
      this.fingerprints.set(entity.entityId, fingerprint);
      const projection = this.projection(entity.entryId);
      projection.handleEntityAdded({
        ...entity,
        deviceId: devKey,
        deviceName: entity.deviceName ?? undefined,
      });
      changed.set(devKey, entity);
    }

    const pendingUpdates: Promise<void>[] = [];
    for (const [id, entity] of changed) {
      const device = this.projection(entity.entryId).getDevice(id);
      if (!device) continue;
      const existing = home.devices.getDevice(id);
      const source = this.source(entity.entryId);
      const deviceEntities = Array.from(this.entitiesByDevice.get(id)?.values() ?? [entity]);
      const normalized = normalizeHaDevice({
        device,
        existing,
        entity,
        deviceEntities,
        source,
        roomId: this.resolveRoomId(entity),
      });
      const updates = normalized.endpoints.map((endpoint) => {
        const previousState = home.getEndpointState(endpoint.id);
        const patch = Object.fromEntries(
          Object.entries(endpoint.readings)
            .filter(
              ([key, reading]) =>
                !isDeepStrictEqual(home.getEndpointProperty(endpoint.id, key), reading.value),
            )
            .map(([key, reading]) => [key, reading.value]),
        );
        return {
          id: endpoint.id,
          patch,
          previousState,
          dispatch: this.observed.has(endpoint.id),
        };
      });
      if (deviceStructureChanged(existing, normalized)) {
        this.home.registerDevice(normalized);
      }
      for (const update of updates) {
        if (Object.keys(update.patch).length > 0) {
          pendingUpdates.push(
            this.home.updateEndpointState(
              update.id,
              update.patch,
              update.dispatch,
              source,
              update.previousState,
            ),
          );
        }
        this.observed.add(update.id);
      }
    }
    if (pendingUpdates.length > 0) {
      await Promise.allSettled(pendingUpdates);
    }
  }

  private resolveRoomId(entity: HaRuntimeEntity): string {
    if (entity.areaName) {
      const name = entity.areaName.trim().toLocaleLowerCase();
      const match = this.home?.roomManager
        .listRooms()
        .find((room) => room.name.trim().toLocaleLowerCase() === name);
      if (match) return match.id;
    }
    if (entity.areaId && this.home?.roomManager.getRoom(entity.areaId)) return entity.areaId;
    return 'unassigned';
  }

  private markOffline(
    entryId?: string,
    present?: ReadonlySet<string>,
    inProgressInstances?: ReadonlySet<string>,
  ): void {
    for (const device of this.home?.devices.listDevices() ?? []) {
      if (!device.source.instanceId.startsWith('ha:')) continue;
      const deviceEntryId = device.source.instanceId.slice(3);
      if (entryId ? deviceEntryId !== entryId : !this.enabledEntries.has(deviceEntryId)) continue;
      if (present?.has(device.id) || inProgressInstances?.has(device.source.instanceId)) continue;
      if (device.availability !== 'offline')
        this.home?.registerDevice({ ...device, availability: 'offline' });
      for (const endpoint of device.endpoints) this.fingerprints.delete(endpoint.id);
    }
  }
}
