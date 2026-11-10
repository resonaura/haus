/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { MqttEntityKind } from '../types.js';

export interface DiscoveryTopic {
  readonly prefix: string;
  readonly component: string;
  readonly objectId: string;
  readonly nodeId?: string;
}

const platforms: ReadonlySet<string> = new Set<MqttEntityKind>([
  'switch',
  'light',
  'sensor',
  'binary_sensor',
  'camera',
  'climate',
  'water_heater',
  'lock',
  'cover',
  'fan',
  'number',
  'select',
  'button',
  'event',
]);

export function supportedMqttComponent(component: string): component is MqttEntityKind {
  return platforms.has(component);
}

/** One parser for live discovery and durable replay; prefixes are literal namespaces. */
export class DiscoveryTopics {
  readonly prefixes: readonly string[];

  constructor(prefixes: readonly string[] = ['homeassistant', 'haus']) {
    if (
      !prefixes.length ||
      prefixes.some(
        (prefix) =>
          !prefix ||
          /[+#\0]/.test(prefix) ||
          prefix.split('/').some((part) => !part) ||
          Buffer.byteLength(prefix) > 65400,
      )
    )
      throw Error('mqtt_discovery_prefix_invalid');
    if (
      prefixes.some((prefix, index) =>
        prefixes.some(
          (other, otherIndex) =>
            index !== otherIndex && (prefix === other || prefix.startsWith(`${other}/`)),
        ),
      )
    )
      throw Error('mqtt_discovery_prefix_conflict');
    this.prefixes = [...prefixes];
  }

  parse(topic: string): DiscoveryTopic | undefined {
    const prefix = this.prefixes.find((candidate) => topic.startsWith(`${candidate}/`));
    if (!prefix || /[+#\0]/.test(topic) || Buffer.byteLength(topic) > 65535) return;
    const parts = topic.slice(prefix.length + 1).split('/');
    if ((parts.length !== 3 && parts.length !== 4) || parts.at(-1) !== 'config') return;
    const component = parts[0];
    const objectId = parts.at(-2);
    const nodeId = parts.length === 4 ? parts[1] : undefined;
    if (
      !component ||
      !objectId ||
      !/^[a-z_]+$/.test(component) ||
      !/^[a-zA-Z0-9_-]+$/.test(objectId) ||
      (nodeId !== undefined && !/^[a-zA-Z0-9_-]+$/.test(nodeId))
    )
      return;
    return { prefix, component, objectId, nodeId };
  }
}
