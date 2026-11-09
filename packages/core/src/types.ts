/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { HomeEvent } from './event/types.js';
export type { HomeEvent, ProviderSession } from './event/types.js';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Availability = 'online' | 'offline' | 'unknown';
export interface SourceRef {
  instanceId: string;
  externalId: string;
}
export interface Room {
  id: string;
  name: string;
  icon?: string;
}
export interface Capability {
  id: string;
  kind: string;
  readable: boolean;
  operations: readonly string[];
  name?: string;
  unit?: string;
  minimum?: number;
  maximum?: number;
  step?: number;
  choices?: readonly Json[];
  deviceClass?: string;
  entityCategory?: 'config' | 'diagnostic';
  icon?: string;
  supportedColorModes?: readonly string[];
  effectList?: readonly string[];
}
export interface Reading {
  value: Json;
  observedAt?: string;
  correlationId?: string;
  freshness: 'live' | 'cached' | 'unknown';
}
export interface Endpoint {
  id: string;
  source: SourceRef;
  deviceId: string;
  name: string;
  kind: string;
  availability: Availability;
  capabilities: readonly Capability[];
  readings: Readonly<Record<string, Reading>>;
}
export interface Device {
  id: string;
  source: SourceRef;
  name: string;
  roomId?: string;
  manufacturer?: string;
  model?: string;
  availability: Availability;
}
export interface HomeSnapshot {
  schema: 'haus.home';
  version: 1;
  homeId: string;
  revision: string;
  rooms: readonly Room[];
  devices: readonly Device[];
  endpoints: readonly Endpoint[];
}
export interface Command {
  id: string;
  endpointId: string;
  capabilityId: string;
  operation: string;
  arguments: Readonly<Record<string, Json>>;
}
export interface CommandReceipt {
  correlationId?: string;
  status: 'accepted' | 'confirmed';
}
export interface HomeAdapter {
  readonly id: string;
  readonly features: ReadonlySet<'devices' | 'commands' | 'events' | 'history' | 'automations'>;
  snapshot(signal?: AbortSignal): Promise<HomeSnapshot>;
  execute(command: Command, signal?: AbortSignal): Promise<CommandReceipt>;
  subscribe(listener: (event: HomeEvent) => void): () => void;
  close(): void;
}

/** Persist this mapping in the host database; source labels and addresses are not identities. */
export interface IdentityStore {
  get(source: SourceRef): string | undefined;
  putIfAbsent(source: SourceRef, proposedId: string): string;
}
export class Identities {
  constructor(
    private readonly store: IdentityStore,
    private readonly allocate: () => string,
  ) {}
  lookup(source: SourceRef): string | undefined {
    if (!source.instanceId || !source.externalId) throw Error('invalid_source_identity');
    return this.store.get(source);
  }
  resolve(source: SourceRef) {
    const existing = this.lookup(source);
    return existing ?? this.store.putIfAbsent(source, this.allocate());
  }
}
