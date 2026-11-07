/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Transactions } from '../transactions.js';
import { AssignmentEntity, CameraEventEntity } from './entities.js';
import type { AssignmentRow, CameraEventRow } from './entities.js';

export class SessionCatalog {
  private assignmentRows = new Map<string, AssignmentRow>();
  private eventRows = new Map<string, CameraEventRow>();
  constructor(private readonly transactions: Transactions) {}
  async initialize(): Promise<void> {
    const [assignments, events] = await this.transactions.run(
      async (manager) =>
        [await manager.find(AssignmentEntity), await manager.find(CameraEventEntity)] as const,
    );
    this.assignmentRows = new Map(assignments.map((row) => [row.cameraId, row]));
    this.eventRows = new Map(events.map((row) => [row.eventId, row]));
  }
  assignments(): AssignmentRow[] {
    return [...this.assignmentRows.values()].map((row) => ({ ...row }));
  }
  events(): CameraEventRow[] {
    return [...this.eventRows.values()].map((row) => ({ ...row }));
  }
  async saveAssignment(cameraId: string, nodeId: string): Promise<void> {
    await this.transactions.run(async (manager) => {
      await manager.upsert(AssignmentEntity, { cameraId, nodeId }, ['cameraId']);
    });
    this.assignmentRows.set(cameraId, { cameraId, nodeId });
  }
  async saveEvent(eventId: string, value: string): Promise<void> {
    await this.transactions.run(async (manager) => {
      await manager.upsert(CameraEventEntity, { eventId, value }, ['eventId']);
    });
    this.eventRows.set(eventId, { eventId, value });
  }
  async removeEvent(eventId: string): Promise<void> {
    await this.transactions.run(async (manager) => {
      await manager.delete(CameraEventEntity, { eventId });
    });
    this.eventRows.delete(eventId);
  }
  async originalDigest(eventId: string): Promise<string | undefined> {
    const row = await this.transactions.dataSource.manager
      .createQueryBuilder()
      .select('digest')
      .from('event_archive', 'archive')
      .where('event_id = :eventId AND variant = :variant', { eventId, variant: 'original' })
      .getRawOne<{ digest: string }>();
    return row?.digest;
  }
}
