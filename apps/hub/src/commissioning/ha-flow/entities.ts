/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Logger } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import type { SourceServiceRef } from '@haus/core';
import {
  type HacsVirtualizer,
  type HaRuntimeEntity,
  type HaRuntimeEvent,
  type HaSyncEntryInput,
} from '@haus/kitsune';
import type { StandaloneHomeService } from '../../home/home.service.js';
import type { IntegrationEntryState } from '../entry-helpers.js';
import {
  createHaEntryProjection,
  dispatchHaAutomationEvent,
  groupHaEntitiesByDevice,
  isTransientRefreshTimeout,
  mapHaEntryState,
  markHaDevicesOffline,
  prepareHaDeviceUpdate,
  pruneSupersededHaDevices,
  type HaEntryStateCallback,
  type HaIntegrationRuntimePort,
} from './projection.js';

const PUSH_RECONCILE_INTERVAL_MS = 60_000;
const POLL_FALLBACK_INTERVAL_MS = 2_000;
const FAST_SETUP_RECHECK_MS = 1_500;
const SETUP_CONCURRENCY = 6;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;

/** Projects observations from the integration owner and routes commands back to that owner. */
export class HaIntegrationEntities {
  private readonly logger = new Logger(HaIntegrationEntities.name);
  private timer?: NodeJS.Timeout;
  private fastPollTimer?: NodeJS.Timeout;
  private fastPollDueAt = Number.POSITIVE_INFINITY;
  private timerIntervalMs = 0;
  private polling?: Promise<void>;
  private readonly pushQueues = new Map<string, Promise<void>>();
  private readonly inFlightUpdates = new Set<Promise<void>>();
  private readonly inFlightEndpoints = new Map<string, number>();
  private runtime?: HaIntegrationRuntimePort;
  private readonly unsubPush: (() => void)[] = [];
  private readonly projections = new Map<string, HacsVirtualizer>();
  private readonly unregister = new Map<string, () => void>();
  private readonly activated = new Set<string>();
  private readonly unsupported = new Set<string>();
  private readonly retryAt = new Map<string, number>();
  private readonly failureCounts = new Map<string, number>();
  private readonly states = new Map<string, IntegrationEntryState>();
  private readonly configs = new Map<string, string>();
  private readonly observed = new Set<string>();
  private readonly latestEntities = new Map<string, HaRuntimeEntity>();
  private readonly entitiesByDevice = new Map<string, Map<string, HaRuntimeEntity>>();
  private entries: readonly HaSyncEntryInput[] = [];
  private enabledEntries = new Set<string>();
  private eventSessionId?: string;
  private eventSequence = 0;
  private stopped = false;

  constructor(
    private readonly home?: StandaloneHomeService,
    private readonly onState?: HaEntryStateCallback,
    private readonly onEntry?: (entry: HaSyncEntryInput) => Promise<void>,
    private readonly ensureReady?: () => Promise<unknown>,
  ) {}

