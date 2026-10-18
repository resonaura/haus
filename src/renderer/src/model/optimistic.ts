import type { HassEntity, HausAction, Snapshot } from './types';
import { LightOutputMemory } from './light-memory';

type Patch = { entityId: string; state?: string; attributes: Record<string, unknown> };
type Transaction = {
  id: number;
  sourceId: string;
  patches: Patch[];
  createdAt: number;
  expiresAt: number;
  contextId?: string;
  acknowledged?: boolean;
  initiallySatisfied: boolean;
};
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function prediction(
  snapshot: Snapshot,
  action: HausAction,
  lightMemory: LightOutputMemory,
): Patch[] {
  const entityId = action.target.entity_id;
  const entity = snapshot.states.find((item) => item.entity_id === entityId);
  if (
    !entity ||
    entity.state === 'unavailable' ||
    (entity.state === 'unknown' && action.domain !== 'scene')
  )
    return [];
  const data = action.service_data ?? {};
  const attributes: Record<string, unknown> = {};
  let state: string | undefined;
  const patch = (): Patch[] => [{ entityId, state, attributes }];
  switch (action.service) {
    case 'turn_on':
    case 'turn_off': {
      if (action.domain === 'scene') {
        const settings =
          snapshot.sceneConfigs?.[entityId]?.entities ??
          entity.attributes.entities ??
          entity.attributes.states;
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return [];
        return Object.entries(settings).flatMap(([id, setting]) => {
          const current = snapshot.states.find((item) => item.entity_id === id);
          if (!current || ['unknown', 'unavailable'].includes(current.state)) return [];
          if (typeof setting === 'string')
            return [{ entityId: id, state: setting, attributes: {} }];
          if (!setting || typeof setting !== 'object' || Array.isArray(setting)) return [];
          const {
            state: targetState,
            attributes: nested,
            ...rest
          } = setting as Record<string, unknown>;
          const attrs = { ...(nested && typeof nested === 'object' ? nested : rest) } as Record<
            string,
            unknown
          >;
          if (attrs.rgb_color) attrs.color_mode = 'rgb';
          else if (attrs.color_temp_kelvin || attrs.color_temp) attrs.color_mode = 'color_temp';
          return [
            {
              entityId: id,
              state: typeof targetState === 'string' ? targetState : undefined,
              attributes: attrs,
            },
          ];
        });
      }
      if (
        [
          'light',
          'switch',
          'input_boolean',
          'fan',
          'humidifier',
          'automation',
          'siren',
          'script',
        ].includes(action.domain)
      )
        state = action.service === 'turn_on' ? 'on' : 'off';
      if (action.domain === 'media_player') state = action.service === 'turn_on' ? 'idle' : 'off';
      if (action.domain === 'climate' && action.service === 'turn_off') state = 'off';
      if (action.domain === 'light' && action.service === 'turn_on') {
        if (entity.state === 'off') Object.assign(attributes, lightMemory.restore(entity));
        if (typeof data.brightness_pct === 'number')
          attributes.brightness = Math.round(data.brightness_pct * 2.55);
        if (typeof data.brightness === 'number') attributes.brightness = data.brightness;
        if (attributes.brightness === 0) state = 'off';
        if (data.rgb_color) {
          attributes.rgb_color = data.rgb_color;
          attributes.color_mode = 'rgb';
        }
        if (data.color_temp_kelvin) {
          attributes.color_temp_kelvin = data.color_temp_kelvin;
          attributes.color_mode = 'color_temp';
        }
      }
      return patch();
    }
    case 'set_temperature':
      Object.assign(attributes, data);
      return patch();
    case 'set_hvac_mode':
      state = String(data.hvac_mode);
      return patch();
    case 'set_cover_position':
    case 'set_valve_position':
      attributes.current_position = data.position;
      state =
        Number(data.position) > Number(entity.attributes.current_position ?? 0)
          ? 'opening'
          : 'closing';
      return patch();
    case 'open_cover':
    case 'open_valve':
      state = 'opening';
      return patch();
    case 'close_cover':
    case 'close_valve':
      state = 'closing';
      return patch();
    case 'stop_cover':
    case 'stop_valve':
      state = Number(entity.attributes.current_position) > 0 ? 'open' : 'closed';
      return patch();
    case 'volume_set':
      attributes.volume_level = data.volume_level;
      return patch();
    case 'media_play_pause':
      state = entity.state === 'playing' ? 'paused' : 'playing';
      return patch();
    case 'media_play':
      state = 'playing';
      return patch();
    case 'media_pause':
      state = 'paused';
      return patch();
    case 'lock':
      state = 'locking';
      return patch();
    case 'unlock':
      state = 'unlocking';
      return patch();
    case 'set_percentage':
      attributes.percentage = data.percentage;
      state = Number(data.percentage) ? 'on' : 'off';
      return patch();
    case 'select_option':
      state = String(data.option);
      return patch();
    case 'set_value':
      state = String(data.value);
      return patch();
    default:
      return [];
  }
}

