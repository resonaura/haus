/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createHash } from 'node:crypto';
import type { DiscoveryTopic } from './topics.js';

/** Stable discovery node marker used only for this Haus home's own exports. */
export function hausDiscoveryNodeId(homeId: string): string {
  const normalized = homeId.trim();
  if (!normalized || Buffer.byteLength(normalized) > 4096) throw Error('mqtt_home_id_invalid');
  const digest = createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 24);
  return `haus_${digest}`;
}

/** Exact node ownership check; a device name, manufacturer, or payload is never trusted. */
export function isHausDiscoveryTopic(
  topic: DiscoveryTopic | undefined,
  ownedNodeId: string,
): boolean {
  return topic?.nodeId === ownedNodeId;
}

/** Identify only the export state/availability namespace owned by this Haus home. */
export function isHausExportTopic(topic: string, ownedNodeId: string): boolean {
  const parts = topic.split('/');
  return (
    parts.length === 4 &&
    parts[0] === 'haus' &&
    parts[1] === ownedNodeId &&
    (parts[2] === 'state' || parts[2] === 'availability') &&
    /^[a-f0-9]{24}$/.test(parts[3] ?? '')
  );
}
