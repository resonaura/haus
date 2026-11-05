/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type {
  MqttDiscoveryPayload,
  MqttEntityKind,
  MqttMessage,
  MqttMessageHandler,
} from './types.js';

/**
 * Checks if a topic matches an MQTT topic filter (supporting '+' and '#' wildcards).
 */
export function topicMatches(filter: string, topic: string): boolean {
  if (filter === topic) return true;
  if (filter === '#') return true;

  const filterParts = filter.split('/');
  const topicParts = topic.split('/');

  for (let i = 0; i < filterParts.length; i++) {
    const f = filterParts[i];
    if (f === '#') return true;
    if (f === '+') {
      if (i >= topicParts.length) return false;
      continue;
    }
    if (f !== topicParts[i]) return false;
  }

  return filterParts.length === topicParts.length;
}

/**
 * Generic router for MQTT topics using standard wildcards.
 * Allows user-installed apps and devices to subscribe and receive routed messages.
 */
export class MqttTopicRouter {
  private readonly routes: Array<{ filter: string; handler: MqttMessageHandler }> = [];

  subscribe(filter: string, handler: MqttMessageHandler): () => void {
    const route = { filter, handler };
    this.routes.push(route);
    return () => {
      const idx = this.routes.indexOf(route);
      if (idx !== -1) this.routes.splice(idx, 1);
    };
  }

  async dispatch(message: MqttMessage): Promise<number> {
    let matched = 0;
    for (const route of this.routes) {
      if (topicMatches(route.filter, message.topic)) {
        matched++;
        await route.handler(message);
      }
    }
    return matched;
  }
}

export interface DiscoveredEntity {
  readonly kind: MqttEntityKind;
  readonly nodeId: string;
  readonly objectId: string;
  readonly config: MqttDiscoveryPayload;
}

/**
 * Parses generic MQTT discovery announcements published by user-installed apps
 * (e.g. `homeassistant/sensor/temp_sensor/config` or `haus/light/spotlight/config`).
 */
export class MqttDiscoveryRegistry {
  private readonly entities = new Map<string, DiscoveredEntity>();

  handleDiscoveryMessage(topic: string, payload: string): DiscoveredEntity | undefined {
    const parts = topic.split('/');
    // Format: <prefix>/<component>/<node_id>/<object_id>/config or <prefix>/<component>/<object_id>/config
    if (!parts.includes('config') || parts.length < 4) return undefined;

    const configIdx = parts.indexOf('config');
    if (configIdx < 3) return undefined;

    let kind: MqttEntityKind;
    let nodeId: string;
    let objectId: string;

    if (configIdx === 3) {
      // <prefix>/<component>/<object_id>/config
      kind = parts[1] as MqttEntityKind;
      nodeId = 'default';
      objectId = parts[2];
    } else {
      // <prefix>/<component>/<node_id>/<object_id>/config
      kind = parts[1] as MqttEntityKind;
      nodeId = parts[2];
      objectId = parts[3];
    }

    if (!payload.trim()) {
      // Empty payload removes the entity
      const key = `${kind}:${nodeId}:${objectId}`;
      this.entities.delete(key);
      return undefined;
    }

    try {
      const config = JSON.parse(payload) as MqttDiscoveryPayload;
      const entity: DiscoveredEntity = { kind, nodeId, objectId, config };
      const key = `${kind}:${nodeId}:${objectId}`;
      this.entities.set(key, entity);
      return entity;
    } catch {
      return undefined;
    }
  }

  get(key: string): DiscoveredEntity | undefined {
    return this.entities.get(key);
  }

  list(): readonly DiscoveredEntity[] {
    return Array.from(this.entities.values());
  }
}
