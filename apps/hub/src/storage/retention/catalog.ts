/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Brackets } from 'typeorm';
import {
  RecordingEventEntity,
  EventArchiveLocationEntity,
} from '../../events/recording.entities.js';
import type { Transactions } from '../transactions.js';
import { PreparationAttemptEntity } from './entities.js';

export interface RetentionCursor {
  at: number;
  id: string;
}

export interface ArchiveCopy {
  variant: string;
  digest: string;
  version: number;
}

const pending = `e.status = :status AND e.localOriginal = :local AND
  (e.playbackVersion != :playbackVersion OR (coalesce(e.playbackBytes, 0) = 0 AND
  json_extract(e.playbackInfo, '$.originalCompatible') = 1 AND
  coalesce(json_extract(e.playbackInfo, '$.originalPolicyVersion'), 0) != :originalPolicy))`;

/** TypeORM persistence for background preparation admission and local cache metadata. */
export class RetentionCatalog {
  constructor(private readonly transactions: Transactions) {}

  async pendingPreparations(
    playbackVersion: number,
    originalPolicy: number,
    now: number,
  ): Promise<string[]> {
    const rows = await this.transactions.dataSource.manager
      .createQueryBuilder(RecordingEventEntity, 'e')
      .select('e.id', 'id')
      .leftJoin(PreparationAttemptEntity.options.name, 'a', 'a.eventId = e.id')
      .where(pending, { status: 'ready', local: 1, playbackVersion, originalPolicy })
      .andWhere('coalesce(a.nextAt, 0) <= :now', { now })
      .orderBy('coalesce(a.nextAt, 0)', 'ASC')
      .addOrderBy('e.startAt', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .limit(64)
      .getRawMany<{ id: string }>();
    return rows.map((row) => row.id);
  }

  async deferPreparation(eventId: string, nextAt: number): Promise<void> {
    await this.transactions.run(async (manager) => {
      await manager.upsert(PreparationAttemptEntity, { eventId, nextAt }, ['eventId']);
    });
  }

  async clearPreparation(eventId: string): Promise<void> {
    await this.transactions.run(async (manager) => {
      await manager.delete(PreparationAttemptEntity, { eventId });
    });
  }

  async prunePreparations(playbackVersion: number, originalPolicy: number): Promise<void> {
    await this.transactions.run(async (manager) => {
      const eligible = manager
        .createQueryBuilder(RecordingEventEntity, 'e')
        .select('e.id')
        .where(pending, { status: 'ready', local: 1, playbackVersion, originalPolicy });
      await manager
        .createQueryBuilder()
        .delete()
        .from(PreparationAttemptEntity)
        .where(`event_id NOT IN (${eligible.getQuery()})`, eligible.getParameters())
        .execute();
    });
  }

  async evictionCandidates(
    cursor?: RetentionCursor,
  ): Promise<Array<{ id: string; startAt: number }>> {
    const query = this.transactions.dataSource.manager
      .createQueryBuilder(RecordingEventEntity, 'e')
      .select('e.id', 'id')
      .addSelect('e.startAt', 'startAt')
      .where('e.status = :status', { status: 'ready' })
      .andWhere(
        '(e.localOriginal = :local OR (e.localPlayback = :local AND e.playbackBytes > 0))',
        { local: 1 },
      );
    if (cursor) query.andWhere('(e.startAt > :at OR (e.startAt = :at AND e.id > :id))', cursor);
    return query
      .orderBy('e.startAt', 'ASC')
      .addOrderBy('e.id', 'ASC')
      .limit(64)
      .getRawMany<{ id: string; startAt: number }>();
  }

  async hasArchiveCopies(
    eventId: string,
    nodeId: string,
    copies: readonly ArchiveCopy[],
  ): Promise<boolean> {
    if (!copies.length) return false;
    const count = await this.transactions.dataSource.manager
      .createQueryBuilder(EventArchiveLocationEntity, 'location')
      .where('location.eventId = :eventId AND location.nodeId = :nodeId', { eventId, nodeId })
      .andWhere(
        new Brackets((query) => {
          copies.forEach((copy, index) =>
            query.orWhere(
              `(location.variant = :variant${index} AND location.digest = :digest${index} AND location.version = :version${index})`,
              {
                [`variant${index}`]: copy.variant,
                [`digest${index}`]: copy.digest,
                [`version${index}`]: copy.version,
              },
            ),
          );
        }),
      )
      .getCount();
    return count === copies.length;
  }

  async setLocal(
    eventId: string,
    variant: 'original' | 'prepared',
    present: boolean,
  ): Promise<void> {
    if (variant !== 'original' && variant !== 'prepared') throw Error('invalid_archive_variant');
    await this.transactions.run(async (manager) => {
      await manager.update(
        RecordingEventEntity,
        { id: eventId },
        variant === 'original' ? { localOriginal: present } : { localPlayback: present },
      );
    });
  }
}
