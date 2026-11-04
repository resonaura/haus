/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type {
  Capability,
  Command,
  CommandReceipt,
  Endpoint,
  HomeAdapter,
  HomeEvent,
  HomeSnapshot,
  Identities,
  Json,
  Reading,
  ProviderSession,
} from '@haus/core/types';
import type { HaTransport } from './ha-client.js';
import type { IdentityKind, IdentityRegistry } from '@haus/core/identity';
import { validateProviderSession } from '@haus/core';
import type { HassEntity, HausAction, Snapshot } from './types.js';
import { normalizeHome } from './view/normalize.js';
import { resolveCapabilities } from './view/capabilities.js';
import { readHaSnapshot } from './snapshot.js';

interface Binding {
  entityId: string;
  capability: Capability;
  actions: Record<string, { domain: string; service: string; field?: string; scale?: number }>;
}
const kinds: Record<string, string> = {
  binary_sensor: 'contact',
  media_player: 'media',
  water_heater: 'waterheater',
  input_boolean: 'switch',
  input_number: 'number',
  input_select: 'selection',
  select: 'selection',
  input_button: 'button',
};
const scalar = (value: unknown): Json =>
  typeof value === 'boolean' ||
  typeof value === 'string' ||
  (typeof value === 'number' && Number.isFinite(value))
    ? value
    : null;

