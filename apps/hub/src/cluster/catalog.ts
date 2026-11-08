/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Brackets, In, type DataSource } from 'typeorm';
import type { Transactions } from '../storage/transactions.js';
import type { ClusterNode } from './health.js';
import { assertNodeClaims, nodeValue, validSshServerId } from './nodes.js';
import {
  ClusterLocationEntity,
  ClusterMediaEntity,
  ClusterNodeEntity,
} from '../storage/entities/domains.js';
import type {
  ClusterLocationRow,
  ClusterMediaRow,
  ClusterNodeRow,
} from '../storage/entities/domains.js';

const locationKey = (digest: string, nodeId: string) => `${digest}\0${nodeId}`;

/** TypeORM-owned cluster catalog with synchronous, read-only in-memory snapshots. */
export class ClusterCatalog {
  private readonly nodesById = new Map<string, ClusterNodeRow>();
  private readonly locationsByKey = new Map<string, ClusterLocationRow>();
  private readonly locationsByDigest = new Map<string, Map<string, ClusterLocationRow>>();
  private readonly locationsByNode = new Map<string, Map<string, ClusterLocationRow>>();
  private readonly mediaByEvent = new Map<string, ClusterMediaRow>();
  private readonly mediaByDigest = new Map<string, Map<string, ClusterMediaRow>>();
  private initialization?: Promise<void>;

  private readonly source: DataSource;

  constructor(private readonly transactions: Transactions) {
    this.source = transactions.dataSource;
  }

  initialize(): Promise<void> {
    this.initialization ??= this.readSnapshot();
    return this.initialization;
  }

  async reload(): Promise<void> {
    if (this.initialization) await this.initialization;
    this.nodesById.clear();
    this.locationsByKey.clear();
    this.locationsByDigest.clear();
    this.locationsByNode.clear();
    this.mediaByEvent.clear();
    this.mediaByDigest.clear();
    this.initialization = this.readSnapshot();
    await this.initialization;
  }

  nodes(): ClusterNodeRow[] {
    this.assertInitialized();
    return [...this.nodesById.values()];
  }

  locations(): ClusterLocationRow[] {
    this.assertInitialized();
    return [...this.locationsByKey.values()];
  }

  locationsForDigest(digest: string): ClusterLocationRow[] {
    this.assertInitialized();
    return [...(this.locationsByDigest.get(digest)?.values() ?? [])];
  }

  locationsForNode(nodeId: string): ClusterLocationRow[] {
    this.assertInitialized();
    return [...(this.locationsByNode.get(nodeId)?.values() ?? [])];
  }

  location(digest: string, nodeId: string): ClusterLocationRow | undefined {
    this.assertInitialized();
    return this.locationsByKey.get(locationKey(digest, nodeId));
  }

  hasLocation(digest: string, nodeId: string, kind?: string): boolean {
    const location = this.location(digest, nodeId);
    return Boolean(location && (kind === undefined || location.kind === kind));
  }

  backupCount(nodeId: string): number {
    return this.locationsForNode(nodeId).filter((row) => row.kind === 'backup').length;
  }

  media(eventId: string): ClusterMediaRow | undefined {
    this.assertInitialized();
    return this.mediaByEvent.get(eventId);
  }

  mediaForDigest(digest: string): ClusterMediaRow | undefined {
    this.assertInitialized();
    return this.mediaByDigest.get(digest)?.values().next().value;
  }

  mediaRows(): ClusterMediaRow[] {
    this.assertInitialized();
    return [...this.mediaByEvent.values()];
  }

  async saveNode(row: ClusterNodeRow): Promise<void> {
    this.assertInitialized();
    await this.transactions.run(async (manager) => {
      await manager.upsert(ClusterNodeEntity, row, ['id']);
    });
    this.nodesById.set(row.id, row);
  }

  async enrollNode(node: ClusterNode): Promise<void> {
    this.assertInitialized();
    const row = { id: node.id, value: JSON.stringify(node) };
    await this.transactions.run(async (manager) => {
      await assertNodeClaims(manager, node);
      await manager.insert(ClusterNodeEntity, row);
    });
    this.nodesById.set(row.id, row);
  }

  async associateNode(id: string, sshServerId: string | null): Promise<void> {
    this.assertInitialized();
    if (sshServerId !== null && !validSshServerId(sshServerId)) throw Error('invalid_node');
    const row = await this.transactions.run(async (manager) => {
      const previous = await manager.findOneBy(ClusterNodeEntity, { id });
      if (!previous) throw Error('invalid_node');
      const value = nodeValue(previous);
      await assertNodeClaims(manager, { sshServerId }, id);
      const next = { id, value: JSON.stringify({ ...value, sshServerId }) };
      await manager.update(ClusterNodeEntity, { id }, { value: next.value });
      return next;
    });
    this.nodesById.set(id, row);
  }

