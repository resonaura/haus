/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { HassEntity, HausAction, Snapshot } from './types.js';
import { LightOutputMemory } from './light-memory.js';
import { KETTLE_CONFIRMATION_MS, KettleConfirmations } from './kettle-confirmation.js';
import {
  isPatchEffectOnlyUnconfirmed,
  matches,
  prediction,
  restoredLightOverlay,
  type OptimisticPatch,
} from './optimistic/matching.js';

type Transaction = {
  id: number;
  sourceId: string;
  patches: OptimisticPatch[];
  createdAt: number;
  expiresAt: number;
  contextId?: string;
  acknowledged?: boolean;
  initiallySatisfied: boolean;
  kettle?: boolean;
};

/** Grace window after a post-command `on` report from a bridge that omits light `effect` telemetry. */
const EFFECT_ECHO_GRACE_MS = 4000;

export interface ExpireResult {
  readonly expired: number;
  readonly timedOut: number;
}

/** Separate server facts from reversible local intent, shared by every device surface. */
export class OptimisticState {
  readonly lightMemory = new LightOutputMemory();
  private nextId = 0;
  private transactions = new Map<number, Transaction>();
  private observations = new Map<string, { contextId?: string; at: number }>();
  private lastObservedEntities = new Map<string, HassEntity>();
  private contexts = new Map<string, number>();
  private confirmed = new Map<string, { id: number; at: number }>();
  private kettle = new KettleConfirmations();
  private failures: string[] = [];

  begin(snapshot: Snapshot, action: HausAction, now = Date.now()) {
    const id = ++this.nextId;
    const visible = this.project(snapshot);
    const patches = prediction(visible, action).filter(
      (patch) => patch.state !== undefined || Object.keys(patch.attributes).length,
    );
    const initiallySatisfied = patches.every((patch) => {
      const actual = snapshot.states.find((item) => item.entity_id === patch.entityId);
      const displayed = visible.states.find((item) => item.entity_id === patch.entityId);
      if (actual) this.lastObservedEntities.set(actual.entity_id, actual);
      return actual && displayed && matches(patch, actual) && matches(patch, displayed);
    });
    const kettle = this.kettle.begin(id, snapshot, action, now);
    this.transactions.set(id, {
      id,
      sourceId: action.target.entity_id,
      patches,
      initiallySatisfied,
      createdAt: now,
      // HA's service acknowledgement can take up to 15 seconds. The bridge then
      // has its own bounded observation window, which starts after that ACK.
      expiresAt: now + (kettle ? 30_000 : 60000),
      kettle,
    });
    return id;
  }

  project(snapshot: Snapshot): Snapshot {
    const completed = snapshot.states.map((entity) => this.lightMemory.complete(entity));
    if (!this.transactions.size)
      return completed.some((entity, index) => entity !== snapshot.states[index])
        ? { ...snapshot, states: completed }
        : snapshot;
    const states = new Map(completed.map((entity) => [entity.entity_id, entity]));
    const pending = new Set<string>();
    const pendingSince: Record<string, number> = {};
    const markPending = (entityId: string, since: number) => {
      pending.add(entityId);
      pendingSince[entityId] = Math.min(pendingSince[entityId] ?? since, since);
    };
    for (const transaction of this.transactions.values()) {
      markPending(transaction.sourceId, transaction.createdAt);
      for (const patch of transaction.patches) {
        markPending(patch.entityId, transaction.createdAt);
        const entity = states.get(patch.entityId);
        if (entity)
          states.set(patch.entityId, {
            ...entity,
            state: patch.state ?? entity.state,
            attributes: {
              ...entity.attributes,
              ...(patch.state === 'on' && entity.entity_id.startsWith('light.')
                ? restoredLightOverlay(this.lightMemory.restore(entity), patch.attributes)
                : {}),
              ...patch.attributes,
            },
          });
      }
    }
    return {
      ...snapshot,
      states: [...states.values()],
      pendingEntityIds: [...pending],
      pendingSince,
    };
  }

  acknowledge(id: number, contextId: string | undefined, snapshot: Snapshot, now = Date.now()) {
    const transaction = this.transactions.get(id);
    if (!transaction) return;
    transaction.contextId = contextId;
    if (contextId) {
      this.contexts.set(contextId, id);
      if (this.contexts.size > 256) this.contexts.delete(this.contexts.keys().next().value!);
    }
    transaction.acknowledged = true;
    this.kettle.acknowledge(id);
    const sourceEntity = snapshot.states.find((item) => item.entity_id === transaction.sourceId);
    if (sourceEntity) {
      this.lastObservedEntities.set(sourceEntity.entity_id, sourceEntity);
      this.reconcileKettle(sourceEntity, now);
    }
    if (!this.transactions.has(id)) return;
    transaction.expiresAt = transaction.kettle
      ? now + KETTLE_CONFIRMATION_MS
      : now +
        (transaction.patches.some((patch) =>
          ['opening', 'closing', 'locking', 'unlocking'].includes(patch.state ?? ''),
        )
          ? 45000
          : 10000);
    if (!transaction.patches.length) {
      this.transactions.delete(id);
      this.kettle.settle(id, now);
      return;
    }
    let sawFreshObservation = false;
    for (const patch of transaction.patches) {
      const observed = this.observations.get(patch.entityId);
      const entity = snapshot.states.find((item) => item.entity_id === patch.entityId);
      if (entity) this.lastObservedEntities.set(entity.entity_id, entity);
      if (transaction.initiallySatisfied && entity && matches(patch, entity)) {
        this.confirmPatch(transaction, patch, now);
        continue;
      }
      if (observed && observed.at >= transaction.createdAt) {
        sawFreshObservation = true;
        if (entity && matches(patch, entity)) {
          this.confirmPatch(transaction, patch, now);
        }
      }
    }
    if (
      sawFreshObservation &&
      this.transactions.has(id) &&
      this.isEffectTelemetryUnconfirmed(transaction)
    ) {
      transaction.expiresAt = Math.min(transaction.expiresAt, now + EFFECT_ECHO_GRACE_MS);
    }
  }

