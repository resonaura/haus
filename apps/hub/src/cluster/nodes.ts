/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { randomUUID } from 'node:crypto';
import { HttpException, HttpStatus } from '@nestjs/common';
import { isRecord } from '@haus/core/record';
import { nodeAddress } from '@haus/servers';
import { In, type DataSource, type EntityManager } from 'typeorm';
import type { HubAuthService } from '../auth/service.js';
import { ClusterNodeEntity, type ClusterNodeRow } from '../storage/entities/domains.js';
import type { Transactions } from '../storage/transactions.js';
import { assertValidClusterRoles } from './attach.js';
import type { AddNodeDto, ClusterNodeRecordDto, UpdateNodeDto } from './cluster.dto.js';
import type { Cluster } from './cluster.js';
import { validateClusterPeerUrl } from './crypto/transport.js';

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

/** Strips internal NVR HMAC secrets before returning cluster nodes to API callers or in-memory DTO maps. */
export function stripNodeSecrets<T extends { id: string }>(node: T): T {
  const copy = { ...(node as Record<string, unknown>) };
  delete copy.key;
  return copy as T;
}

/** Hydrates an in-memory cluster node map from persisted `ClusterNodeEntity` rows. */
export async function loadClusterNodesFromDb<T extends { id: string }>(
  source: DataSource,
  target: Map<string, T>,
): Promise<void> {
  const rows = await source.manager.find(ClusterNodeEntity);
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.value) as T;
      target.set(row.id, stripNodeSecrets({ ...parsed, id: row.id }));
    } catch (error) {
      process.emitWarning(error instanceof Error ? error : String(error));
    }
  }
}

