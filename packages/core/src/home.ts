/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Command, HomeAdapter, HomeEvent, HomeSnapshot } from './types.js';

interface Source {
  adapter: HomeAdapter;
  generation: number;
  online: boolean;
  epoch?: string;
  sequence: number;
  snapshot?: HomeSnapshot;
  stop?: () => void;
}
/** Aggregates independent sources. A failed source cannot take another source's devices offline. */
export class Home {
  private readonly sources = new Map<string, Source>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  constructor(readonly id: string) {}
  add(adapter: HomeAdapter) {
    if (!adapter.id || this.sources.has(adapter.id)) throw Error('duplicate_home_source');
    this.sources.set(adapter.id, { adapter, generation: 0, online: false, sequence: -1 });
  }
  async connect(id: string) {
    const source = this.sources.get(id);
    if (!source) throw Error('unknown_home_source');
    source.stop?.();
    const generation = ++source.generation;
    source.epoch = undefined;
    source.sequence = -1;
    source.online = false;
    const current = () => this.sources.get(id) === source && source.generation === generation;
    source.stop = source.adapter.subscribe((event) => {
      if (current()) this.accept(source, event);
    });
    const sequence = source.sequence;
    try {
      const snapshot = await source.adapter.snapshot();
      if (!current() || source.sequence !== sequence) return;
      this.validate(source, snapshot);
      source.snapshot = snapshot;
      source.online = true;
      this.changed();
    } catch (error) {
      if (current()) {
        source.online = false;
        this.changed();
      }
      throw error;
    }
  }
  private validate(source: Source, snapshot: HomeSnapshot) {
    if (snapshot.schema !== 'haus.home' || snapshot.version !== 1 || snapshot.homeId !== this.id)
      throw Error('invalid_home_snapshot');
    const ids = new Set<string>();
    for (const record of [...snapshot.devices, ...snapshot.endpoints]) {
      if (record.source.instanceId !== source.adapter.id || !record.id || ids.has(record.id))
        throw Error('invalid_home_source_ownership');
      ids.add(record.id);
      for (const other of this.sources.values()) {
        if (other === source) continue;
        if (
          [...(other.snapshot?.devices ?? []), ...(other.snapshot?.endpoints ?? [])].some(
            (item) => item.id === record.id,
          )
        )
          throw Error('duplicate_home_identity');
      }
    }
  }
  private accept(source: Source, event: HomeEvent) {
    if (
      event.schema !== 'haus.event' ||
      event.version !== 1 ||
      event.sourceId !== source.adapter.id ||
      !event.epoch ||
      !Number.isSafeInteger(event.sequence) ||
      event.sequence < 0 ||
      (source.epoch !== undefined && source.epoch !== event.epoch) ||
      event.sequence <= source.sequence
    )
      return;
    if (event.kind === 'snapshot') {
      try {
        this.validate(source, event.snapshot);
      } catch {
        return;
      }
      source.snapshot = event.snapshot;
      source.online = true;
    } else if (event.kind === 'availability') source.online = event.availability === 'online';
    else return;
    source.epoch = event.epoch;
    source.sequence = event.sequence;
    this.changed();
  }
  snapshot(): HomeSnapshot {
    const snapshots = [...this.sources.values()].filter((source) => source.snapshot);
    return {
      schema: 'haus.home',
      version: 1,
      homeId: this.id,
      revision: String(this.revision),
      rooms: [
        ...new Map(
          snapshots.flatMap((source) => source.snapshot!.rooms).map((room) => [room.id, room]),
        ).values(),
      ],
      devices: snapshots.flatMap((source) =>
        source.snapshot!.devices.map((device) => ({
          ...device,
          availability: source.online ? device.availability : ('offline' as const),
        })),
      ),
      endpoints: snapshots.flatMap((source) =>
        source.snapshot!.endpoints.map((endpoint) => ({
          ...endpoint,
          availability: source.online ? endpoint.availability : ('offline' as const),
          readings: source.online
            ? endpoint.readings
            : Object.fromEntries(
                Object.entries(endpoint.readings).map(([key, reading]) => [
                  key,
                  { ...reading, freshness: 'cached' as const },
                ]),
              ),
        })),
      ),
    };
  }
  async execute(command: Command, signal?: AbortSignal) {
    const endpoint = this.snapshot().endpoints.find(
      (endpoint) => endpoint.id === command.endpointId,
    );
    if (!endpoint || endpoint.availability !== 'online') throw Error('endpoint_offline');
    const source = this.sources.get(endpoint.source.instanceId)!;
    const capability = endpoint.capabilities.find(
      (capability) => capability.id === command.capabilityId,
    );
    if (
      !source.adapter.features.has('commands') ||
      !capability?.operations.includes(command.operation)
    )
      throw Error('unsupported_operation');
    if (!command.id) throw Error('invalid_command');
    signal?.throwIfAborted();
    const generation = source.generation;
    const result = await source.adapter.execute(
      JSON.parse(JSON.stringify(command)) as Command,
      signal,
    );
    if (generation !== source.generation || !source.online)
      throw Error('command_confirmation_lost');
    return result;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private changed() {
    ++this.revision;
    for (const listener of this.listeners) listener();
  }
  close() {
    for (const source of this.sources.values()) {
      ++source.generation;
      source.stop?.();
      source.adapter.close();
    }
    this.sources.clear();
    this.listeners.clear();
  }
}