function matches(patch: Patch, entity: HassEntity) {
  const terminal: Record<string, string> = {
    opening: 'open',
    closing: 'closed',
    locking: 'locked',
    unlocking: 'unlocked',
  };
  if (
    patch.state !== undefined &&
    entity.state !== patch.state &&
    entity.state !== terminal[patch.state]
  )
    return false;
  return Object.entries(patch.attributes).every(([key, value]) => {
    const actual = entity.attributes[key];
    if (
      key === 'color_mode' &&
      value === 'rgb' &&
      ['rgb', 'rgbw', 'rgbww', 'xy', 'hs'].includes(actual)
    )
      return true;
    const tolerance =
      key === 'brightness'
        ? 3
        : key === 'color_temp_kelvin'
          ? 150
          : key === 'volume_level'
            ? 0.02
            : key === 'current_position'
              ? 1
              : 0;
    return typeof value === 'number' && typeof actual === 'number'
      ? Math.abs(value - actual) <= tolerance
      : equal(value, actual);
  });
}

/** Separate server facts from reversible local intent, shared by every device surface. */
export class OptimisticState {
  readonly lightMemory = new LightOutputMemory();
  private nextId = 0;
  private transactions = new Map<number, Transaction>();
  private observations = new Map<string, { contextId?: string; at: number }>();

  begin(snapshot: Snapshot, action: HausAction, now = Date.now()) {
    const id = ++this.nextId;
    const visible = this.project(snapshot);
    const patches = prediction(visible, action, this.lightMemory).filter(
      (patch) => patch.state !== undefined || Object.keys(patch.attributes).length,
    );
    const initiallySatisfied = patches.every((patch) => {
      const actual = snapshot.states.find((item) => item.entity_id === patch.entityId);
      const displayed = visible.states.find((item) => item.entity_id === patch.entityId);
      return actual && displayed && matches(patch, actual) && matches(patch, displayed);
    });
    this.transactions.set(id, {
      id,
      sourceId: action.target.entity_id,
      patches,
      initiallySatisfied,
      createdAt: now,
      expiresAt: now + 60000,
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
                ? this.lightMemory.restore(entity)
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
    transaction.acknowledged = true;
    transaction.expiresAt =
      now +
      (transaction.patches.some((patch) =>
        ['opening', 'closing', 'locking', 'unlocking'].includes(patch.state ?? ''),
      )
        ? 45000
        : 10000);
    if (!transaction.patches.length) {
      this.transactions.delete(id);
      return;
    }
    for (const patch of transaction.patches) {
      const observed = this.observations.get(patch.entityId);
      const entity = snapshot.states.find((item) => item.entity_id === patch.entityId);
      if (transaction.initiallySatisfied && entity && matches(patch, entity)) {
        this.finishPatch(transaction, patch);
        continue;
      }
      if (
        observed &&
        observed.at >= transaction.createdAt &&
        entity &&
        ((contextId && contextId === observed.contextId) || matches(patch, entity))
      )
        this.finishPatch(transaction, patch);
    }
  }

  reconcile(entity: HassEntity, contextId?: string, now = Date.now()) {
    this.lightMemory.remember(entity);
    this.observations.set(entity.entity_id, { contextId, at: now });
    for (const transaction of this.transactions.values()) {
      const patch = transaction.patches.find((item) => item.entityId === entity.entity_id);
      if (!patch) continue;
      if (
        ['unknown', 'unavailable'].includes(entity.state) ||
        (transaction.contextId && contextId === transaction.contextId) ||
        matches(patch, entity)
      )
        this.finishPatch(transaction, patch);
    }
  }

  /** Finishing a newer intent must never reveal an older superseded value. */
  private finishPatch(transaction: Transaction, patch: Patch) {
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
      if (!older.patches.length && older.acknowledged) this.transactions.delete(older.id);
    }
    transaction.patches = transaction.patches.filter((item) => item !== patch);
    if (!transaction.patches.length) this.transactions.delete(transaction.id);
  }

  reject(id: number) {
    const transaction = this.transactions.get(id);
    if (!transaction) return;
    for (const patch of transaction.patches) this.finishPatch(transaction, patch);
    this.transactions.delete(id);
  }

  expire(now = Date.now()) {
    const expired = [...this.transactions.values()].filter(
      (transaction) => transaction.expiresAt <= now,
    );
    for (const transaction of expired) this.reject(transaction.id);
    return expired.length;
  }

  clear() {
    this.transactions.clear();
    this.observations.clear();
  }
  get size() {
    return this.transactions.size;
  }
}

/** Preserve click order for one device while allowing different devices to update together. */
export class EntityActionQueue {
  private pending = new Map<string, Promise<unknown>>();
  run<T>(entityId: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.pending.get(entityId) ?? Promise.resolve())
      .catch(() => {})
      .then(operation);
    this.pending.set(entityId, result);
    void result
      .finally(() => {
        if (this.pending.get(entityId) === result) this.pending.delete(entityId);
      })
      .catch(() => {});
    return result;
  }
}
