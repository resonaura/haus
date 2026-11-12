/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  identityKey,
  type IdentityRef,
  type IdentityRepository,
  type IdentityTransaction,
} from '@haus/core/identity';
import type { HausDevice, HausEndpoint } from '@haus/core';
import { sanitizeMqttId, type HaMqttDeviceBlock } from '@haus/mqtt';
import { deviceReference } from './references.js';

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const output: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) output[key] = field;
  return output;
}

function addIdentifier(evidence: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.trim())
    evidence.add(JSON.stringify(['identifier', value]));
}

function addConnection(evidence: Set<string>, value: unknown): void {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((part) => typeof part === 'string' && part.trim())
  )
    evidence.add(JSON.stringify(['connection', value[0], value[1]]));
}

interface DeviceEvidence {
  readonly identifiers: ReadonlySet<string>;
  readonly connections: ReadonlySet<string>;
}

interface EndpointHint {
  readonly component: string;
  readonly uniqueId: string;
}

function incomingEvidence(device: HaMqttDeviceBlock | undefined): DeviceEvidence {
  const identifiers = new Set<string>();
  const connections = new Set<string>();
  const rawIdentifiers = device?.identifiers;
  if (typeof rawIdentifiers === 'string') addIdentifier(identifiers, rawIdentifiers);
  else for (const identifier of rawIdentifiers ?? []) addIdentifier(identifiers, identifier);
  for (const connection of device?.connections ?? []) addConnection(connections, connection);
  return { identifiers, connections };
}

function storedEvidence(device: HausDevice): DeviceEvidence {
  const identifiers = new Set<string>();
  const connections = new Set<string>();
  if (device.source.instanceId === 'haus-mqtt')
    addIdentifier(identifiers, device.source.externalId);
  for (const reference of device.sourceRefs ?? []) {
    if (reference.protocol !== 'mqtt') continue;
    addIdentifier(identifiers, reference.externalId);
    const discovery = objectRecord(reference.metadata?.discovery);
    const rawIdentifiers = discovery?.['identifiers'];
    if (Array.isArray(rawIdentifiers))
      for (const identifier of rawIdentifiers) addIdentifier(identifiers, identifier);
    const rawConnections = discovery?.['connections'];
    if (Array.isArray(rawConnections))
      for (const connection of rawConnections) addConnection(connections, connection);
  }
  return { identifiers, connections };
}

function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function mqttDeviceIds(device: HausDevice): readonly string[] {
  const ids = new Set<string>();
  if (device.source.instanceId === 'haus-mqtt') ids.add(device.source.externalId);
  for (const reference of device.sourceRefs ?? [])
    if (reference.protocol === 'mqtt') ids.add(reference.externalId);
  return [...ids];
}

/** Durable provider aliases own IDs; labels and discovery transport never do. */
export class MqttIdentities {
  private readonly logger = new Logger(MqttIdentities.name);

  constructor(
    private readonly repository: IdentityRepository,
    private readonly homeId: string,
    private readonly devices: () => readonly HausDevice[],
  ) {}

  managedDevices(): Promise<ReadonlySet<string>> {
    return this.repository.transaction(async (tx) => {
      const managed = new Set<string>();
      for (const device of this.devices()) {
        const owner = await tx.owner(device.id);
        if (
          owner?.homeId === this.homeId &&
          owner.kind === 'device' &&
          owner.source.instanceId === 'haus-mqtt'
        )
          managed.add(device.id);
      }
      return managed;
    });
  }

  ownedEndpoints(ids: Iterable<string>): Promise<
    ReadonlyMap<
      string,
      | {
          readonly kind: 'entity';
          readonly device: string;
          readonly component: string;
          readonly uniqueId: string;
        }
      | { readonly kind: 'synthetic'; readonly device: string }
    >
  > {
    return this.repository.transaction(async (tx) => {
      const owned = new Map<
        string,
        | { kind: 'entity'; device: string; component: string; uniqueId: string }
        | { kind: 'synthetic'; device: string }
      >();
      for (const id of ids) {
        const owner = await tx.owner(id);
        if (
          owner?.homeId !== this.homeId ||
          owner.kind !== 'endpoint' ||
          owner.source.instanceId !== 'haus-mqtt'
        )
          continue;
        let tuple: unknown;
        try {
          tuple = JSON.parse(owner.source.externalId);
        } catch {
          continue;
        }
        if (!Array.isArray(tuple) || tuple.length !== 3) continue;
        const [device, component, uniqueId] = tuple;
        if (
          typeof device !== 'string' ||
          typeof component !== 'string' ||
          typeof uniqueId !== 'string'
        )
          continue;
        if (component === 'synthetic-camera' && uniqueId === 'video')
          owned.set(id, { kind: 'synthetic', device });
        else
          owned.set(id, {
            kind: 'entity',
            device,
            component,
            uniqueId,
          });
      }
      return owned;
    });
  }

