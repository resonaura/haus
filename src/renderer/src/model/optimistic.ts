import type { HassEntity, HausAction, Snapshot } from './types';
import { LightOutputMemory } from './light-memory';
import { KETTLE_CONFIRMATION_MS, KettleConfirmations } from './kettle-confirmation';

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
  kettle?: boolean;
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
    case 'set_operation_mode':
      state = String(data.operation_mode);
      if ('operation_mode' in entity.attributes) attributes.operation_mode = state;
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

function normalizedRgb(expected: unknown, actual: unknown) {
  if (
    !Array.isArray(expected) ||
    !Array.isArray(actual) ||
    expected.length !== 3 ||
    actual.length !== 3 ||
    [...expected, ...actual].some(
      (value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 255,
    )
  )
    return false;
  const expectedMax = Math.max(...expected),
    actualMax = Math.max(...actual);
  return (
    expectedMax > 0 &&
    actualMax > 0 &&
    expected.every(
      (value, index) => Math.abs(value / expectedMax - actual[index] / actualMax) <= 0.035,
    )
  );
}
function matches(patch: Patch, entity: HassEntity, sameContext = false) {
  const terminal: Record<string, string> = {
    opening: 'open',
    closing: 'closed',
    locking: 'locked',
    unlocking: 'unlocked',
  };
  const waterHeaterModeConfirmed =
    patch.entityId.startsWith('water_heater.') &&
    patch.state !== undefined &&
    patch.attributes.operation_mode === patch.state &&
    entity.attributes.operation_mode === patch.state;
  if (
    patch.state !== undefined &&
    entity.state !== patch.state &&
    entity.state !== terminal[patch.state] &&
    !waterHeaterModeConfirmed
  ) {
    const numeric = /^(?:input_)?number\./.test(entity.entity_id);
    const step = Number(entity.attributes.step);
    const tolerance = Number.isFinite(step) && step > 0 ? Math.max(1e-6, step / 2) : 1e-6;
    if (
      !numeric ||
      !entity.state.trim() ||
      !patch.state.trim() ||
      !Number.isFinite(Number(entity.state)) ||
      !Number.isFinite(Number(patch.state)) ||
      Math.abs(Number(entity.state) - Number(patch.state)) > tolerance
    )
      return false;
  }
  return Object.entries(patch.attributes).every(([key, value]) => {
    const actual = entity.attributes[key];
    if (sameContext && key === 'rgb_color' && normalizedRgb(value, actual)) return true;
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
  private contexts = new Map<string, number>();
  private confirmed = new Map<string, { id: number; at: number }>();
  private kettle = new KettleConfirmations();
  private failures: string[] = [];

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
    if (contextId) {
      this.contexts.set(contextId, id);
      if (this.contexts.size > 256) this.contexts.delete(this.contexts.keys().next().value!);
    }
    transaction.acknowledged = true;
    this.kettle.acknowledge(id);
    const entity = snapshot.states.find((item) => item.entity_id === transaction.sourceId);
    if (entity) this.reconcileKettle(entity, now);
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
    for (const patch of transaction.patches) {
      const observed = this.observations.get(patch.entityId);
      const entity = snapshot.states.find((item) => item.entity_id === patch.entityId);
      if (transaction.initiallySatisfied && entity && matches(patch, entity)) {
        this.confirmPatch(transaction, patch, now);
        continue;
      }
      if (
        observed &&
        observed.at >= transaction.createdAt &&
        entity &&
        matches(patch, entity, Boolean(contextId && contextId === observed.contextId))
      )
        this.confirmPatch(transaction, patch, now);
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
    this.reconcileKettle(entity, now);
    this.lightMemory.remember(entity);
    this.observations.set(entity.entity_id, { contextId, at: now });
    for (const transaction of this.transactions.values()) {
      const patch = transaction.patches.find((item) => item.entityId === entity.entity_id);
      if (!patch) continue;
      if (
        unavailable ||
        (transaction.acknowledged &&
          matches(
            patch,
            entity,
            Boolean(transaction.contextId && contextId === transaction.contextId),
          ))
      )
        if (unavailable) this.finishPatch(transaction, patch, now);
        else this.confirmPatch(transaction, patch, now);
    }
    return true;
  }

  private confirmPatch(transaction: Transaction, patch: Patch, now: number) {
    if ((this.confirmed.get(patch.entityId)?.id ?? 0) < transaction.id)
      this.confirmed.set(patch.entityId, { id: transaction.id, at: now });
    this.finishPatch(transaction, patch, now);
  }

  /** Finishing a newer intent must never reveal an older superseded value. */
  private finishPatch(transaction: Transaction, patch: Patch, now = Date.now()) {
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

  expire(now = Date.now()) {
    for (const [id, confirmation] of this.confirmed)
      if (now - confirmation.at >= 30000) this.confirmed.delete(id);
    const expired = [...this.transactions.values()].filter(
      (transaction) => transaction.expiresAt <= now,
    );
    for (const transaction of expired) this.reject(transaction.id, now);
    this.kettle.prune(now);
    return expired.length;
  }

  clear() {
    this.transactions.clear();
    this.observations.clear();
    this.contexts.clear();
    this.confirmed.clear();
    this.kettle.clear();
    this.failures = [];
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