  reconcile(entity: HassEntity, contextId?: string, now = Date.now()) {
    const unavailable = ['unknown', 'unavailable'].includes(entity.state);
    const previous = this.confirmed.get(entity.entity_id);
    const contextOrder = contextId && this.contexts.get(contextId);
    // An older local command may arrive after a newer command has already settled.
    // Unrelated external changes and unavailable/safety states always remain authoritative.
    if (
      !unavailable &&
      previous &&
      contextOrder &&
      contextOrder < previous.id &&
      now - previous.at < 30000
    )
      return false;
    this.lastObservedEntities.set(entity.entity_id, entity);
    this.reconcileKettle(entity, now);
    this.lightMemory.remember(entity);
    this.observations.set(entity.entity_id, { contextId, at: now });
    for (const transaction of this.transactions.values()) {
      const patch = transaction.patches.find((item) => item.entityId === entity.entity_id);
      if (!patch) continue;
      if (unavailable) {
        this.finishPatch(transaction, patch, now);
      } else if (transaction.acknowledged && matches(patch, entity)) {
        this.confirmPatch(transaction, patch, now);
      } else if (transaction.acknowledged && this.isEffectTelemetryUnconfirmed(transaction)) {
        transaction.expiresAt = Math.min(transaction.expiresAt, now + EFFECT_ECHO_GRACE_MS);
      }
    }
    return true;
  }

  private isEffectTelemetryUnconfirmed(transaction: Transaction): boolean {
    if (!transaction.acknowledged || transaction.kettle || !transaction.patches.length)
      return false;
    return transaction.patches.every((patch) =>
      isPatchEffectOnlyUnconfirmed(patch, this.lastObservedEntities.get(patch.entityId)),
    );
  }

  private confirmPatch(transaction: Transaction, patch: OptimisticPatch, now: number) {
    if ((this.confirmed.get(patch.entityId)?.id ?? 0) < transaction.id)
      this.confirmed.set(patch.entityId, { id: transaction.id, at: now });
    this.finishPatch(transaction, patch, now);
  }

  /** Finishing a newer intent must never reveal an older superseded value. */
  private finishPatch(transaction: Transaction, patch: OptimisticPatch, now = Date.now()) {
    for (const older of this.transactions.values()) {
      if (older.id >= transaction.id) continue;
      const previous = older.patches.find((item) => item.entityId === patch.entityId);
      if (!previous) continue;
      if (patch.state !== undefined) delete previous.state;
      if (patch.state === 'off' && patch.entityId.startsWith('light.')) previous.attributes = {};
      for (const key of Object.keys(patch.attributes)) delete previous.attributes[key];
      older.patches = older.patches.filter(
        (item) => item.state !== undefined || Object.keys(item.attributes).length,
      );
      if (!older.patches.length && older.acknowledged) {
        this.transactions.delete(older.id);
        this.kettle.settle(older.id, now);
      }
    }
    transaction.patches = transaction.patches.filter((item) => item !== patch);
    if (!transaction.patches.length) {
      this.transactions.delete(transaction.id);
      this.kettle.settle(transaction.id, now);
    }
  }

  private reconcileKettle(entity: HassEntity, now: number) {
    const id = this.kettle.observe(entity, now);
    if (id === undefined) return;
    const transaction = this.transactions.get(id);
    if (!transaction) return;
    if (
      transaction.acknowledged &&
      transaction.patches.every(
        (patch) => patch.entityId === entity.entity_id && matches(patch, entity),
      )
    )
      return;
    const newer = [...this.transactions.values()].some(
      (item) => item.id > id && item.sourceId === transaction.sourceId,
    );
    this.reject(id, now);
    if (!newer) {
      this.failures.push(
        'The kettle did not confirm this change. Showing its latest reported state.',
      );
      this.failures = this.failures.slice(-16);
    }
  }

  takeFailures() {
    return this.failures.splice(0);
  }

  reject(id: number, now = Date.now()) {
    const transaction = this.transactions.get(id);
    if (!transaction) return;
    for (const patch of transaction.patches) this.finishPatch(transaction, patch, now);
    this.transactions.delete(id);
    this.kettle.settle(id, now);
  }

  expireTransactions(now = Date.now()): ExpireResult {
    for (const [id, confirmation] of this.confirmed)
      if (now - confirmation.at >= 30000) this.confirmed.delete(id);
    const expired = [...this.transactions.values()].filter(
      (transaction) => transaction.expiresAt <= now,
    );
    let timedOut = 0;
    for (const transaction of expired) {
      if (!this.isEffectTelemetryUnconfirmed(transaction)) timedOut += 1;
      this.reject(transaction.id, now);
    }
    this.kettle.prune(now);
    return { expired: expired.length, timedOut };
  }

  expire(now = Date.now()) {
    return this.expireTransactions(now).expired;
  }

  clear() {
    this.transactions.clear();
    this.observations.clear();
    this.lastObservedEntities.clear();
    this.contexts.clear();
    this.confirmed.clear();
    this.kettle.clear();
    this.failures = [];
  }
  get size() {
    return this.transactions.size;
  }
}

export { EntityActionQueue } from '@haus/core/command-queue';
