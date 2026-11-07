/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { In, IsNull, LessThanOrEqual } from 'typeorm';
import type { Transactions } from '../transactions.js';
import { ActivityPolicyEntity, ActivityReleaseEntity, ActivityTriggerEntity } from './entities.js';
import type { ActivityPolicyRow, ActivityReleaseRow, ActivityTriggerRow } from './entities.js';
function triggerPolicy(row: ActivityTriggerRow): string | undefined {
  const value: unknown = JSON.parse(row.value);
  return value &&
    typeof value === 'object' &&
    'policyId' in value &&
    typeof value.policyId === 'string'
    ? value.policyId
    : undefined;
}

export class ActivityCatalog {
  private policyRows = new Map<string, ActivityPolicyRow>();
  private releaseRows = new Map<string, ActivityReleaseRow>();
  private triggerRows = new Map<string, ActivityTriggerRow>();
  constructor(private readonly transactions: Transactions) {}
  async initialize(): Promise<void> {
    const [policies, releases, triggers] = await this.transactions.run(
      async (manager) =>
        [
          await manager.find(ActivityPolicyEntity),
          await manager.find(ActivityReleaseEntity),
          await manager.find(ActivityTriggerEntity),
        ] as const,
    );
    this.policyRows = new Map(policies.map((row) => [row.policyId, row]));
    this.releaseRows = new Map(releases.map((row) => [row.policyId, row]));
    this.triggerRows = new Map(triggers.map((row) => [row.requestId, row]));
  }
  active(cameraId: string): ActivityPolicyRow | undefined {
    const row = [...this.policyRows.values()]
      .filter((row) => row.cameraId === cameraId && row.revokedAt === null)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    return row && { ...row };
  }
  policies(nodeId: string): ActivityPolicyRow[] {
    return [...this.policyRows.values()]
      .filter((row) => row.nodeId === nodeId && row.revokedAt === null)
      .map((row) => ({ ...row }));
  }
  policy(policyId: string, cameraId: string, nodeId: string): ActivityPolicyRow | undefined {
    const row = this.policyRows.get(policyId);
    return row?.cameraId === cameraId && row.nodeId === nodeId ? { ...row } : undefined;
  }
  releases(cameraId: string): ActivityReleaseRow[] {
    return [...this.releaseRows.values()]
      .filter((row) => row.cameraId === cameraId)
      .map((row) => ({ ...row }));
  }
  triggers(): ActivityTriggerRow[] {
    return [...this.triggerRows.values()]
      .sort((a, b) => a.expiresAt - b.expiresAt)
      .slice(0, 16)
      .map((row) => ({ ...row }));
  }
  async savePolicy(row: ActivityPolicyRow): Promise<void> {
    await this.transactions.run(async (manager) => {
      await manager.insert(ActivityPolicyEntity, row);
    });
    this.policyRows.set(row.policyId, { ...row });
  }
  async retire(policyId: string, now: number): Promise<void> {
    const result = await this.transactions.run(async (manager) => {
      const row = await manager.findOneByOrFail(ActivityPolicyEntity, { policyId });
      if (row.revokedAt === null) {
        row.revokedAt = now;
        await manager.save(ActivityPolicyEntity, row);
      }
      const release = (await manager.findOneBy(ActivityReleaseEntity, { policyId })) ?? {
        policyId,
        cameraId: row.cameraId,
        nodeId: row.nodeId,
        expiresAt: row.expiresAt,
      };
      await manager.upsert(ActivityReleaseEntity, release, ['policyId']);
      await manager
        .createQueryBuilder()
        .delete()
        .from(ActivityTriggerEntity)
        .where("json_extract(value, '$.policyId') = :policyId", { policyId })
        .execute();
      return { row, release };
    });
    this.policyRows.set(policyId, result.row);
    this.releaseRows.set(policyId, result.release);
    for (const [id, row] of this.triggerRows)
      if (triggerPolicy(row) === policyId) this.triggerRows.delete(id);
  }
  async expireReleases(now: number): Promise<void> {
    await this.transactions.run(async (manager) => {
      await manager.delete(ActivityReleaseEntity, { expiresAt: LessThanOrEqual(now) });
    });
    for (const [id, row] of this.releaseRows) if (row.expiresAt <= now) this.releaseRows.delete(id);
  }
  async acknowledge(nodeId: string, policyIds: string[], expiresAt: number): Promise<void> {
    const released = await this.transactions.run(async (manager) => {
      const pending = await manager.findBy(ActivityReleaseEntity, { nodeId });
      const acknowledged = pending.filter((row) => !policyIds.includes(row.policyId));
      if (acknowledged.length)
        await manager.delete(ActivityReleaseEntity, {
          policyId: In(acknowledged.map((row) => row.policyId)),
        });
      if (policyIds.length)
        await manager.update(
          ActivityPolicyEntity,
          { policyId: In(policyIds), nodeId, revokedAt: IsNull() },
          { expiresAt },
        );
      return acknowledged.map((row) => row.policyId);
    });
    for (const id of released) this.releaseRows.delete(id);
    for (const id of policyIds) {
      const row = this.policyRows.get(id);
      if (row?.nodeId === nodeId && row.revokedAt === null)
        this.policyRows.set(id, { ...row, expiresAt });
    }
  }
  async clearNode(nodeId: string, now: number): Promise<void> {
    await this.transactions.run(async (manager) => {
      await manager.update(
        ActivityPolicyEntity,
        { nodeId, revokedAt: IsNull() },
        { revokedAt: now },
      );
      await manager.delete(ActivityReleaseEntity, { nodeId });
    });
    for (const [id, row] of this.policyRows)
      if (row.nodeId === nodeId && row.revokedAt === null)
        this.policyRows.set(id, { ...row, revokedAt: now });
    for (const [id, row] of this.releaseRows)
      if (row.nodeId === nodeId) this.releaseRows.delete(id);
  }
  async enqueue(row: ActivityTriggerRow): Promise<boolean> {
    const stored = await this.transactions.run(async (manager) => {
      const existing = await manager.findOneBy(ActivityTriggerEntity, { requestId: row.requestId });
      if (existing) return existing;
      if ((await manager.count(ActivityTriggerEntity)) >= 128) return undefined;
      const policyId = triggerPolicy(row);
      const policy = policyId
        ? await manager.findOneBy(ActivityPolicyEntity, {
            policyId,
            nodeId: row.nodeId,
            revokedAt: IsNull(),
          })
        : null;
      if (!policy) return undefined;
      await manager.insert(ActivityTriggerEntity, row);
      return row;
    });
    if (stored) this.triggerRows.set(stored.requestId, { ...stored });
    return Boolean(stored);
  }
  async expireTriggers(now: number): Promise<void> {
    await this.transactions.run(async (manager) => {
      await manager.delete(ActivityTriggerEntity, { expiresAt: LessThanOrEqual(now) });
    });
    for (const [id, row] of this.triggerRows) if (row.expiresAt <= now) this.triggerRows.delete(id);
  }
  async removeTrigger(requestId: string): Promise<void> {
    await this.transactions.run(async (manager) => {
      await manager.delete(ActivityTriggerEntity, { requestId });
    });
    this.triggerRows.delete(requestId);
  }
}
