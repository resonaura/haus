import { changedPreferences } from '../model/shared-preferences';
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
  private pending: Record<string, unknown> = {};
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
    this.pending = { ...this.pending, ...changedPreferences(this.observed, this.adapter.local()) };
    this.observed = this.adapter.local();
  }
  async sync() {
    if (!this.active || this.busy) return;
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
        this.pending = { ...seed, ...this.pending };
        const patch = { ...this.pending };
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
        for (const [key, value] of Object.entries(patch))
          if (JSON.stringify(this.pending[key]) === JSON.stringify(value)) delete this.pending[key];
        this.changed();
        this.adapter.status(Object.keys(this.pending).length ? 'syncing' : 'synced');
        return;
      }
    } catch {
      if (this.active) this.adapter.status('offline');
    } finally {
      this.busy = false;
    }
  }
  stop() {
    this.active = false;
  }
}