  syntheticCamera(rawDevice: string, preferred: string): Promise<string> {
    return this.resolve(
      'endpoint',
      JSON.stringify([rawDevice, 'synthetic-camera', 'video']),
      [preferred],
      () => false,
    );
  }

  device(
    rawId: string,
    block?: HaMqttDeviceBlock,
    endpointHints: readonly EndpointHint[] = [],
  ): Promise<string> {
    const reference = deviceReference(this.homeId, rawId);
    const evidence = incomingEvidence(block);
    return this.repository.transaction(async (tx) => {
      const known = await tx.get(reference);
      const matches: HausDevice[] = [];
      for (const device of this.devices()) {
        if (device.source.instanceId !== 'haus-mqtt') continue;
        const stored = storedEvidence(device);
        if (intersects(evidence.connections, stored.connections)) {
          matches.push(device);
          continue;
        }
        if (!intersects(evidence.identifiers, stored.identifiers) || !endpointHints.length)
          continue;
        for (const endpoint of device.endpoints) {
          const owner = await tx.owner(endpoint.id);
          if (
            owner?.homeId === this.homeId &&
            owner.kind === 'endpoint' &&
            owner.source.instanceId === 'haus-mqtt' &&
            endpointHints.some((hint) => {
              try {
                const identity = JSON.parse(owner.source.externalId) as unknown;
                return (
                  Array.isArray(identity) &&
                  identity[1] === hint.component &&
                  identity[2] === hint.uniqueId
                );
              } catch {
                return false;
              }
            })
          ) {
            matches.push(device);
            break;
          }
        }
      }
      if (known !== undefined) {
        if (matches.some((device) => device.id !== known))
          throw Error('mqtt_identity_alias_conflict');
        return known;
      }
      // Ambiguous physical evidence must not merge devices, but it should not
      // make a valid new discovery disappear. Keep it under its own raw ID.
      if (matches.length > 1) this.logger.warn('mqtt_identity_alias_ambiguous');
      const existing = matches.length === 1 ? matches[0] : undefined;
      if (existing) {
        const owner = await tx.owner(existing.id);
        if (
          owner &&
          (owner.homeId !== this.homeId ||
            owner.kind !== 'device' ||
            owner.source.instanceId !== 'haus-mqtt')
        )
          throw Error('mqtt_identity_alias_conflict');
        const aliases = [
          reference,
          ...mqttDeviceIds(existing).map((id) => deviceReference(this.homeId, id)),
        ];
        for (const alias of aliases) {
          const mapped = await tx.get(alias);
          if (mapped !== undefined && mapped !== existing.id)
            throw Error('mqtt_identity_alias_conflict');
        }
        for (const alias of aliases) await tx.bind(alias, existing.id);
        return existing.id;
      }
      const candidates = [`mqtt_${sanitizeMqttId(rawId)}`];
      return this.resolveReference(tx, reference, candidates, (id) => {
        const device = this.devices().find((device) => device.id === id);
        return device?.source.instanceId === 'haus-mqtt' && device.source.externalId === rawId;
      });
    });
  }

  endpoint(
    rawDevice: string,
    component: string,
    uniqueId: string,
    template: HausEndpoint,
    preferred: string,
    deviceId: string,
  ): Promise<string> {
    const device = this.devices().find((candidate) => candidate.id === deviceId);
    const oldDeviceIds = new Set(device ? mqttDeviceIds(device) : []);
    const nativeVideos =
      component === 'camera' && oldDeviceIds.has(rawDevice)
        ? (device?.endpoints.filter(
            (endpoint) =>
              endpoint.sourceOwner?.protocol === 'vendor' &&
              endpoint.capabilities.some((capability) => capability.id === 'video'),
          ) ?? [])
        : [];
    if (nativeVideos.length > 1) throw Error('mqtt_identity_ambiguous_legacy');
    const nativeVideo = nativeVideos[0];
    const candidates = [
      ...new Set([
        preferred,
        `ep_mqtt_${sanitizeMqttId(uniqueId)}`,
        `ep_${sanitizeMqttId(uniqueId)}`,
        ...(nativeVideo ? [nativeVideo.id] : []),
      ]),
    ];
    const signature = (endpoint: HausEndpoint) =>
      JSON.stringify([
        endpoint.category,
        endpoint.capabilities.map((capability) => [capability.id, capability.kind]).sort(),
      ]);
    return this.resolve(
      'endpoint',
      JSON.stringify([rawDevice, component, uniqueId]),
      candidates,
      (id) =>
        Boolean(
          nativeVideo?.id === id ||
          (device?.source.instanceId === 'haus-mqtt' &&
            device.endpoints.some(
              (endpoint) => endpoint.id === id && signature(endpoint) === signature(template),
            )),
        ),
      (id, owner) => {
        if (nativeVideo?.id === id && owner?.homeId === this.homeId && owner.kind === 'endpoint')
          return true;
        if (
          !owner ||
          owner.homeId !== this.homeId ||
          owner.kind !== 'endpoint' ||
          owner.source.instanceId !== 'haus-mqtt'
        )
          return false;
        let tuple: unknown;
        try {
          tuple = JSON.parse(owner.source.externalId);
        } catch {
          return false;
        }
        return (
          Array.isArray(tuple) &&
          tuple.length === 3 &&
          typeof tuple[0] === 'string' &&
          oldDeviceIds.has(tuple[0]) &&
          tuple[1] === component &&
          tuple[2] === uniqueId
        );
      },
    );
  }