  async patchNode(
    id: string,
    patch: { enabled?: boolean; livePriority?: number; instanceId?: string },
  ): Promise<void> {
    this.assertInitialized();
    if (
      Object.keys(patch).some((key) => !['enabled', 'livePriority', 'instanceId'].includes(key)) ||
      (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') ||
      (patch.instanceId !== undefined && typeof patch.instanceId !== 'string') ||
      (patch.livePriority !== undefined &&
        (!Number.isInteger(patch.livePriority) ||
          patch.livePriority < 0 ||
          patch.livePriority > 100))
    )
      throw Error('invalid_node');
    const row = await this.transactions.run(async (manager) => {
      const previous = await manager.findOneBy(ClusterNodeEntity, { id });
      if (!previous) throw Error('invalid_node');
      const changes = {
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.livePriority !== undefined ? { livePriority: patch.livePriority } : {}),
        ...(patch.instanceId !== undefined ? { instanceId: patch.instanceId } : {}),
      };
      const next = { id, value: JSON.stringify({ ...nodeValue(previous), ...changes }) };
      await manager.update(ClusterNodeEntity, { id }, { value: next.value });
      return next;
    });
    this.nodesById.set(id, row);
  }

  async removeNode(nodeId: string): Promise<void> {
    this.assertInitialized();
    await this.transactions.run(async (manager) => {
      await manager.delete(ClusterLocationEntity, { nodeId });
      await manager.delete(ClusterNodeEntity, { id: nodeId });
    });
    this.nodesById.delete(nodeId);
    for (const row of this.locationsForNode(nodeId)) this.removeLocationSnapshot(row);
  }

  async removeLocationsForNode(nodeId: string): Promise<void> {
    this.assertInitialized();
    await this.transactions.run(async (manager) => {
      await manager.delete(ClusterLocationEntity, { nodeId });
    });
    for (const row of this.locationsForNode(nodeId)) this.removeLocationSnapshot(row);
  }

  async ensureLocation(digest: string, nodeId: string, kind: string): Promise<void> {
    this.assertInitialized();
    const key = locationKey(digest, nodeId);
    if (this.locationsByKey.has(key)) return;
    const row: ClusterLocationRow = {
      digest,
      nodeId,
      kind,
      catalogVersion: 0,
      metadataHash: null,
    };
    await this.transactions.run(async (manager) => {
      const current = await manager.findOneBy(ClusterLocationEntity, { digest, nodeId });
      if (!current) await manager.insert(ClusterLocationEntity, row);
      else Object.assign(row, current);
    });
    this.putLocationSnapshot(row);
  }

  async saveLocation(row: ClusterLocationRow): Promise<void> {
    this.assertInitialized();
    await this.transactions.run(async (manager) => {
      await manager.upsert(ClusterLocationEntity, row, ['digest', 'nodeId']);
    });
    this.putLocationSnapshot(row);
  }

  async saveArchiveLocation(digest: string, nodeId: string, metadataHash?: string): Promise<void> {
    this.assertInitialized();
    const previous = this.location(digest, nodeId);
    const row: ClusterLocationRow = {
      digest,
      nodeId,
      kind: previous?.kind === 'preparation' ? 'archive' : (previous?.kind ?? 'archive'),
      catalogVersion: previous?.catalogVersion ?? 0,
      metadataHash: metadataHash ?? previous?.metadataHash ?? null,
    };
    await this.saveLocation(row);
  }

  async removeLocation(digest: string, nodeId: string): Promise<void> {
    this.assertInitialized();
    await this.transactions.run(async (manager) => {
      await manager.delete(ClusterLocationEntity, { digest, nodeId });
    });
    const row = this.locationsByKey.get(locationKey(digest, nodeId));
    if (row) this.removeLocationSnapshot(row);
  }

  async saveMedia(row: ClusterMediaRow): Promise<void> {
    this.assertInitialized();
    await this.transactions.run(async (manager) => {
      await manager.upsert(ClusterMediaEntity, row, ['eventId']);
    });
    const previous = this.mediaByEvent.get(row.eventId);
    if (previous) this.removeMediaSnapshot(previous);
    this.putMediaSnapshot(row);
  }

