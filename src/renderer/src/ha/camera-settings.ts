export interface ActivityStatus {
  state: string;
  processor?: string;
  placement?: 'nvr' | 'home';
  fallbackReason?: 'no_nodes' | 'no_analysis_nodes' | 'nodes_unavailable' | 'nodes_busy';
  blocked?: 'capacity' | 'unsupported';
}
export interface CameraSettings {
  id: string;
  enabled: boolean;
  aliases?: string[];
  talkAvailable?: boolean;
  motionDetection?: { enabled: boolean; mode: 'objects' | 'motion' };
  motionStatus?: ActivityStatus;
}
type Patch = Partial<Pick<CameraSettings, 'enabled' | 'motionDetection'>>;

/** Home-scoped, in-memory settings. Older reads cannot undo an optimistic policy change. */
export class CameraSettingsCache {
  private scope = '';
  private epoch = 0;
  private revision = 0;
  private loadedAt = -Infinity;
  private cameras: CameraSettings[] = [];
  private pending?: Promise<void>;
  private saves = new Map<string, symbol>();
  private listeners = new Set<() => void>();
  constructor(
    private readonly load: () => Promise<{ cameras: CameraSettings[] }>,
    private readonly write: (id: string, patch: Patch) => Promise<Partial<CameraSettings> | void>,
    private readonly now = () => Date.now(),
  ) {}
  setScope(scope: string) {
    if (scope === this.scope) return;
    this.scope = scope;
    ++this.epoch;
    ++this.revision;
    this.cameras = [];
    this.pending = undefined;
    this.saves.clear();
    this.loadedAt = -Infinity;
    this.emit();
  }
  get(id: string) {
    return this.cameras.find((camera) => camera.id === id || camera.aliases?.includes(id));
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    for (const listener of this.listeners) listener();
  }
  refresh(force = false): Promise<void> {
    if (!this.scope || this.saves.size || (!force && this.now() - this.loadedAt < 10_000))
      return Promise.resolve();
    if (this.pending) return this.pending;
    const revision = this.revision;
    const pending = this.load()
      .then((result) => {
        if (revision !== this.revision) return;
        this.cameras = result.cameras;
        this.loadedAt = this.now();
        this.emit();
      })
      .finally(() => {
        if (this.pending === pending) this.pending = undefined;
      });
    this.pending = pending;
    return pending;
  }
  async update(id: string, patch: Patch) {
    const before = this.get(id);
    if (!before) throw Error('Camera settings are still loading.');
    id = before.id;
    if (this.saves.has(id)) throw Error('Camera settings are being saved.');
    const token = Symbol(id),
      epoch = this.epoch;
    this.saves.set(id, token);
    ++this.revision;
    this.pending = undefined;
    const replace = (camera: CameraSettings) => {
      this.cameras = this.cameras.map((item) => (item.id === id ? camera : item));
      this.emit();
    };
    replace({ ...before, ...patch });
    try {
      const result = await this.write(id, patch);
      if (epoch === this.epoch && this.saves.get(id) === token)
        replace({ ...before, ...patch, ...result, id });
    } catch (reason) {
      if (epoch === this.epoch && this.saves.get(id) === token) replace(before);
      throw reason;
    } finally {
      if (epoch === this.epoch && this.saves.get(id) === token) {
        this.saves.delete(id);
        this.loadedAt = -Infinity;
      }
    }
  }
}

export const cameraSettings = new CameraSettingsCache(
  async () => {
    if (!window.hausNative) throw Error('Connect your home to read camera settings.');
    return window.hausNative.helper({ method: 'GET', path: '/api/cameras' });
  },
  async (id, patch) => {
    if (!window.hausNative) throw Error('Connect your home to save camera settings.');
    return window.hausNative.helper({ method: 'PATCH', path: `/api/cameras/${id}`, data: patch });
  },
);
