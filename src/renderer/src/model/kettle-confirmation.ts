import type { HassEntity, HausAction, Snapshot } from './types';

// The bridge polls once a second and reports a terminal result after 12 seconds.
// Keep a small delivery margin without leaving the modal in "Updating…" for half a minute.
export const KETTLE_CONFIRMATION_MS = 15_000;
type Expectation =
  { control: 'mode'; mode: string } | { control: 'target_temperature'; value: number };
type Intent = {
  id: number;
  entityId: string;
  expectation: Expectation;
  baseline: number;
  sequence?: number;
  eligible: boolean;
  settled: boolean;
  retainUntil: number;
};
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const sequence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

function expectation(snapshot: Snapshot, action: HausAction): Expectation | undefined {
  const entry = snapshot.entities.find((item) => item.entity_id === action.target.entity_id);
  if (
    action.domain !== 'water_heater' ||
    entry?.platform !== 'mqtt' ||
    !/^haus_kettle_\d{1,10}_kettle$/.test(entry.unique_id ?? '')
  )
    return;
  const value = action.service_data ?? {};
  if (
    action.service === 'set_operation_mode' &&
    ['off', 'electric', 'performance'].includes(String(value.operation_mode))
  )
    return { control: 'mode', mode: String(value.operation_mode) };
  if (action.service === 'set_temperature' && typeof value.temperature === 'number') {
    const entity = snapshot.states.find((item) => item.entity_id === action.target.entity_id);
    const unit = entity?.attributes.temperature_unit ?? snapshot.config.unit_system?.temperature;
    const temperature =
      unit === '°F' || unit === 'F' ? (value.temperature - 32) / 1.8 : value.temperature;
    if (Number.isFinite(temperature)) return { control: 'target_temperature', value: temperature };
  }
}

function matching(wanted: Expectation, command: Record<string, unknown>) {
  if (command.control !== wanted.control || !record(command.expected)) return false;
  return wanted.control === 'mode'
    ? command.expected.mode === wanted.mode
    : typeof command.expected.target_temperature === 'number' &&
        Number.isFinite(command.expected.target_temperature) &&
        Math.abs(command.expected.target_temperature - wanted.value) <= 0.5 + 1e-6;
}

/** Sequence claims survive completed intents so late A→B→A errors cannot attach to the newest A. */
export class KettleConfirmations {
  private intents = new Map<number, Intent>();

  begin(id: number, snapshot: Snapshot, action: HausAction, now: number) {
    this.prune(now);
    const wanted = expectation(snapshot, action);
    if (!wanted) return false;
    const entity = snapshot.states.find((item) => item.entity_id === action.target.entity_id);
    const before = entity?.attributes.last_command;
    this.intents.set(id, {
      id,
      entityId: action.target.entity_id,
      expectation: wanted,
      baseline: record(before) && sequence(before.sequence) ? before.sequence : 0,
      eligible: false,
      settled: false,
      retainUntil: now + KETTLE_CONFIRMATION_MS,
    });
    while (this.intents.size > 256) this.intents.delete(this.intents.keys().next().value!);
    return true;
  }

  acknowledge(id: number) {
    const intent = this.intents.get(id);
    if (intent) intent.eligible = true;
  }

  observe(entity: HassEntity, now: number): number | undefined {
    this.prune(now);
    const command = entity.attributes.last_command;
    if (!record(command) || !sequence(command.sequence)) return;
    const incoming = command.sequence;
    const candidates = [...this.intents.values()].filter(
      (intent) =>
        intent.entityId === entity.entity_id &&
        intent.eligible &&
        incoming > intent.baseline &&
        matching(intent.expectation, command),
    );
    const owner =
      candidates.find((intent) => intent.sequence === incoming) ??
      candidates.find((intent) => intent.sequence === undefined);
    if (!owner) return;
    owner.sequence ??= incoming;
    if (!owner.settled && ['rejected', 'expired', 'unconfirmed'].includes(String(command.status)))
      return owner.id;
  }

  settle(id: number, now: number) {
    const intent = this.intents.get(id);
    if (!intent) return;
    intent.settled = true;
    intent.eligible = true;
    intent.retainUntil = now + 60_000;
  }

  prune(now: number) {
    for (const [id, intent] of this.intents)
      if (intent.settled && intent.retainUntil <= now) this.intents.delete(id);
  }

  clear() {
    this.intents.clear();
  }
}
