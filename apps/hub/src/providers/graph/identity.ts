/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createHash } from 'node:crypto';
import type { HausDevice } from '@haus/core';
import { identityKey, type IdentityRef, type IdentityRepository } from '@haus/core/identity';
import type { BridgeCamera } from '@haus/bridge/protocol';
import { deviceReference, endpointReference } from '../../mqtt/references.js';

export const nativeSource = (bridge: string, camera: string, entity: string) => ({
  protocol: 'vendor' as const,
  externalId: JSON.stringify([bridge, camera, entity]),
});

/** Exact authenticated aliases only; names, slugs and stream URLs never select a Home identity. */
export class NativeGraphIdentity {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly devices: () => readonly HausDevice[],
    private readonly homeId: string,
  ) {}

  async device(bridge: string, camera: BridgeCamera): Promise<string> {
    const matches = this.devices().filter((device) =>
      device.sourceRefs?.some(
        (source) =>
          (source.protocol === 'mqtt' && camera.identifiers.includes(source.externalId)) ||
          (source.protocol === 'vendor' &&
            source.externalId === nativeSource(bridge, camera.id, 'device').externalId),
      ),
    );
    if (
      matches.some((device) =>
        device.sourceRefs?.some(
          (source) =>
            source.protocol === 'vendor' &&
            typeof source.metadata?.bridgeId === 'string' &&
            source.metadata.bridgeId !== bridge,
        ),
      )
    )
      throw Error('native_graph_owner_conflict');
    return this.resolve(
      this.ref('device', bridge, camera.id, 'device'),
      camera.identifiers.map((rawId) => deviceReference(this.homeId, rawId)),
      matches.map((device) => device.id),
    );
  }

  async endpoint(
    bridge: string,
    camera: BridgeCamera,
    entity: { id: string; domain: string; mqtt?: { uniqueId: string } },
    deviceId: string,
  ): Promise<string> {
    const source = nativeSource(bridge, camera.id, entity.id);
    const endpoints = this.devices().find((device) => device.id === deviceId)?.endpoints ?? [];
    const matches = endpoints.filter((endpoint) =>
      endpoint.sourceRefs?.some(
        (ref) =>
          (ref.protocol === 'vendor' && ref.externalId === source.externalId) ||
          (ref.protocol === 'mqtt' &&
            ref.domain === entity.domain &&
            ref.externalId === entity.mqtt?.uniqueId),
      ),
    );
    if (!entity.mqtt && entity.domain === 'camera') {
      const video = endpoints.filter((endpoint) =>
        endpoint.capabilities.some((capability) => capability.id === 'video'),
      );
      if (video.length > 1) throw Error('native_graph_identity_ambiguous');
      if (video[0] && !matches.some((endpoint) => endpoint.id === video[0]?.id))
        matches.push(video[0]);
    }
    const alias = entity.mqtt;
    return this.resolve(
      this.ref('endpoint', bridge, camera.id, entity.id),
      alias
        ? camera.identifiers.map((rawId) =>
            endpointReference(this.homeId, rawId, entity.domain, alias.uniqueId),
          )
        : [],
      matches.map((endpoint) => endpoint.id),
    );
  }

  private ref(
    kind: 'device' | 'endpoint',
    bridge: string,
    camera: string,
    entity: string,
  ): IdentityRef {
    return {
      homeId: this.homeId,
      kind,
      source: { instanceId: 'haus-native', externalId: JSON.stringify([bridge, camera, entity]) },
    };
  }

  private resolve(
    primary: IdentityRef,
    aliases: readonly IdentityRef[],
    candidates: readonly string[],
  ): Promise<string> {
    return this.repository.transaction(async (tx) => {
      const references = [primary, ...aliases];
      const known = (await Promise.all(references.map((ref) => tx.get(ref)))).filter(
        (id) => id !== undefined,
      );
      const matches = new Set([...known, ...candidates]);
      if (matches.size > 1) throw Error('native_graph_identity_ambiguous');
      const id =
        [...matches][0] ??
        `native-${primary.kind}-${createHash('sha256').update(identityKey(primary)).digest('hex').slice(0, 32)}`;
      const owner = await tx.owner(id);
      if (
        !matches.size &&
        (owner ||
          this.devices().some(
            (device) => device.id === id || device.endpoints.some((endpoint) => endpoint.id === id),
          ))
      )
        throw Error('native_graph_identity_collision');
      for (const reference of references) await tx.bind(reference, id);
      return id;
    });
  }
}
