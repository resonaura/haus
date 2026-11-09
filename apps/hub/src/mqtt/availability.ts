/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { Availability } from '@haus/core';
import {
  combineAvailability,
  readAvailability,
  sameAvailabilityRule,
  type MqttEndpointBinding,
} from '@haus/mqtt';

interface EndpointAvailabilityState {
  readonly signature: string;
  readonly topics: Map<string, Availability>;
  latestTopic?: string;
}

export interface AvailabilityUpdate {
  readonly availability: Availability;
  readonly templateResultAvailable: boolean;
}

/** Tracks HA-style availability independently for each discovered endpoint. */
export class MqttAvailability {
  private readonly states = new Map<string, EndpointAvailabilityState>();

  prepare(
    binding: MqttEndpointBinding,
    previous: MqttEndpointBinding | undefined,
    previousAvailability: Availability | undefined,
  ): Availability {
    const unchanged = sameAvailabilityRule(previous?.availability, binding.availability);
    if (!unchanged) this.states.delete(binding.endpointId);
    if (!binding.availability) return 'online';
    // Persisted endpoint availability may be stale after a process restart.
    // Only reuse it when this process has observed a status for the same rule.
    if (unchanged && previousAvailability && this.states.has(binding.endpointId))
      return previousAvailability;
    return 'unknown';
  }

  update(
    binding: MqttEndpointBinding,
    topic: string,
    payload: string,
  ): AvailabilityUpdate | undefined {
    const rule = binding.availability;
    if (!rule) return undefined;

    const signature = JSON.stringify(rule);
    let state = this.states.get(binding.endpointId);
    if (!state || state.signature !== signature) {
      state = { signature, topics: new Map() };
      this.states.set(binding.endpointId, state);
    }

    const observed = readAvailability(rule, topic, payload);
    state.topics.set(topic, observed.availability);
    state.latestTopic = topic;
    return {
      availability: combineAvailability(rule, state.topics, state.latestTopic),
      templateResultAvailable: observed.templateResultAvailable,
    };
  }

  forget(endpointIds: Iterable<string>): void {
    for (const endpointId of endpointIds) this.states.delete(endpointId);
  }
}
