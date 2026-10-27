import { createHash } from 'node:crypto';
import type { SecureStore, StoredSession } from './secure-store';
import { cachedHomeSnapshot } from '../renderer/src/model/cached-home';
import type { Snapshot } from '../renderer/src/model/types';
import { isRecord } from './validation';

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
    this.schedule(data.entity_id.startsWith('camera.') ? 500 : 30000);
  }
  private schedule(delay: number) {
    if (this.timer || !cachedHomeSnapshot(this.snapshot)) return;
    const epoch = this.epoch;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (epoch === this.epoch && this.scope() === this.context)
        void this.store
          .saveHomeCache?.({ scope: this.context, capturedAt: Date.now(), snapshot: this.snapshot })
          .catch(() => {});
    }, delay);
  }
  async load() {
    const epoch = this.epoch,
      scope = this.scope();
    if (!scope) return null;
    const value = await this.store.loadHomeCache?.().catch(() => null);
    if (
      epoch !== this.epoch ||
      scope !== this.scope() ||
      !isRecord(value) ||
      value.scope !== scope ||
      !Number.isSafeInteger(value.capturedAt) ||
      Number(value.capturedAt) > Date.now() ||
      Number(value.capturedAt) < Date.now() - 7 * 86400000
    )
      return null;
    const snapshot = cachedHomeSnapshot(value.snapshot);
    return snapshot ? { capturedAt: Number(value.capturedAt), snapshot } : null;
  }
  reset() {
    ++this.epoch;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.context = '';
    this.snapshot = {};
  }
}
