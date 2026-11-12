/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { HausEndpoint, SourceServiceRef } from '@haus/core';

/** Discovery updates one projection of an endpoint; other adapters' identities remain intact. */
export function endpointSources(
  previous: HausEndpoint | undefined,
  next: HausEndpoint,
): readonly SourceServiceRef[] {
  const sources = new Map<string, SourceServiceRef>();
  for (const source of [...(previous?.sourceRefs ?? []), ...(next.sourceRefs ?? [])])
    sources.set(JSON.stringify([source.protocol, source.externalId, source.domain]), source);
  return [...sources.values()];
}

export function mqttOwned(endpoint: HausEndpoint): boolean {
  return !endpoint.sourceOwner || endpoint.sourceOwner.protocol === 'mqtt';
}

/** A shadow MQTT announcement may update aliases, never the native capabilities or state. */
export function reconcileEndpoint(
  previous: HausEndpoint | undefined,
  next: HausEndpoint,
): HausEndpoint {
  return {
    ...(previous && !mqttOwned(previous) ? previous : next),
    // MQTT owns its advertised capabilities, not durable Haus presentation/archive assignments.
    ...(previous?.mediaId !== undefined ? { mediaId: previous.mediaId } : {}),
    ...(previous?.address !== undefined ? { address: previous.address } : {}),
    ...(previous?.roomId !== undefined ? { roomId: previous.roomId } : {}),
    ...(previous?.customEntities !== undefined ? { customEntities: previous.customEntities } : {}),
    sourceRefs: endpointSources(previous, next),
  };
}

/** A discovery tombstone cannot remove a materialized projection owned by another adapter. */
export function withoutMqttSource(endpoint: HausEndpoint): HausEndpoint | undefined {
  const sourceRefs = endpoint.sourceRefs?.filter(
    (source) =>
      source.protocol !== 'mqtt' &&
      // The legacy endpoint/service mapper synthesized this reference; it is not another source.
      !(source.protocol === 'virtual' && source.externalId === endpoint.id),
  );
  if (!sourceRefs?.length) return undefined;
  return sourceRefs.length === endpoint.sourceRefs?.length ? endpoint : { ...endpoint, sourceRefs };
}
