/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createHomeStore, type HomeStore, type HomeState } from '@haus/state';
import {
  OptimisticState,
  actionQueueKey,
  coalesceHausActions,
  extractContextId,
  isStatelessAction,
} from './optimistic.js';
import type { HaTransport } from './ha-client.js';
import type { Snapshot, HassEntity, HausAction } from './types.js';

export type HausHomeStore = HomeStore<Snapshot, HassEntity, HausAction>;
export type HausHomeState = HomeState<Snapshot, HassEntity, HausAction>;

function copySnapshot(snapshot: Snapshot): Snapshot {
  const confirmed = { ...snapshot };
  delete confirmed.pendingEntityIds;
  delete confirmed.pendingSince;
  return {
    ...confirmed,
    states: snapshot.states.map((entity) => ({ ...entity, attributes: { ...entity.attributes } })),
    areas: snapshot.areas.map((area) => ({ ...area })),
    devices: snapshot.devices.map((device) => ({ ...device })),
    entities: snapshot.entities.map((entity) => ({ ...entity })),
    services: { ...snapshot.services },
    config: { ...snapshot.config },
    user: { ...snapshot.user },
  };
}

export function createHausHomeStore(options: {
  openTransport(homeId: string): Promise<HaTransport>;
  optimistic?: OptimisticState;
  now?(): number;
}): HausHomeStore {
  const optimistic = options.optimistic ?? new OptimisticState();
  return createHomeStore<Snapshot, HassEntity, HausAction>({
    now: options.now,
    openTransport: async (homeId) => {
      const transport = await options.openTransport(homeId);
      return {
        get connected() {
          return transport.connected;
        },
        close: () => transport.close(),
        watchState: transport.watchState.bind(transport),
        watchValues: transport.watchEntities.bind(transport),
        watchObservations: transport.watchObservations?.bind(transport),
        async execute(action: HausAction) {
          const response = await transport.request({
            type: 'call_service',
            domain: action.domain,
            service: action.service,
            target: action.target,
            service_data: action.service_data ?? {},
          });
          return { status: 'accepted' as const, correlationId: extractContextId(response) };
        },
      };
    },
    projection: {
      copy: copySnapshot,
      copyValue: (value: HassEntity) => ({ ...value, attributes: { ...value.attributes } }),
      valueId: (value: HassEntity) => value.entity_id,
      values: (snapshot: Snapshot) => snapshot.states,
      withValues: (snapshot, values) => ({ ...snapshot, states: [...values] }),
      pending: (snapshot) => snapshot.pendingEntityIds ?? [],
      subject: actionQueueKey,
      coalesce: coalesceHausActions,
      isStateless: isStatelessAction,
      optimistic,
    },
  });
}