  async removeMedia(eventId: string): Promise<void> {
    this.assertInitialized();
    await this.transactions.run(async (manager) => {
      await manager.delete(ClusterMediaEntity, { eventId });
    });
    const row = this.mediaByEvent.get(eventId);
    if (row) this.removeMediaSnapshot(row);
  }

  async replicationCandidates(nodeIds: string[], copies: number): Promise<string[]> {
    this.assertInitialized();
    if (nodeIds.length === 0) return [];
    const rows = await this.source.manager
      .createQueryBuilder()
      .select('e.id', 'id')
      .from('events', 'e')
      .leftJoin('cluster_media', 'm', 'm.event_id = e.id')
      .where('e.status = :status', { status: 'ready' })
      .andWhere(
        new Brackets((query) => {
          query
            .where('m.event_id IS NULL')
            .orWhere('m.version != e.playback_version')
            .orWhere(
              `(SELECT count(*) FROM cluster_locations l WHERE l.digest=m.digest AND l.catalog_version=1 AND l.node_id IN (:...nodeIds)) < :copies`,
              { nodeIds, copies },
            );
        }),
      )
      .orderBy('e.start_at', 'DESC')
      .limit(8)
      .getRawMany<{ id: string }>();
    return rows.map((row) => row.id);
  }

  async pruneOrphanedMedia(): Promise<void> {
    this.assertInitialized();
    const remaining = await this.transactions.run(async (manager) => {
      const orphanRows = await manager
        .createQueryBuilder()
        .select('m.event_id', 'id')
        .from('cluster_media', 'm')
        .leftJoin('events', 'e', 'e.id = m.event_id')
        .where('e.id IS NULL OR m.version != e.playback_version')
        .getRawMany<{ id: string }>();
      if (orphanRows.length)
        await manager.delete(ClusterMediaEntity, { eventId: In(orphanRows.map((row) => row.id)) });
      return manager.find(ClusterMediaEntity);
    });
    // Recording retention may already have deleted rows in the same database.
    // Refresh both indexes even when the SQL query finds no remaining orphans.
    this.mediaByEvent.clear();
    this.mediaByDigest.clear();
    for (const row of remaining) this.putMediaSnapshot(row);
  }

  private assertInitialized(): void {
    if (!this.initialization) throw Error('cluster_catalog_not_initialized');
  }

  private async readSnapshot(): Promise<void> {
    const [nodes, locations, media] = await Promise.all([
      this.source.manager.find(ClusterNodeEntity),
      this.source.manager.find(ClusterLocationEntity),
      this.source.manager.find(ClusterMediaEntity),
    ]);
    for (const row of nodes) this.nodesById.set(row.id, row);
    for (const row of locations) this.putLocationSnapshot(row);
    for (const row of media) this.putMediaSnapshot(row);
  }

  private putLocationSnapshot(row: ClusterLocationRow): void {
    this.locationsByKey.set(locationKey(row.digest, row.nodeId), row);
    let digestRows = this.locationsByDigest.get(row.digest);
    if (!digestRows) this.locationsByDigest.set(row.digest, (digestRows = new Map()));
    digestRows.set(row.nodeId, row);
    let nodeRows = this.locationsByNode.get(row.nodeId);
    if (!nodeRows) this.locationsByNode.set(row.nodeId, (nodeRows = new Map()));
    nodeRows.set(row.digest, row);
  }

  private removeLocationSnapshot(row: ClusterLocationRow): void {
    this.locationsByKey.delete(locationKey(row.digest, row.nodeId));
    const digestRows = this.locationsByDigest.get(row.digest);
    digestRows?.delete(row.nodeId);
    if (digestRows?.size === 0) this.locationsByDigest.delete(row.digest);
    const nodeRows = this.locationsByNode.get(row.nodeId);
    nodeRows?.delete(row.digest);
    if (nodeRows?.size === 0) this.locationsByNode.delete(row.nodeId);
  }

  private putMediaSnapshot(row: ClusterMediaRow): void {
    this.mediaByEvent.set(row.eventId, row);
    let digestRows = this.mediaByDigest.get(row.digest);
    if (!digestRows) this.mediaByDigest.set(row.digest, (digestRows = new Map()));
    digestRows.set(row.eventId, row);
  }

  private removeMediaSnapshot(row: ClusterMediaRow): void {
    this.mediaByEvent.delete(row.eventId);
    const digestRows = this.mediaByDigest.get(row.digest);
    digestRows?.delete(row.eventId);
    if (digestRows?.size === 0) this.mediaByDigest.delete(row.digest);
  }
}
