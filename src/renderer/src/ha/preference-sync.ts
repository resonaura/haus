import { changedPreferences } from '../model/shared-preferences';
import { mergePreference } from '../model/preference-merge';
export interface SharedDocument {
  revision: string;
  value: Record<string, unknown>;
  updatedAt: number;
  conflict?: boolean;
}
interface Adapter {
  local: () => Record<string, unknown>;
  apply: (patch: Record<string, unknown>) => void;
  read: () => Promise<SharedDocument>;
  write: (revision: string, patch: Record<string, unknown>) => Promise<SharedDocument>;
  baseline?: (value: Record<string, unknown>) => void;
  status: (status: 'syncing' | 'synced' | 'offline') => void;
}
/** Per-field changes plus compare-and-swap prevent an idle client overwriting another device. */
export class PreferenceSync {
  private observed: Record<string, unknown>;
  private pending = new Map<string, { before: unknown; after: unknown; version: number }>();
  private version = 0;
  private again = false;
  private active = true;
  private busy = false;
  constructor(
    private adapter: Adapter,
    baseline?: Record<string, unknown>,
  ) {
    this.observed = baseline ?? adapter.local();
    this.changed();
  }
  changed() {
    for (const [key, after] of Object.entries(
      changedPreferences(this.observed, this.adapter.local()),
    )) {
      const previous = this.pending.get(key);
      this.pending.set(key, {
        before: previous ? previous.before : this.observed[key],
        after,
        version: ++this.version,
      });
    }
    this.observed = this.adapter.local();
  }
  async sync() {
    if (!this.active) return;
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    this.changed();
    this.adapter.status('syncing');
    try {
      for (let attempt = 0; attempt < 3 && this.active; attempt++) {
        const remote = await this.adapter.read();
        if (!this.active) return;
        this.changed();
        this.adapter.baseline?.(remote.value);
        // A brand-new helper adopts this home's existing layout once. Existing fields win on other clients.
        const seed = Object.fromEntries(
          Object.entries(this.adapter.local()).filter(([key]) => !(key in remote.value)),
        );
        for (const [key, after] of Object.entries(seed))
          if (!this.pending.has(key))
            this.pending.set(key, { before: undefined, after, version: ++this.version });
        const submitted = new Map(this.pending);
        const patch = Object.fromEntries(
          [...submitted].map(([key, edit]) => [
            key,
            mergePreference(key, edit.before, edit.after, remote.value[key]),
          ]),
        );
        const merged = { ...remote.value, ...patch };
        this.observed = { ...this.adapter.local(), ...merged };
        this.adapter.apply(merged);
        if (!Object.keys(patch).length) {
          this.adapter.status('synced');
          return;
        }
        const saved = await this.adapter.write(remote.revision, patch);
        if (!this.active) return;
        if (saved.conflict) continue;
        this.adapter.baseline?.(saved.value);
        this.changed();
        for (const [key, edit] of submitted)
          if (this.pending.get(key)?.version === edit.version) this.pending.delete(key);
        if (this.pending.size) this.again = true;
        this.adapter.status(this.pending.size ? 'syncing' : 'synced');
        return;
      }
    } catch {
      if (this.active) this.adapter.status('offline');
    } finally {
      this.busy = false;
      if (this.again && this.active) {
        this.again = false;
        void this.sync();
      }
    }
  }
  stop() {
    this.active = false;
  }
}
