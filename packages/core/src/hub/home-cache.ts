/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isRecord } from '../record.js';
import {
  createSnapshotEnvelope,
  parseSnapshotEnvelope,
  snapshotEnvelopeSchema,
  snapshotEnvelopeVersion,
} from '../snapshot-envelope.js';

export interface HomeCacheStore {
  loadHomeCache?: () => Promise<unknown>;
  saveHomeCache?: (value: unknown) => Promise<void>;
}

export interface CachedHomeSnapshotShape {
  readonly states: Array<{
    readonly entity_id: string;
    readonly state: string;
    readonly attributes: Record<string, unknown>;
    readonly [key: string]: unknown;
  }>;
  readonly entities: Array<{ readonly entity_id: string; readonly [key: string]: unknown }>;
  readonly devices: Array<{ readonly id: string; readonly [key: string]: unknown }>;
  readonly areas: Array<{ readonly area_id: string; readonly [key: string]: unknown }>;
  readonly config: { readonly location_name: string; readonly [key: string]: unknown };
  readonly services: Record<string, unknown>;
  readonly user: {
    readonly name: string;
    readonly is_admin: boolean;
    readonly [key: string]: unknown;
  };
}

const SNAPSHOT_DOCUMENTS: Readonly<Record<string, string>> = {
  get_states: 'states',
  get_services: 'services',
  get_config: 'config',
  'auth/current_user': 'user',
  'config/area_registry/list': 'areas',
  'config/device_registry/list': 'devices',
  'config/entity_registry/list': 'entities',
};

/** Cached topology is readable context, never proof that a device is online. */
export function decodeCachedHomeSnapshot<
  TSnapshot = CachedHomeSnapshotShape,
>(value: unknown): TSnapshot | undefined {
  if (
    !isRecord(value) ||
    !isRecord(value.config) ||
    !isRecord(value.services) ||
    !isRecord(value.user) ||
    typeof value.config.location_name !== 'string' ||
    typeof value.user.name !== 'string' ||
    typeof value.user.is_admin !== 'boolean'
  ) {
    return undefined;
  }
  for (const [key, id] of [
    ['states', 'entity_id'],
    ['entities', 'entity_id'],
    ['devices', 'id'],
    ['areas', 'area_id'],
  ] as const) {
    const items = value[key];
    if (
      !Array.isArray(items) ||
      items.length > 30000 ||
      items.some((item) => !isRecord(item) || typeof item[id] !== 'string')
    ) {
      return undefined;
    }
  }
  if (
    (value.states as unknown[]).some(
      (item) => !isRecord(item) || typeof item.state !== 'string' || !isRecord(item.attributes),
    )
  ) {
    return undefined;
  }
  // Never hydrate a partial cache that captured states before device/entity registries loaded;
  // doing so would flash ungrouped raw entities on startup.
  if (
    (value.states as unknown[]).length > 0 &&
    (value.devices as unknown[]).length === 0 &&
    (value.entities as unknown[]).length === 0
  ) {
    return undefined;
  }
  return value as TSnapshot;
}

/** Session-scoped encrypted snapshot cache shared by Haus Hub and Home Assistant native clients. */
export class HomeCache<TSnapshot = CachedHomeSnapshotShape> {
  private epoch = 0;
  private mutation = 0;
  private context = '';
  private snapshot: Record<string, unknown> = {};
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly store: HomeCacheStore,
    private readonly scope: () => string | undefined,
  ) {}

  record(type: string, value: unknown): void {
    const key = SNAPSHOT_DOCUMENTS[type];
    const scope = this.scope();
    if (!key || !scope) return;
    if (this.context !== scope) {
      this.reset();
      this.context = scope;
    }
    this.snapshot[key] = value;
    ++this.mutation;
    this.schedule(500);
  }

  state(data: Record<string, unknown>): void {
    if (
      this.context !== this.scope() ||
      !Array.isArray(this.snapshot.states) ||
      typeof data.entity_id !== 'string'
    ) {
      return;
    }
    const previous = this.snapshot.states.filter(
      (entry): entry is Record<string, unknown> => isRecord(entry),
    );
    const next = data.new_state;
    if (next !== null && (!isRecord(next) || next.entity_id !== data.entity_id)) return;
    this.snapshot.states = next
      ? [...previous.filter((state) => state.entity_id !== data.entity_id), next]
      : previous.filter((state) => state.entity_id !== data.entity_id);
    ++this.mutation;
    this.schedule(data.entity_id.startsWith('camera.') ? 500 : 30000);
  }

  private schedule(delay: number): void {
    if (this.timer || !decodeCachedHomeSnapshot<TSnapshot>(this.snapshot)) return;
    const epoch = this.epoch;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (epoch === this.epoch && this.scope() === this.context) {
        void this.store
          .saveHomeCache?.(createSnapshotEnvelope(this.context, Date.now(), this.snapshot))
          .catch(() => {});
      }
    }, delay);
  }

  async load(): Promise<{ capturedAt: number; snapshot: TSnapshot } | null> {
    const epoch = this.epoch;
    const mutation = this.mutation;
    const scope = this.scope();
    if (!scope) return null;
    const value = await this.store.loadHomeCache?.().catch(() => null);
    if (epoch !== this.epoch || scope !== this.scope()) return null;

    const options = {
      scope,
      maxAgeMs: 7 * 86400000,
      decode: (raw: unknown) => decodeCachedHomeSnapshot<TSnapshot>(raw),
    };
    const envelope = parseSnapshotEnvelope(value, options);
    const legacy =
      isRecord(value) &&
      !('schema' in value) &&
      !('version' in value) &&
      Object.keys(value).every((key) => ['scope', 'capturedAt', 'snapshot'].includes(key))
        ? parseSnapshotEnvelope(
            {
              schema: snapshotEnvelopeSchema,
              version: snapshotEnvelopeVersion,
              scope: value.scope,
              capturedAt: value.capturedAt,
              snapshot: value.snapshot,
            },
            options,
          )
        : undefined;
    const result = envelope ?? legacy;
    if (!result) return null;

    if (legacy && epoch === this.epoch && mutation === this.mutation && scope === this.scope()) {
      await this.store.saveHomeCache?.(legacy).catch(() => {});
    }
    if (epoch !== this.epoch || scope !== this.scope()) return null;
    return { capturedAt: result.capturedAt, snapshot: result.snapshot };
  }

  reset(): void {
    ++this.epoch;
    ++this.mutation;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.context = '';
    this.snapshot = {};
  }
}