export function normalizeClusterUrl(url: string | undefined | null): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    return nodeAddress(url, true);
  } catch {
    try {
      const parsed = new URL(url.trim());
      return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ''}`;
    } catch {
      return undefined;
    }
  }
}

interface DeduplicableNode {
  id: string;
  url?: string;
  online?: boolean;
  sshServerId?: string | null;
  instanceId?: string;
}

const nodePreferenceScore = (node: DeduplicableNode): number =>
  (node.id.startsWith('hub-') ? 4 : 0) + (node.online ? 2 : 0) + (node.sshServerId ? 1 : 0);

/**
 * Automatically removes self-entries and duplicate peer rows (same normalized URL or instanceId)
 * from the cluster node map and persistent SQLite catalog.
 */
export async function deduplicateClusterNodes<T extends DeduplicableNode>(params: {
  readonly nodesMap: Map<string, T>;
  readonly localHubId: string;
  readonly localUrl?: string;
  readonly localInstanceId?: string;
  readonly transactions?: Transactions;
  readonly recordingCluster?: Cluster;
}): Promise<string[]> {
  const localNormUrl = normalizeClusterUrl(params.localUrl);
  const removed = new Set<string>();
  const keptByUrl = new Map<string, T>();
  const keptByInstance = new Map<string, T>();

  for (const node of Array.from(params.nodesMap.values())) {
    const normUrl = normalizeClusterUrl(node.url);
    const isSelf =
      node.id === params.localHubId ||
      (Boolean(params.localInstanceId) && node.instanceId === params.localInstanceId) ||
      (Boolean(localNormUrl) && normUrl === localNormUrl);
    if (isSelf) {
      removed.add(node.id);
      continue;
    }
    const existing =
      (node.instanceId ? keptByInstance.get(node.instanceId) : undefined) ??
      (normUrl ? keptByUrl.get(normUrl) : undefined);
    if (existing && existing.id !== node.id) {
      if (nodePreferenceScore(node) > nodePreferenceScore(existing)) {
        removed.add(existing.id);
        if (normUrl) keptByUrl.set(normUrl, node);
        if (node.instanceId) keptByInstance.set(node.instanceId, node);
      } else {
        removed.add(node.id);
      }
      continue;
    }
    if (normUrl) keptByUrl.set(normUrl, node);
    if (node.instanceId) keptByInstance.set(node.instanceId, node);
  }

  if (removed.size === 0) return [];
  const removedIds = Array.from(removed);
  for (const id of removedIds) params.nodesMap.delete(id);
  if (params.transactions) {
    await params.transactions.run((manager) =>
      manager.delete(ClusterNodeEntity, { id: In(removedIds) }),
    );
  }
  if (params.recordingCluster) {
    await params.recordingCluster.catalog.reload().catch(() => {});
    for (const id of removedIds) params.recordingCluster.health.delete(id);
    params.recordingCluster.invalidateHealth();
  }
  return removedIds;
}

/** Syncs a cluster node update onto the live recording cluster (including peer storage policy). */
export async function forwardNodeStoragePolicy(
  id: string,
  storageLimitBytes: number | null | undefined,
  recordingCluster?: Cluster,
): Promise<void> {
  if (storageLimitBytes === undefined || !recordingCluster) return;
  if (recordingCluster.nodes().some((item) => item.id === id)) {
    await recordingCluster.update(id, { storageLimitBytes });
  }
}

export async function syncUpdatedNodeToRecordingCluster(
  id: string,
  serializedRow: string | undefined,
  recordingCluster?: Cluster,
): Promise<void> {
  if (!recordingCluster) return;
  if (serializedRow) await recordingCluster.catalog.saveNode({ id, value: serializedRow });
  recordingCluster.invalidateHealth();
  void recordingCluster.refreshHealth({ force: true }).catch(() => {});
}

export async function syncRemovedNodeToRecordingCluster(
  id: string,
  recordingCluster?: Cluster,
): Promise<void> {
  if (!recordingCluster) return;
  await recordingCluster.catalog.removeNode(id).catch(() => {});
  recordingCluster.health.delete(id);
  recordingCluster.invalidateHealth();
}

export function applyClusterNodePatch<
  T extends {
    id: string;
    name: string;
    enabled: boolean;
    roles: string[];
    livePriority?: number;
    storageLimitBytes?: number | null;
    sshServerId?: string | null;
  },
>(
  current: T,
  patch: {
    name?: string;
    enabled?: boolean;
    roles?: string[];
    livePriority?: number;
    storageLimitBytes?: number | null;
    sshServerId?: string | null;
  },
): T {
  const next: T = {
    ...current,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.roles !== undefined ? { roles: patch.roles } : {}),
    ...(patch.livePriority !== undefined ? { livePriority: patch.livePriority } : {}),
    ...(patch.storageLimitBytes !== undefined
      ? { storageLimitBytes: patch.storageLimitBytes }
      : {}),
    ...(patch.sshServerId !== undefined ? { sshServerId: patch.sshServerId } : {}),
  };
  if (patch.sshServerId === null) delete next.sshServerId;
  return next;
}

export async function addClusterNodeRecord(params: {
  readonly node: AddNodeDto;
  readonly nodesMap: Map<string, ClusterNodeRecordDto>;
  readonly authService?: HubAuthService;
  readonly transactions?: Transactions;
}): Promise<ClusterNodeRecordDto> {
  const { node } = params;
  if (!node.url || typeof node.url !== 'string') {
    throw new HttpException({ error: 'invalid_node_url' }, HttpStatus.BAD_REQUEST);
  }
  let validatedUrl: string;
  try {
    validatedUrl = validateClusterPeerUrl(node.url, true);
  } catch {
    throw new HttpException({ error: 'invalid_node_address' }, HttpStatus.BAD_REQUEST);
  }
  const roles = node.roles ?? ['storage', 'stream'];
  assertValidClusterRoles(roles);
  const coordinatorHomeId = params.authService?.getIdentitySummary().homeId ?? 'home-default';
  if (node.homeId && node.homeId !== coordinatorHomeId) {
    throw new HttpException({ error: 'wrong_home' }, HttpStatus.FORBIDDEN);
  }
  const id = node.nodeId?.trim() || randomUUID();
  const record: ClusterNodeRecordDto = {
    id,
    name: node.name ?? `Node ${id.slice(0, 6)}`,
    url: validatedUrl,
    enabled: true,
    roles,
    online: true,
    homeId: coordinatorHomeId,
    ...(typeof node.allowHttp === 'boolean' ? { allowHttp: node.allowHttp } : {}),
    ...(node.sshServerId !== undefined ? { sshServerId: node.sshServerId } : {}),
  };
  if (params.transactions) {
    await params.transactions.run((manager) =>
      manager.upsert(ClusterNodeEntity, { id, value: JSON.stringify(record) }, ['id']),
    );
  }
  params.nodesMap.set(id, record);
  const nodeToken = node.token ?? node.key;
  if (nodeToken && params.authService) {
    params.authService.registerToken(nodeToken, {
      clientId: id,
      clientRole: 'node',
      clientName: record.name,
    });
  }
  return { ...record, pairedNodeId: id };
}

export async function updateClusterNodeRecord(params: {
  readonly id: string;
  readonly patch: UpdateNodeDto;
  readonly nodesMap: Map<string, ClusterNodeRecordDto>;
  readonly transactions?: Transactions;
  readonly recordingCluster?: Cluster;
}): Promise<ClusterNodeRecordDto> {
  const { id, patch } = params;
  const cached = params.nodesMap.get(id);
  if (!cached) throw new HttpException({ error: 'node_not_found' }, HttpStatus.NOT_FOUND);
  let updated = applyClusterNodePatch(cached, patch);
  let serialized: string | undefined;
  await forwardNodeStoragePolicy(id, patch.storageLimitBytes, params.recordingCluster);
  if (params.transactions) {
    updated = await params.transactions.run(async (manager) => {
      const saved = await manager.findOneBy(ClusterNodeEntity, { id });
      if (!saved) throw new HttpException({ error: 'node_not_found' }, HttpStatus.NOT_FOUND);
      const current = JSON.parse(saved.value) as ClusterNodeRecordDto;
      const next = applyClusterNodePatch({ ...current, id }, patch);
      serialized = JSON.stringify(next);
      await manager.update(ClusterNodeEntity, { id }, { value: serialized });
      return stripNodeSecrets(next);
    });
  }
  const clean = stripNodeSecrets(updated);
  params.nodesMap.set(id, clean);
  await syncUpdatedNodeToRecordingCluster(id, serialized, params.recordingCluster);
  return clean;
}
