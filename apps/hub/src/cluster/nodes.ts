/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { isRecord } from '@haus/core/record';
import { nodeAddress } from '@haus/servers';
import type { EntityManager } from 'typeorm';
import { ClusterNodeEntity, type ClusterNodeRow } from '../storage/entities/domains.js';

export const validSshServerId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^ssh:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);

interface NodeValue extends Record<string, unknown> {
  url: string;
  sshServerId?: string | null;
}

export function nodeValue(row: ClusterNodeRow): NodeValue {
  let value: unknown;
  try {
    value = JSON.parse(row.value);
  } catch {
    throw Error('invalid_node_catalog');
  }
  if (
    !isRecord(value) ||
    typeof value.url !== 'string' ||
    (value.sshServerId !== undefined &&
      value.sshServerId !== null &&
      !validSshServerId(value.sshServerId))
  )
    throw Error('invalid_node_catalog');
  return { ...value, url: value.url, sshServerId: value.sshServerId };
}

/** Called only inside the catalog writer transaction, including across independent sources. */
export async function assertNodeClaims(
  manager: EntityManager,
  candidate: { url?: string; sshServerId?: string | null },
  exceptId?: string,
): Promise<void> {
  for (const row of await manager.find(ClusterNodeEntity)) {
    if (row.id === exceptId) continue;
    const current = nodeValue(row);
    if (candidate.url && nodeAddress(current.url, true) === candidate.url)
      throw Error('invalid_duplicate_node');
    if (candidate.sshServerId && current.sshServerId === candidate.sshServerId)
      throw Error('invalid_duplicate_ssh_server');
  }
}
