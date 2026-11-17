/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Logger } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import type { HausDevice, SourceServiceRef } from '@haus/core';
import {
  HacsVirtualizer,
  type HaFlowRuntime,
  type HaSyncEntryInput,
  type HaRuntimeEntity,
} from '@haus/kitsune';
import type { StandaloneHomeService } from '../../home/home.service.js';
import type { IntegrationEntryState } from '../entry-helpers.js';

type IntegrationRuntime = Pick<
  HaFlowRuntime,
  'setupEntry' | 'entitySnapshot' | 'entityCommand' | 'unloadEntry'
>;

/** Projects observations from the integration owner and routes commands back to that owner. */
export class HaIntegrationEntities {
  private readonly logger = new Logger(HaIntegrationEntities.name);
  private timer?: NodeJS.Timeout;
  private polling?: Promise<void>;
  private runtime?: IntegrationRuntime;
  private readonly projections = new Map<string, HacsVirtualizer>();
  private readonly unregister = new Map<string, () => void>();
  private readonly activated = new Set<string>();
  private readonly retryAt = new Map<string, number>();
  private readonly fingerprints = new Map<string, string>();
  private readonly states = new Map<string, IntegrationEntryState>();
  private readonly configs = new Map<string, string>();
  private readonly observed = new Set<string>();
  private entries: readonly HaSyncEntryInput[] = [];
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
      this.runtime = runtime;
      this.activated.clear();
      this.fingerprints.clear();
      this.retryAt.clear();
      this.states.clear();
      this.configs.clear();
      this.eventSequence = 0;
      this.observed.clear();
    }
    this.entries = entries.filter((entry) => !entry.disabledBy && entry.domain !== 'tuya');
    const enabled = new Set(this.entries.map((entry) => entry.entryId));
    for (const [id, unregister] of this.unregister) {
      if (enabled.has(id)) continue;
      unregister();
      this.unregister.delete(id);
      this.projections.delete(id);
      this.activated.delete(id);
      this.fingerprints.clear();
      this.markOffline(id);
      void runtime
        .unloadEntry(id)
        .catch(() => this.logger.warn('Could not unload an integration.'));
    }
    this.timer ??= setInterval(() => void this.poll(), 2_000);
    this.timer.unref();
    void this.poll();
  }

  async close(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    for (const unregister of this.unregister.values()) unregister();
    await this.polling;
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
        const device = created
          .getDevices()
          .find((item) => item.endpoints.some((endpoint) => endpoint.id === endpointId));
        if (!device) throw Error('integration_entity_unavailable');
        let value: unknown = parameters?.value;
        if (command === 'turn_on') value = true;
        if (command === 'turn_off') value = false;
        if (command === 'toggle') value = !this.home?.getEndpointProperty(endpointId, 'on_off');
        await created.executeCommand({
          deviceId: device.id,
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
      .catch(() => {
        this.markOffline();
        this.fingerprints.clear();
        this.activated.clear();
        this.retryAt.clear();
        this.eventSequence = 0;
        this.logger.warn('Integration entity refresh unavailable.');
      })
      .finally(() => {
        this.polling = undefined;
      });
    return this.polling;
  }

  private async refresh(): Promise<void> {
    await this.ensureReady?.();
    const runtime = this.runtime;
    if (!runtime) return;
    for (const entry of this.entries) {
      if (this.stopped || runtime !== this.runtime) return;
      if (this.activated.has(entry.entryId) || (this.retryAt.get(entry.entryId) ?? 0) > Date.now())
        continue;
      try {
        const setup = await runtime.setupEntry(entry.entryId);
        if (
          runtime !== this.runtime ||
          !this.entries.some((item) => item.entryId === entry.entryId)
        )
          return;
        if (setup.ok) {
          this.activated.add(entry.entryId);
          this.projection(entry.entryId);
        } else
          this.retryAt.set(
            entry.entryId,
            Date.now() + (setup.state === 'setup_in_progress' ? 2_000 : 30_000),
          );
      } catch {
        this.retryAt.set(entry.entryId, Date.now() + 30_000);
        this.logger.warn(`Integration setup unavailable for ${entry.domain}.`);
      }
    }
    const snapshot = await runtime.entitySnapshot(this.eventSequence);
    if (this.stopped || runtime !== this.runtime) return;
    const enabled = new Set(this.entries.map((entry) => entry.entryId));
    this.markOffline(
      undefined,
      new Set(snapshot.entities.map((entity) => `ha:${entity.entryId}:${entity.deviceId}`)),
    );
    for (const entry of snapshot.entries ?? []) {
      if (!enabled.has(entry.entryId)) continue;
      if (entry.config) {
        const fingerprint = JSON.stringify(entry.config);
        if (this.configs.get(entry.entryId) !== fingerprint) {
          await this.onEntry?.(entry.config);
          this.configs.set(entry.entryId, fingerprint);
          this.states.delete(entry.entryId);
        }
      }
      const state =
        entry.state === 'loaded'
          ? 'loaded'
          : entry.state === 'setup_retry'
            ? 'setup_retry'
            : entry.state === 'not_loaded' || entry.state === 'setup_in_progress'
              ? 'not_loaded'
              : 'setup_error';
      if (this.states.get(entry.entryId) !== state) {
        await this.onState?.(entry.entryId, state);
        this.states.set(entry.entryId, state);
      }
      if (state !== 'loaded') {
        this.activated.delete(entry.entryId);
        this.markOffline(entry.entryId);
        this.fingerprints.clear();
      }
    }
    const changed = new Map<string, HaRuntimeEntity>();
    for (const entity of snapshot.entities) {
      if (!enabled.has(entity.entryId)) continue;
      const fingerprint = JSON.stringify(entity);
      if (this.fingerprints.get(entity.entityId) === fingerprint) continue;
      this.fingerprints.set(entity.entityId, fingerprint);
      const projection = this.projection(entity.entryId);
      projection.handleEntityAdded({
        ...entity,
        deviceId: `ha:${entity.entryId}:${entity.deviceId}`,
      });
      changed.set(`ha:${entity.entryId}:${entity.deviceId}`, entity);
    }
    for (const [id, entity] of changed) {
      const device = this.projection(entity.entryId).getDevice(id);
      if (!device) continue;
      const existing = this.home?.getDevice(id);
      const source = this.source(entity.entryId);
      const states = snapshot.entities
        .filter((item) => item.entryId === entity.entryId && item.deviceId === entity.deviceId)
        .map((item) => item.state);
      const normalized: HausDevice = {
        ...device,
        availability: states.some((state) => state !== 'unavailable' && state !== 'unknown')
          ? 'online'
          : states.includes('unavailable')
            ? 'offline'
            : 'unknown',
        name: existing?.name ?? entity.deviceName ?? device.name,
        source: { instanceId: `ha:${entity.entryId}`, externalId: entity.deviceId },
        sourceRefs: [
          { protocol: 'vendor', instanceId: entity.integration, externalId: entity.deviceId },
        ],
        manufacturer: entity.manufacturer,
        model: entity.model,
        roomId: existing?.roomId ?? this.resolveRoomId(entity),
        endpoints: device.endpoints.map((endpoint) => ({ ...endpoint, sourceOwner: source })),
      };
      const updates = normalized.endpoints.map((endpoint) => ({
        id: endpoint.id,
        patch: Object.fromEntries(
          Object.entries(endpoint.readings)
            .filter(
              ([key, reading]) =>
                !isDeepStrictEqual(this.home?.getEndpointProperty(endpoint.id, key), reading.value),
            )
            .map(([key, reading]) => [key, reading.value]),
        ),
        dispatch: this.observed.has(endpoint.id),
      }));
      this.home?.registerDevice(normalized);
      for (const update of updates) {
        if (Object.keys(update.patch).length)
          await this.home?.updateEndpointState(update.id, update.patch, update.dispatch, source);
        this.observed.add(update.id);
      }
    }
    for (const event of snapshot.events) {
      if (this.stopped) return;
      const entity = snapshot.entities.find((item) => item.entityId === event.entityId);
      if (entity && enabled.has(entity.entryId)) {
        await this.home?.dispatchAutomationEvent({
          type: 'event',
          eventType: event.eventType,
          endpointId: event.entityId,
        });
      }
    }
    this.eventSequence = snapshot.sequence;
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

  private markOffline(entryId?: string, present?: ReadonlySet<string>): void {
    for (const device of this.home?.listDevices() ?? []) {
      if (
        !device.source.instanceId.startsWith('ha:') ||
        (entryId && device.source.instanceId !== `ha:${entryId}`) ||
        present?.has(device.id)
      )
        continue;
      if (device.availability !== 'offline')
        this.home?.registerDevice({ ...device, availability: 'offline' });
      for (const endpoint of device.endpoints) this.fingerprints.delete(endpoint.id);
    }
  }
}
