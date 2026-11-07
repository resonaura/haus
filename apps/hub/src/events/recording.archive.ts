/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { EntityManager } from 'typeorm';
import { EventArchiveEntity, EventArchiveLocationEntity } from './recording.entities.js';
import type { EventArchiveLocationRow, EventArchiveRow } from './recording.entities.js';

export interface ArchiveCandidate {
  readonly id: string;
  readonly startAt: number;
}

export interface ArchiveMetadataRow {
  readonly cursor: number;
  readonly eventId: string;
  readonly nodeId: string;
  readonly digest: string;
}

export interface RecordingArchiveOperations {
  read<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T>;
  write<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T>;
}

function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw Error('recording_archive_query_invalid');
  return value.map((row) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row))
      throw Error('recording_archive_query_invalid');
    return row as Record<string, unknown>;
  });
}

/** TypeORM boundary for immutable event archive descriptors and verified node locations. */
export class RecordingArchiveCatalog {
  constructor(private readonly operations: RecordingArchiveOperations) {}

  descriptor(eventId: string, variant: string, version: number): Promise<EventArchiveRow | null> {
    return this.operations.read((manager) =>
      manager.findOneBy(EventArchiveEntity, { eventId, variant, version }),
    );
  }

  descriptors(eventId: string): Promise<EventArchiveRow[]> {
    return this.operations.read((manager) => manager.findBy(EventArchiveEntity, { eventId }));
  }

  async saveDescriptor(row: EventArchiveRow): Promise<void> {
    await this.operations.write(async (manager) => {
      await manager.upsert(EventArchiveEntity, row, ['eventId', 'variant']);
      await manager.query('UPDATE event_archive_state SET generation=generation+1 WHERE id=1');
    });
  }

  location(
    eventId: string,
    variant: string,
    nodeId: string,
    digest: string,
    version: number,
  ): Promise<EventArchiveLocationRow | null> {
    return this.operations.read((manager) =>
      manager.findOneBy(EventArchiveLocationEntity, {
        eventId,
        variant,
        nodeId,
        digest,
        version,
      }),
    );
  }

  locations(
    eventId: string,
    variant: string,
    digest: string,
    version: number,
  ): Promise<EventArchiveLocationRow[]> {
    return this.operations.read((manager) =>
      manager.findBy(EventArchiveLocationEntity, { eventId, variant, digest, version }),
    );
  }

  async saveLocation(row: EventArchiveLocationRow): Promise<void> {
    await this.operations.write(async (manager) => {
      await manager.upsert(EventArchiveLocationEntity, row, ['eventId', 'variant', 'nodeId']);
      await manager.query('UPDATE event_archive_state SET generation=generation+1 WHERE id=1');
    });
  }

  hasVerifiedLocation(eventId: string, variant: string, version: number): Promise<boolean> {
    return this.operations.read(async (manager) => {
      const result = await manager.query(
        `SELECT 1 AS found FROM event_archive a
        JOIN event_archive_locations l USING(event_id,variant,digest,version)
        WHERE a.event_id=? AND a.variant=? AND a.version=? LIMIT 1`,
        [eventId, variant, version],
      );
      return rows(result).length > 0;
    });
  }

  pendingCandidates({
    nodeIds,
    copies,
    cursor,
    playbackVersion,
    originalPolicyVersion,
    limit = 8,
  }: {
    nodeIds: readonly string[];
    copies: number;
    cursor?: { at: number; id: string };
    playbackVersion: number;
    originalPolicyVersion: number;
    limit?: number;
  }): Promise<ArchiveCandidate[]> {
    if (!nodeIds.length || copies < 1) return Promise.resolve([]);
    const nodes = nodeIds.map(() => '?').join(',');
    const after = cursor ? ' AND (e.start_at>? OR (e.start_at=? AND e.id>?))' : '';
    return this.operations.read(async (manager) => {
      const result = await manager.query(
        `SELECT e.id,e.start_at AS startAt FROM events e WHERE e.status='ready'
        AND e.playback_version=? AND (e.playback_bytes>0
          OR coalesce(json_extract(e.playback_info,'$.originalCompatible'),0)!=1
          OR coalesce(json_extract(e.playback_info,'$.originalPolicyVersion'),0)=?)
        AND ((e.local_original=1 AND (SELECT count(*) FROM event_archive_locations a
          WHERE a.event_id=e.id AND a.variant='original' AND a.node_id IN(${nodes}))<?)
          OR (e.playback_bytes>0 AND e.local_playback=1 AND (SELECT count(*) FROM event_archive_locations a
          WHERE a.event_id=e.id AND a.variant='prepared' AND a.version=e.playback_version
          AND a.node_id IN(${nodes}))<?))${after}
        ORDER BY e.start_at ASC,e.id ASC LIMIT ?`,
        [
          playbackVersion,
          originalPolicyVersion,
          ...nodeIds,
          copies,
          ...nodeIds,
          copies,
          ...(cursor ? [cursor.at, cursor.at, cursor.id] : []),
          Math.min(64, Math.max(1, limit)),
        ],
      );
      return rows(result).map((row) => {
        if (typeof row.id !== 'string' || typeof row.startAt !== 'number')
          throw Error('recording_archive_candidate_invalid');
        return { id: row.id, startAt: row.startAt };
      });
    });
  }

  metadataPage(cursor: number, limit = 32): Promise<ArchiveMetadataRow[]> {
    return this.operations.read(async (manager) => {
      const result = await manager.query(
        `SELECT l.rowid AS cursor,l.event_id AS eventId,l.node_id AS nodeId,l.digest
        FROM event_archive_locations l JOIN events e ON e.id=l.event_id
        WHERE l.rowid>? AND l.variant=CASE WHEN e.playback_bytes>0 THEN 'prepared' ELSE 'original' END
          AND (l.variant='original' OR l.version=e.playback_version)
        ORDER BY l.rowid LIMIT ?`,
        [cursor, Math.min(128, Math.max(1, limit))],
      );
      return rows(result).map((row) => {
        if (
          typeof row.cursor !== 'number' ||
          typeof row.eventId !== 'string' ||
          typeof row.nodeId !== 'string' ||
          typeof row.digest !== 'string'
        )
          throw Error('recording_archive_metadata_invalid');
        return {
          cursor: row.cursor,
          eventId: row.eventId,
          nodeId: row.nodeId,
          digest: row.digest,
        };
      });
    });
  }

  digestsForExistingEvents(): Promise<string[]> {
    return this.operations.read(async (manager) => {
      const result = await manager.query(
        'SELECT DISTINCT a.digest FROM event_archive a JOIN events e ON e.id=a.event_id',
      );
      return rows(result).map((row) => {
        if (typeof row.digest !== 'string') throw Error('recording_archive_digest_invalid');
        return row.digest;
      });
    });
  }

  async pruneOrphans(): Promise<void> {
    await this.operations.write(async (manager) => {
      await manager.query('DELETE FROM event_archive WHERE event_id NOT IN(SELECT id FROM events)');
      await manager.query(
        'DELETE FROM event_archive_locations WHERE event_id NOT IN(SELECT id FROM events)',
      );
    });
  }
}
