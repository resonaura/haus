/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createHash } from 'node:crypto';
import {
  identityKey,
  type IdentityRef,
  type IdentityRepository,
  type IdentityTransaction,
} from '@haus/core/identity';
import type { HausDevice, HausEndpoint } from '@haus/core';
import { sanitizeMqttId } from '@haus/mqtt';

/** Durable provider aliases own IDs; labels and discovery transport never do. */
export class MqttIdentities {
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

  device(rawId: string): Promise<string> {
    return this.resolve('device', rawId, [`mqtt_${sanitizeMqttId(rawId)}`], (id) => {
      const device = this.devices().find((device) => device.id === id);
      return device?.source.instanceId === 'haus-mqtt' && device.source.externalId === rawId;
    });
  }

  endpoint(
    rawDevice: string,
    component: string,
    uniqueId: string,
    template: HausEndpoint,
    preferred: string,
  ): Promise<string> {
    const candidates = [
      ...new Set([
        preferred,
        `ep_mqtt_${sanitizeMqttId(uniqueId)}`,
        `ep_${sanitizeMqttId(uniqueId)}`,
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
        this.devices().some(
          (device) =>
            device.source.instanceId === 'haus-mqtt' &&
            device.source.externalId === rawDevice &&
            device.endpoints.some(
              (endpoint) => endpoint.id === id && signature(endpoint) === signature(template),
            ),
        ),
    );
  }

  private resolve(
    kind: 'device' | 'endpoint',
    externalId: string,
    candidates: readonly string[],
    installed: (id: string) => boolean,
  ): Promise<string> {
    const reference: IdentityRef = {
      homeId: this.homeId,
      kind,
      source: { instanceId: 'haus-mqtt', externalId },
    };
    const key = identityKey(reference);
    return this.repository.transaction(async (tx) => {
      const known = await tx.get(reference);
      if (known) return known;
      const matches: string[] = [];
      for (const candidate of candidates) {
        const owner = await tx.owner(candidate);
        if (installed(candidate) && (!owner || identityKey(owner) === key)) matches.push(candidate);
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
    });
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