  canonicalDeviceIds(rawIds: Iterable<string>): Promise<ReadonlyMap<string, string>> {
    return this.repository.transaction(async (tx) => {
      const mapped = new Map<string, string>();
      for (const rawId of new Set(rawIds)) {
        const id = await tx.get(deviceReference(this.homeId, rawId));
        if (id !== undefined) mapped.set(rawId, id);
      }
      return mapped;
    });
  }

  private resolve(
    kind: 'device' | 'endpoint',
    externalId: string,
    candidates: readonly string[],
    installed: (id: string) => boolean,
    mayAdoptOwner?: (id: string, owner: IdentityRef | undefined) => boolean,
  ): Promise<string> {
    const reference: IdentityRef = {
      homeId: this.homeId,
      kind,
      source: { instanceId: 'haus-mqtt', externalId },
    };
    return this.repository.transaction((tx) =>
      this.resolveReference(tx, reference, candidates, installed, mayAdoptOwner),
    );
  }

  private async resolveReference(
    tx: IdentityTransaction,
    reference: IdentityRef,
    candidates: readonly string[],
    installed: (id: string) => boolean,
    mayAdoptOwner?: (id: string, owner: IdentityRef | undefined) => boolean,
  ): Promise<string> {
    const key = identityKey(reference);
    const known = await tx.get(reference);
    if (known) return known;
    const matches: string[] = [];
    for (const candidate of candidates) {
      const owner = await tx.owner(candidate);
      if (
        installed(candidate) &&
        (!owner || identityKey(owner) === key || mayAdoptOwner?.(candidate, owner))
      )
        matches.push(candidate);
    }
    if (matches.length > 1) throw Error('mqtt_identity_ambiguous_legacy');
    const adopted = matches[0];
    if (adopted) {
      await tx.bind(reference, adopted);
      return adopted;
    }
    const preferred = candidates[0];
    if (!preferred) throw Error('mqtt_identity_missing_candidate');
    const digest = createHash('sha256').update(key).digest('hex');
    for (const candidate of [
      preferred,
      `${preferred}-${digest.slice(0, 16)}`,
      `${preferred}-${digest}`,
    ]) {
      if ((await tx.owner(candidate)) || this.occupied(candidate)) continue;
      await tx.bind(reference, candidate);
      return candidate;
    }
    throw Error('mqtt_identity_allocation_collision');
  }

  private occupied(id: string): boolean {
    return this.devices().some(
      (device) => device.id === id || device.endpoints.some((endpoint) => endpoint.id === id),
    );
  }
}

/** Ephemeral broker fixtures use the same port; production injects OrmIdentities. */
export class MemoryMqttIdentities implements IdentityRepository {
  private aliases = new Map<string, string>();
  private owners = new Map<string, IdentityRef>();
  private pending: Promise<unknown> = Promise.resolve();

  transaction<T>(operation: (tx: IdentityTransaction) => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      const aliases = new Map(this.aliases),
        owners = new Map(this.owners);
      const value = await operation({
        get: async (ref) => aliases.get(identityKey(ref)),
        owner: async (id) => owners.get(id),
        bind: async (ref, id) => {
          const key = identityKey(ref),
            previous = aliases.get(key),
            owner = owners.get(id);
          if (previous && previous !== id) throw Error('identity_import_conflict');
          if (owner && (owner.homeId !== ref.homeId || owner.kind !== ref.kind))
            throw Error('identity_owner_scope_mismatch');
          aliases.set(key, id);
          if (!owner) owners.set(id, ref);
        },
      });
      this.aliases = aliases;
      this.owners = owners;
      return value;
    });
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