  sync(runtime: HaIntegrationRuntimePort, entries: readonly HaSyncEntryInput[]): void {
    if (this.runtime !== runtime) {
      this.detachPushListeners();
      this.runtime = runtime;
      this.resetWorkerSession(false, true);
      this.states.clear();
      this.configs.clear();
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
      this.unsupported.delete(id);
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

  forceRetryEntry(entryId: string): void {
    this.activated.delete(entryId);
    this.unsupported.delete(entryId);
    this.retryAt.delete(entryId);
    this.failureCounts.delete(entryId);
    this.states.delete(entryId);
  }
  async close(): Promise<void> {
    this.stopped = true;
    this.detachPushListeners();
    clearInterval(this.timer);
    clearTimeout(this.fastPollTimer);
    for (const unregister of this.unregister.values()) unregister();
    await Promise.allSettled([this.polling, ...this.pushQueues.values(), ...this.inFlightUpdates]);
  }

  private attachPushListeners(runtime: HaIntegrationRuntimePort): void {
    if (typeof runtime.onEvent === 'function') {
      this.unsubPush.push(runtime.onEvent((event) => this.handlePushedEvent(event)));
    }
    if (typeof runtime.onEntityStates === 'function') {
      this.unsubPush.push(
        runtime.onEntityStates((entities) => {
          if (this.stopped || this.runtime !== runtime || entities.length === 0) return;
          for (const [key, batch] of groupHaEntitiesByDevice(entities)) {
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
    if (typeof runtime.onWorkerExit === 'function') {
      this.unsubPush.push(
        runtime.onWorkerExit((reason) => {
          if (this.stopped || this.runtime !== runtime) return;
          this.logger.warn(`HA flow worker exited (${reason}); scheduling immediate recovery.`);
          this.resetWorkerSession(true, true);
          this.scheduleFastRecheck();
        }),
      );
    }
  }

  private detachPushListeners(): void {
    for (const unsub of this.unsubPush.splice(0)) unsub();
  }

  private resetWorkerSession(markOffline: boolean, resetEvents: boolean): void {
    if (markOffline) this.markOffline();
    this.latestEntities.clear();
    this.entitiesByDevice.clear();
    this.activated.clear();
    this.unsupported.clear();
    this.retryAt.clear();
    this.failureCounts.clear();
    if (resetEvents) {
      this.eventSessionId = undefined;
      this.eventSequence = 0;
    }
  }

  private syncEventSession(sessionId?: string): boolean {
    if (!sessionId || this.eventSessionId === sessionId) return false;
    this.eventSessionId = sessionId;
    this.eventSequence = 0;
    return true;
  }

  private clearEntryCaches(entryId: string): void {
    for (const [entityId, entity] of this.latestEntities) {
      if (entity.entryId !== entryId) continue;
      this.latestEntities.delete(entityId);
      const devKey = `ha:${entity.entryId}:${entity.deviceId}`;
      this.entitiesByDevice.delete(devKey);
    }
  }

  private dispatchHaEvent(event: HaRuntimeEvent, label: string): Promise<unknown> {
    return dispatchHaAutomationEvent(this.home, event, (msg) => this.logger.warn(msg), label);
  }

  private handlePushedEvent(event: HaRuntimeEvent): void {
    if (this.stopped || !this.home) return;
    this.syncEventSession(event.sessionId);
    if (event.sequence <= this.eventSequence) return;
    this.eventSequence = event.sequence;
    const entryId = event.entryId ?? this.latestEntities.get(event.entityId)?.entryId;
    if (!entryId || !this.enabledEntries.has(entryId)) {
      this.logger.warn(
        `Dropped integration event ${event.entityId}/${event.eventType} (entry=${entryId ?? 'unknown'}).`,
      );
      return;
    }
    void this.dispatchHaEvent(event, 'Integration event dispatch failed');
  }

  private source(entryId: string): SourceServiceRef {
    return { protocol: 'vendor', externalId: entryId, domain: 'ha' };
  }

  private projection(entryId: string): HacsVirtualizer {
    const existing = this.projections.get(entryId);
    if (existing) return existing;
    const { projection, unregister } = createHaEntryProjection({
      entryId,
      source: this.source(entryId),
      home: this.home,
      getRuntime: () => this.runtime,
    });
    this.projections.set(entryId, projection);
    if (unregister) this.unregister.set(entryId, unregister);
    return projection;
  }

  private poll(): Promise<void> {
    if (this.stopped || !this.home) return Promise.resolve();
    this.polling ??= this.refresh()
      .catch((error: unknown) => {
        if (!isTransientRefreshTimeout(error, this.runtime)) {
          this.resetWorkerSession(true, false);
        }
        this.scheduleFastRecheck();
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Integration entity refresh unavailable: ${detail}`);
      })
      .finally(() => {
        this.polling = undefined;
      });
    return this.polling;
  }

  private scheduleFastRecheck(delayMs = FAST_SETUP_RECHECK_MS): void {
    const dueAt = Date.now() + delayMs;
    if (this.stopped || (this.fastPollTimer && this.fastPollDueAt <= dueAt)) return;
    if (this.fastPollTimer) clearTimeout(this.fastPollTimer);
    this.fastPollDueAt = dueAt;
    this.fastPollTimer = setTimeout(() => {
      this.fastPollTimer = undefined;
      this.fastPollDueAt = Number.POSITIVE_INFINITY;
      void this.poll();
    }, delayMs);
    this.fastPollTimer.unref();
  }

  private scheduleSetupBackoff(entryId: string): void {
    const fails = (this.failureCounts.get(entryId) ?? 0) + 1;
    this.failureCounts.set(entryId, fails);
    this.retryAt.set(
      entryId,
      Date.now() + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (fails - 1)),
    );
  }

  private async setupPendingEntries(runtime: HaIntegrationRuntimePort): Promise<boolean> {
    const now = Date.now();
    const pending = this.entries.filter(
      (entry) =>
        !this.activated.has(entry.entryId) &&
        !this.unsupported.has(entry.entryId) &&
        (this.retryAt.get(entry.entryId) ?? 0) <= now,
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
            } else if (setup.state === 'not_supported') {
              this.unsupported.add(entry.entryId);
              this.retryAt.delete(entry.entryId);
            } else if (setup.state === 'setup_in_progress') {
              hasInProgress = true;
              this.retryAt.set(entry.entryId, Date.now() + FAST_SETUP_RECHECK_MS);
            } else {
              this.scheduleSetupBackoff(entry.entryId);
            }
          } catch (error: unknown) {
            this.scheduleSetupBackoff(entry.entryId);
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
    const prevSessionId = this.eventSessionId;
    const requestedSince = this.eventSequence;
    let snapshot = await runtime.entitySnapshot(requestedSince);
    if (this.stopped || runtime !== this.runtime) return;
    if (snapshot.sessionId) {
      const sessionChanged = this.syncEventSession(snapshot.sessionId);
      if (sessionChanged && prevSessionId && requestedSince > 0) {
        snapshot = await runtime.entitySnapshot(0);
        if (this.stopped || runtime !== this.runtime) return;
      }
    } else if (snapshot.sequence < this.eventSequence) {
      this.eventSequence = 0;
    }
    const inProgressInstances = new Set(
      (snapshot.entries ?? [])
        .filter((entry) => entry.state === 'setup_in_progress')
        .map((entry) => `ha:${entry.entryId}`),
    );
    const present = new Set(
      snapshot.entities.map((entity) => `ha:${entity.entryId}:${entity.deviceId}`),
    );
    this.markOffline(undefined, present, inProgressInstances);
    let droppedActiveEntry = false;
    for (const entry of snapshot.entries ?? []) {
      if (!this.enabledEntries.has(entry.entryId) || this.unsupported.has(entry.entryId)) continue;
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
        await this.onState?.(entry.entryId, state, entry.reason);
        this.states.set(entry.entryId, state);
      }
      if (entry.state === 'setup_in_progress') continue;
      if (state !== 'loaded') {
        if (this.activated.delete(entry.entryId)) {
          this.retryAt.delete(entry.entryId);
          droppedActiveEntry = true;
        }
        this.markOffline(entry.entryId);
        this.clearEntryCaches(entry.entryId);
      }
    }
    if (hasInProgress || inProgressInstances.size > 0 || droppedActiveEntry) {
      this.scheduleFastRecheck();
    } else if (this.retryAt.size > 0) {
      const soonest = Math.min(...this.retryAt.values());
      this.scheduleFastRecheck(Math.max(FAST_SETUP_RECHECK_MS, soonest - Date.now()));
    }
    await this.applyEntities(snapshot.entities, true);
    pruneSupersededHaDevices(this.home, this.enabledEntries, present, inProgressInstances);
    const missedEvents: HaRuntimeEvent[] = [];
    for (const event of snapshot.events) {
      this.syncEventSession(event.sessionId);
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
          this.dispatchHaEvent(event, 'Missed integration event dispatch failed'),
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
          this.entitiesByDevice.get(`ha:${prev.entryId}:${prev.deviceId}`)?.delete(entityId);
        }
      }
    }

    const changed = new Map<string, HaRuntimeEntity>();
    for (const entity of entities) {
      if (!this.enabledEntries.has(entity.entryId)) continue;
      const prevEntity = this.latestEntities.get(entity.entityId);
      const devKey = `ha:${entity.entryId}:${entity.deviceId}`;
      this.latestEntities.set(entity.entityId, entity);
      let bucket = this.entitiesByDevice.get(devKey);
      if (!bucket) {
        bucket = new Map();
        this.entitiesByDevice.set(devKey, bucket);
      }
      bucket.set(entity.entityId, entity);

      const existingDevice = home.devices.getDevice(devKey);
      const needsDeviceReconcile =
        fullSnapshot &&
        (!existingDevice ||
          (existingDevice.availability === 'offline' && entity.state !== 'unavailable'));
      if (prevEntity && isDeepStrictEqual(prevEntity, entity) && !needsDeviceReconcile) continue;
      this.projection(entity.entryId).handleEntityAdded({
        ...entity,
        deviceId: devKey,
        deviceName: entity.deviceName ?? undefined,
      });
      changed.set(devKey, entity);
    }

    const activeEndpoints =
      this.inFlightEndpoints.size > 0 ? new Set(this.inFlightEndpoints.keys()) : undefined;
    for (const [id, entity] of changed) {
      const device = this.projection(entity.entryId).getDevice(id);
      if (!device) continue;
      const source = this.source(entity.entryId);
      const prepared = prepareHaDeviceUpdate({
        home,
        device,
        existing: home.devices.getDevice(id),
        entity,
        deviceEntities: Array.from(this.entitiesByDevice.get(id)?.values() ?? [entity]),
        source,
        observed: this.observed,
        inFlightEndpoints: activeEndpoints,
      });
      if (prepared.structureChanged) home.registerDevice(prepared.normalized);
      for (const update of prepared.updates) {
        if (Object.keys(update.patch).length > 0) {
          this.inFlightEndpoints.set(update.id, (this.inFlightEndpoints.get(update.id) ?? 0) + 1);
          const task = home
            .updateEndpointState(
              update.id,
              update.patch,
              update.dispatch,
              source,
              update.previousState,
            )
            .catch((err: unknown) => {
              const detail = err instanceof Error ? err.message : String(err);
              if (!this.stopped && detail !== 'storage_closed') {
                this.logger.warn(`Integration state update failed (${update.id}): ${detail}`);
              }
            });
          this.inFlightUpdates.add(task);
          void task.finally(() => {
            this.inFlightUpdates.delete(task);
            const remaining = (this.inFlightEndpoints.get(update.id) ?? 1) - 1;
            if (remaining <= 0) this.inFlightEndpoints.delete(update.id);
            else this.inFlightEndpoints.set(update.id, remaining);
          });
        }
        this.observed.add(update.id);
      }
    }
  }

  private markOffline(
    entryId?: string,
    present?: ReadonlySet<string>,
    inProg?: ReadonlySet<string>,
  ) {
    markHaDevicesOffline(
      this.home,
      this.enabledEntries,
      this.latestEntities,
      entryId,
      present,
      inProg,
    );
  }
}
