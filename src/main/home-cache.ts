import { createHash } from 'node:crypto';
import type { SecureStore, StoredSession } from './secure-store';
import { cachedHomeSnapshot } from '../renderer/src/model/cached-home';
import type { Snapshot } from '../renderer/src/model/types';
import { isRecord } from './validation';
import {
  createSnapshotEnvelope,
  parseSnapshotEnvelope,
  snapshotEnvelopeSchema,
  snapshotEnvelopeVersion,
} from '@haus/core/snapshot-envelope';

const documents: Record<string, keyof Snapshot> = {
  get_states: 'states',
  get_services: 'services',
  get_config: 'config',
  'auth/current_user': 'user',
  'config/area_registry/list': 'areas',
  'config/device_registry/list': 'devices',
  'config/entity_registry/list': 'entities',
};
export const homeCacheScope = (session: StoredSession) =>
  createHash('sha256')
    .update(JSON.stringify([session.url, session.clientId, session.refreshToken]))
    .digest('hex');

/** Only successful native HA reads can populate this encrypted, session-bound cache. */
export class HomeCache {
  private epoch = 0;
  private mutation = 0;
  private context = '';
  private snapshot: Record<string, unknown> = {};
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private store: Pick<SecureStore, 'loadHomeCache' | 'saveHomeCache'>,
    private scope: () => string | undefined,
  ) {}
  record(type: string, value: unknown) {
    const key = documents[type],
      scope = this.scope();
    if (!key || !scope) return;
    if (this.context !== scope) {
      this.reset();
      this.context = scope;
    }
    this.snapshot[key] = value;
    ++this.mutation;
    this.schedule(500);
  }
  state(data: Record<string, unknown>) {
    if (
      this.context !== this.scope() ||
      !Array.isArray(this.snapshot.states) ||
      typeof data.entity_id !== 'string'
    )
      return;
    const previous = this.snapshot.states as Snapshot['states'];
    const next = data.new_state;
    if (next !== null && (!isRecord(next) || next.entity_id !== data.entity_id)) return;
    this.snapshot.states = next
      ? [...previous.filter((state) => state.entity_id !== data.entity_id), next]
      : previous.filter((state) => state.entity_id !== data.entity_id);
    ++this.mutation;
    this.schedule(data.entity_id.startsWith('camera.') ? 500 : 30000);
  }
  private schedule(delay: number) {
    if (this.timer || !cachedHomeSnapshot(this.snapshot)) return;
    const epoch = this.epoch;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (epoch === this.epoch && this.scope() === this.context)
        void this.store
          .saveHomeCache?.(createSnapshotEnvelope(this.context, Date.now(), this.snapshot))
          .catch(() => {});
    }, delay);
  }
  async load() {
    const epoch = this.epoch,
      mutation = this.mutation,
      scope = this.scope();
    if (!scope) return null;
    const value = await this.store.loadHomeCache?.().catch(() => null);
    if (epoch !== this.epoch || scope !== this.scope()) return null;

    const options = { scope, maxAgeMs: 7 * 86400000, decode: cachedHomeSnapshot };
    const envelope = parseSnapshotEnvelope(value, options);
    const legacy =
      isRecord(value) &&
      !('schema' in value) &&
      !('version' in value) &&
      Object.keys(value).every((key) => ['scope', 'capturedAt', 'snapshot'].includes(key)) &&
      parseSnapshotEnvelope(
        {
          schema: snapshotEnvelopeSchema,
          version: snapshotEnvelopeVersion,
          scope: value.scope,
          capturedAt: value.capturedAt,
          snapshot: value.snapshot,
        },
        options,
      );
    const result = envelope ?? legacy;
    if (!result) return null;

    // Migrate only the exact legacy format and only if no newer HA event arrived
    // while the disk read was pending. SecureStore serializes and atomically writes it.
    if (legacy && epoch === this.epoch && mutation === this.mutation && scope === this.scope()) {
      await this.store.saveHomeCache?.(legacy).catch(() => {});
    }
    if (epoch !== this.epoch || scope !== this.scope()) return null;
    return { capturedAt: result.capturedAt, snapshot: result.snapshot };
  }
  reset() {
    ++this.epoch;
    ++this.mutation;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.context = '';
    this.snapshot = {};
  }
}