/** All provider service names, feature bits and entity IDs terminate at this boundary. */
export class HaHomeAdapter implements HomeAdapter {
  readonly features = new Set(['devices', 'commands', 'events'] as const);
  readonly id: string;
  private bindings = new Map<string, Binding>();
  private listeners = new Set<(event: HomeEvent) => void>();
  private stops: (() => void)[] = [];
  private wire?: Snapshot;
  private latest?: readonly HassEntity[];
  private sequence = 0;
  private revision = 0;
  private generation = 0;
  private closed = false;
  constructor(
    private readonly options: {
      id: string;
      homeId: string;
      epoch: string;
      session?: ProviderSession;
      identities: Identities;
      registry?: IdentityRegistry;
      transport: HaTransport;
      read?: () => Promise<Snapshot>;
    },
  ) {
    this.id = options.id;
    if (!this.id || !options.epoch) throw Error('invalid_adapter_identity');
    if (options.session && options.session.epoch !== options.epoch)
      throw Error('invalid_adapter_session');
    if (options.session) validateProviderSession(options.session);
  }
  private identity(kind: IdentityKind, externalId: string) {
    const legacy = { instanceId: this.id, externalId: `${kind}:${externalId}` };
    const registry = this.options.registry;
    if (!registry) return this.options.identities.resolve(legacy);
    const reference = {
      homeId: this.options.homeId,
      kind,
      source: { instanceId: this.id, externalId },
    };
    const imported = this.options.identities.lookup(legacy);
    return imported === undefined
      ? registry.resolve(reference)
      : registry.adopt(reference, imported);
  }
  private normalize(wire: Snapshot): HomeSnapshot {
    const model = normalizeHome(wire),
      bindings = new Map<string, Binding>();
    const rooms = wire.areas.map((room) => ({
      id: this.identity('room', room.area_id),
      name: room.name,
      ...(room.icon ? { icon: room.icon } : {}),
    }));
    const devices = model.accessories.map((device) => ({
      id: this.identity('device', device.id),
      source: { instanceId: this.id, externalId: device.id },
      name: device.name,
      roomId: device.areaId ? this.identity('room', device.areaId) : undefined,
      manufacturer: device.manufacturer ?? undefined,
      model: device.model ?? undefined,
      availability:
        device.availability === 'available'
          ? ('online' as const)
          : device.availability === 'unavailable'
            ? ('offline' as const)
            : ('unknown' as const),
    }));
    const endpoints: Endpoint[] = [];
    for (const entity of wire.states) {
      const ownerIndex = model.accessories.findIndex((device) =>
        device.entityIds.includes(entity.entity_id),
      );
      if (ownerIndex < 0) continue;
      const entry = wire.entities.find((item) => item.entity_id === entity.entity_id);
      const externalId = entry?.unique_id
        ? JSON.stringify([entry.platform, entry.config_entry_id, entry.unique_id])
        : entity.entity_id;
      const id = this.identity('endpoint', externalId),
        domain = entity.entity_id.split('.')[0],
        caps = resolveCapabilities(entity, wire.services),
        capabilities: Capability[] = [],
        readings: Record<string, Reading> = {};
      const available = !['unavailable', 'unknown'].includes(entity.state);
      const read = (value: unknown): Reading => ({
        value: scalar(value),
        freshness: available ? 'live' : 'cached',
        observedAt: entity.last_updated ?? entity.last_changed,
      });
      const add = (capability: Capability, actions: Binding['actions'], value?: unknown) => {
        capabilities.push(capability);
        bindings.set(`${id}/${capability.id}`, { entityId: entity.entity_id, capability, actions });
        if (value !== undefined) readings[capability.id] = read(value);
      };
      const action = (service: string, field?: string, scale?: number) => ({
        domain,
        service,
        field,
        scale,
      });
      if (caps.includes('toggle'))
        add(
          { id: 'power', kind: 'power', readable: true, operations: ['on', 'off'] },
          { on: action('turn_on'), off: action('turn_off') },
          available ? entity.state === 'on' : null,
        );
      if (caps.includes('brightness'))
        add(
          {
            id: 'level',
            kind: 'level',
            readable: true,
            operations: ['set'],
            minimum: 0,
            maximum: 100,
            unit: '%',
          },
          { set: action('turn_on', 'brightness', 2.55) },
          typeof entity.attributes.brightness === 'number'
            ? entity.attributes.brightness / 2.55
            : null,
        );
      if (caps.includes('temperature'))
        add(
          {
            id: 'white',
            kind: 'temperature',
            readable: true,
            operations: ['set'],
            unit: 'K',
            minimum: Number(entity.attributes.min_color_temp_kelvin) || undefined,
            maximum: Number(entity.attributes.max_color_temp_kelvin) || undefined,
          },
          { set: action('turn_on', 'color_temp_kelvin') },
          entity.attributes.color_temp_kelvin ?? null,
        );
      if (caps.includes('climate-temperature') || caps.includes('water-temperature'))
        add(
          {
            id: 'target',
            kind: 'temperature',
            readable: true,
            operations: ['set'],
            unit: wire.config.unit_system?.temperature,
            minimum: Number(entity.attributes.min_temp) || undefined,
            maximum: Number(entity.attributes.max_temp) || undefined,
          },
          { set: action('set_temperature', 'temperature') },
          entity.attributes.temperature ?? null,
        );
      for (const [flag, field, service] of [
        ['hvac-mode', 'hvac_modes', 'set_hvac_mode'],
        ['heater-mode', 'operation_list', 'set_operation_mode'],
        ['select', 'options', 'select_option'],
      ] as const) {
        if (!caps.includes(flag)) continue;
        const choices = entity.attributes[field];
        if (!Array.isArray(choices) || !choices.every((value) => typeof value === 'string'))
          continue;
        const key = flag === 'select' ? 'selection' : 'mode';
        add(
          { id: key, kind: 'selection', readable: true, operations: ['select'], choices },
          {
            select: action(
              service,
              flag === 'select' ? 'option' : flag === 'hvac-mode' ? 'hvac_mode' : 'operation_mode',
            ),
          },
          entity.state,
        );
      }
      if (caps.includes('position'))
        add(
          {
            id: 'position',
            kind: 'position',
            readable: true,
            operations: ['set'],
            minimum: 0,
            maximum: 100,
            unit: '%',
          },
          { set: action(`set_${domain}_position`, 'position') },
          entity.attributes.current_position ?? null,
        );
      for (const [cap, operations] of [
        ['movement', ['open', 'close', 'stop']],
        ['lock', ['lock', 'unlock']],
      ] as const) {
        const supported = operations.filter((operation) => caps.includes(operation));
        if (!supported.length) continue;
        add(
          { id: cap, kind: cap, readable: true, operations: supported },
          Object.fromEntries(
            supported.map((operation) => [
              operation,
              action(cap === 'movement' ? `${operation}_${domain}` : operation),
            ]),
          ),
          entity.state,
        );
      }
      if (caps.includes('volume'))
        add(
          {
            id: 'volume',
            kind: 'level',
            readable: true,
            operations: ['set'],
            minimum: 0,
            maximum: 100,
            unit: '%',
          },
          { set: action('volume_set', 'volume_level', 0.01) },
          typeof entity.attributes.volume_level === 'number'
            ? entity.attributes.volume_level * 100
            : null,
        );
      if (caps.includes('press') || caps.includes('run'))
        add(
          { id: 'trigger', kind: 'trigger', readable: false, operations: ['run'] },
          { run: action(caps.includes('press') ? 'press' : 'turn_on') },
        );
      if (caps.includes('value'))
        add(
          {
            id: 'value',
            kind: 'number',
            readable: true,
            operations: ['set'],
            minimum: typeof entity.attributes.min === 'number' ? entity.attributes.min : undefined,
            maximum: typeof entity.attributes.max === 'number' ? entity.attributes.max : undefined,
          },
          { set: action('set_value', 'value') },
          available && Number.isFinite(Number(entity.state)) ? Number(entity.state) : null,
        );
      const deviceClass = entity.attributes.device_class;
      if (!capabilities.length) {
        const numeric =
          domain === 'sensor' &&
          entity.state.trim() !== '' &&
          Number.isFinite(Number(entity.state));
        const kind = typeof deviceClass === 'string' ? deviceClass : 'state';
        add(
          {
            id: 'reading',
            kind,
            readable: true,
            operations: [],
            unit:
              typeof entity.attributes.unit_of_measurement === 'string'
                ? entity.attributes.unit_of_measurement
                : undefined,
          },
          {},
          !available
            ? null
            : domain === 'binary_sensor'
              ? entity.state === 'on'
              : numeric
                ? Number(entity.state)
                : entity.state,
        );
      }
      endpoints.push({
        id,
        source: { instanceId: this.id, externalId },
        deviceId: devices[ownerIndex].id,
        name:
          typeof entity.attributes.friendly_name === 'string'
            ? entity.attributes.friendly_name
            : devices[ownerIndex].name,
        kind: kinds[domain] ?? domain,
        availability: available ? 'online' : 'offline',
        capabilities,
        readings,
      });
    }
    this.bindings = bindings;
    return {
      schema: 'haus.home',
      version: 1,
      homeId: this.options.homeId,
      revision: String(++this.revision),
      rooms,
      devices,
      endpoints,
    };
  }
  async snapshot(signal?: AbortSignal) {
    signal?.throwIfAborted();
    const generation = this.generation,
      before = this.latest;
    const wire = await (this.options.read
      ? this.options.read()
      : readHaSnapshot(this.options.transport));
    if (this.closed || generation !== this.generation) throw Error('adapter_closed');
    signal?.throwIfAborted();
    this.wire =
      this.latest !== before && this.latest ? { ...wire, states: [...this.latest] } : wire;
    return this.normalize(this.wire);
  }
  async execute(command: Command, signal?: AbortSignal): Promise<CommandReceipt> {
    if (this.closed || !this.options.transport.connected) throw Error('endpoint_offline');
    signal?.throwIfAborted();
    const binding = this.bindings.get(`${command.endpointId}/${command.capabilityId}`),
      operation = binding?.actions[command.operation];
    if (!binding || !operation) throw Error('unsupported_operation');
    const data: Record<string, Json> = {};
    if (operation.field) {
      const value = command.arguments.value;
      if (binding.capability.choices) {
        if (!binding.capability.choices.includes(value)) throw Error('invalid_command_value');
      } else if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (binding.capability.minimum !== undefined && value < binding.capability.minimum) ||
        (binding.capability.maximum !== undefined && value > binding.capability.maximum)
      )
        throw Error('invalid_command_value');
      const translated = typeof value === 'number' ? value * (operation.scale ?? 1) : value;
      data[operation.field] =
        operation.field === 'brightness' && typeof value === 'number'
          ? Math.round((value * 255) / 100)
          : translated;
    }
    const action: HausAction = {
      domain: operation.domain,
      service: operation.service,
      target: { entity_id: binding.entityId },
      service_data: data,
    };
    const result = await this.options.transport.request<{ context?: { id?: string } }>({
      type: 'call_service',
      ...action,
    });
    return { status: 'accepted', correlationId: result?.context?.id };
  }
  subscribe(listener: (event: HomeEvent) => void) {
    if (this.closed) throw Error('adapter_closed');
    this.listeners.add(listener);
    if (!this.stops.length) {
      this.stops.push(
        this.options.transport.watchEntities((values) => {
          this.latest = values;
          if (this.wire) {
            this.wire = { ...this.wire, states: [...values] };
            this.emit({ kind: 'snapshot', snapshot: this.normalize(this.wire) });
          }
        }),
        this.options.transport.watchState((state) => {
          if (state !== 'connected') this.emit({ kind: 'availability', availability: 'offline' });
          else
            void this.snapshot()
              .then((snapshot) => this.emit({ kind: 'snapshot', snapshot }))
              .catch(() => {});
        }),
      );
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) for (const stop of this.stops.splice(0)) stop();
    };
  }
  private emit(
    event:
      | { kind: 'snapshot'; snapshot: HomeSnapshot }
      | { kind: 'availability'; availability: 'offline' },
  ) {
    const value = {
      schema: 'haus.event' as const,
      sourceId: this.id,
      epoch: this.options.epoch,
      sequence: ++this.sequence,
      ...event,
    };
    const session = this.options.session;
    const envelope: HomeEvent = session
      ? {
          ...value,
          version: 2,
          homeId: this.options.homeId,
          owner: { ...session.owner },
          ownerGeneration: session.generation,
        }
      : { ...value, version: 1 };
    for (const listener of this.listeners) listener(envelope);
  }
  close() {
    this.closed = true;
    ++this.generation;
    for (const stop of this.stops.splice(0)) stop();
    this.listeners.clear();
    this.options.transport.close();
  }
}
