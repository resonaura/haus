/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { MqttEndpointBinding } from '@haus/mqtt';

export type DiscoveryChanges = ReadonlyMap<string, MqttEndpointBinding | undefined>;
type OwnedBinding = { binding: MqttEndpointBinding; sequence: number };

/** Discovery owns bindings by exact topic/component, independently of the physical device. */
export class DiscoveryBindings {
  private readonly configs = new Map<string, Map<string, OwnedBinding>>();
  private readonly active = new Map<string, OwnedBinding>();
  private readonly stateTopics = new Map<string, Set<string>>();
  private readonly attributesTopics = new Map<string, Set<string>>();
  private readonly availabilityTopics = new Map<string, Set<string>>();
  private sequence = 0;

  get(endpointId: string): MqttEndpointBinding | undefined {
    return this.active.get(endpointId)?.binding;
  }

  matching(topic: string): ReadonlySet<string> | undefined {
    return this.stateTopics.get(topic);
  }

  matchingAttributes(topic: string): ReadonlySet<string> | undefined {
    return this.attributesTopics.get(topic);
  }

  matchingAvailability(topic: string): ReadonlySet<string> | undefined {
    return this.availabilityTopics.get(topic);
  }

  validate(bindings: Iterable<MqttEndpointBinding>): void {
    for (const binding of bindings) {
      const current = this.get(binding.endpointId);
      if (current && current.deviceId !== binding.deviceId)
        throw Error('mqtt_discovery_identity_conflict');
    }
  }

  update(topic: string, changes: DiscoveryChanges): MqttEndpointBinding[] {
    this.validate([...changes.values()].filter((value) => value !== undefined));
    const components = this.configs.get(topic) ?? new Map<string, OwnedBinding>();
    for (const [key, binding] of changes) {
      if (binding) components.set(key, { binding, sequence: ++this.sequence });
      else components.delete(key);
    }
    if (components.size) this.configs.set(topic, components);
    else this.configs.delete(topic);
    return this.rebuild();
  }

  remove(topic: string): MqttEndpointBinding[] {
    this.configs.delete(topic);
    return this.rebuild();
  }

  private rebuild(): MqttEndpointBinding[] {
    const previous = [...this.active.values()];
    this.active.clear();
    this.stateTopics.clear();
    this.attributesTopics.clear();
    this.availabilityTopics.clear();
    for (const components of this.configs.values()) {
      for (const owned of components.values()) {
        const current = this.active.get(owned.binding.endpointId);
        if (!current || owned.sequence > current.sequence)
          this.active.set(owned.binding.endpointId, owned);
      }
    }
    for (const { binding } of this.active.values()) {
      for (const topic of [
        binding.stateTopic,
        binding.modeStateTopic,
        binding.currentTemperatureTopic,
        binding.temperatureStateTopic,
        binding.percentageStateTopic,
      ]) {
        if (!topic) continue;
        const endpoints = this.stateTopics.get(topic) ?? new Set<string>();
        endpoints.add(binding.endpointId);
        this.stateTopics.set(topic, endpoints);
      }
      if (binding.attributesTopic) {
        const endpoints = this.attributesTopics.get(binding.attributesTopic) ?? new Set<string>();
        endpoints.add(binding.endpointId);
        this.attributesTopics.set(binding.attributesTopic, endpoints);
      }
      for (const topic of binding.availability?.topics.map((item) => item.topic) ?? []) {
        const endpoints = this.availabilityTopics.get(topic) ?? new Set<string>();
        endpoints.add(binding.endpointId);
        this.availabilityTopics.set(topic, endpoints);
      }
    }
    return previous
      .filter((owned) => !this.active.has(owned.binding.endpointId))
      .map((owned) => owned.binding);
  }
}
